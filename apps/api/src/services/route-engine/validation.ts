import { elementEstanteIds, elementFaceSlots, faceEstanteId, gondolaGeometry } from "./access-points.js";
import { isBlockingElement, perimeterCell } from "./floor-grid.js";
import { PlanRuntime } from "./physical-engine.js";
import type { Face, GondolaSlots, FloorElementSpec, FloorPlanSpec } from "./types.js";

const FACE_SIDE: Record<Face, string> = { A: "LD", B: "LE" };

/** "1–7" para sequência contínua, senão "1, 3, 8". */
function formatCodes(codes: string[]): string {
  const nums = codes.map((c) => Number.parseInt(c, 10));
  const contiguous = nums.every((n, i) => !Number.isNaN(n) && (i === 0 || n === nums[i - 1]! + 1));
  return contiguous && codes.length > 2 ? `${codes[0]}–${codes[codes.length - 1]}` : codes.join(", ");
}

export type PlanIssue = {
  severity: "error" | "warning";
  code:
    | "NO_START"
    | "NO_PACKING"
    | "OUT_OF_BOUNDS"
    | "OVERLAP"
    | "GONDOLA_UNLINKED"
    | "ESTANTE_DUPLICATED"
    | "ESTANTE_NOT_PLACED"
    | "NO_FACE"
    | "SLOTS_TOO_SMALL"
    | "FACE_NOT_MAPPED"
    | "RECEIVING_BLOCKED"
    | "PACKING_UNREACHABLE"
    | "ACCESS_BLOCKED";
  message: string;
  elementIds?: string[];
};

export type PlanValidation = {
  ok: boolean;
  issues: PlanIssue[];
  totalAccessPoints: number;
  reachableAccessPoints: number;
};

function overlaps(a: FloorElementSpec, b: FloorElementSpec): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

export function validateFloorPlan(
  plan: FloorPlanSpec,
  slots: GondolaSlots,
  gondolaLabels: Map<string, string>,
): PlanValidation {
  const issues: PlanIssue[] = [];
  const label = (e: FloorElementSpec) => {
    if (e.type !== "GONDOLA") return e.label || e.type;
    const ids = elementEstanteIds(e);
    if (!ids.length) return "gôndola sem vínculo";
    const codes = ids.map((id) => gondolaLabels.get(id) ?? "?").sort((a, b) => a.localeCompare(b, "pt-BR"));
    return `${ids.length > 1 ? "Gôndola" : "Estante"} ${codes.join("/")}`;
  };

  if (!plan.elements.some((e) => e.type === "START_POINT")) {
    issues.push({ severity: "error", code: "NO_START", message: "Defina o ponto de início das rotas" });
  }
  if (!plan.elements.some((e) => e.type === "PACKING_POINT")) {
    issues.push({ severity: "warning", code: "NO_PACKING", message: "Nenhum ponto de packing na planta" });
  }

  for (const e of plan.elements) {
    if (e.x < 0 || e.y < 0 || e.x + e.width > plan.widthCells || e.y + e.height > plan.heightCells) {
      issues.push({ severity: "error", code: "OUT_OF_BOUNDS", message: `${label(e)} está fora dos limites do barracão`, elementIds: [e.id] });
    }
  }

  const blocking = plan.elements.filter(isBlockingElement);
  for (let i = 0; i < blocking.length; i++) {
    for (let j = i + 1; j < blocking.length; j++) {
      if (overlaps(blocking[i]!, blocking[j]!)) {
        issues.push({
          severity: "error",
          code: "OVERLAP",
          message: `Sobreposição entre ${label(blocking[i]!)} e ${label(blocking[j]!)}`,
          elementIds: [blocking[i]!.id, blocking[j]!.id],
        });
      }
    }
  }

  const seenEstante = new Map<string, string>();
  /** estanteId|face|coluna -> gôndola que atende. */
  const covered = new Map<string, string>();
  const duplicated = new Map<string, { estanteId: string; face: Face; codes: string[]; elementIds: [string, string] }>();
  for (const e of plan.elements) {
    if (e.type !== "GONDOLA") continue;
    if (!e.estanteId) {
      issues.push({ severity: "error", code: "GONDOLA_UNLINKED", message: "Gôndola sem estante vinculada", elementIds: [e.id] });
      continue;
    }
    for (const estanteId of elementEstanteIds(e)) {
      if (!seenEstante.has(estanteId)) seenEstante.set(estanteId, e.id);
    }
    if (!e.faceAEnabled && !e.faceBEnabled) {
      issues.push({ severity: "error", code: "NO_FACE", message: `${label(e)} sem nenhuma face habilitada`, elementIds: [e.id] });
    }
    for (const face of ["A", "B"] as const) {
      const estanteId = faceEstanteId(e, face);
      if (!estanteId || !(face === "A" ? e.faceAEnabled : e.faceBEnabled)) continue;
      for (const code of elementFaceSlots(e, face, slots)) {
        const key = `${estanteId}|${face}|${code}`;
        const prev = covered.get(key);
        if (prev && prev !== e.id) {
          const dupKey = `${estanteId}|${face}|${prev}|${e.id}`;
          const dup = duplicated.get(dupKey) ?? { estanteId, face, codes: [], elementIds: [prev, e.id] };
          dup.codes.push(code);
          duplicated.set(dupKey, dup);
        } else {
          covered.set(key, e.id);
        }
      }
    }
    const count = Math.max(elementFaceSlots(e, "A", slots).length, elementFaceSlots(e, "B", slots).length);
    if (count > gondolaGeometry(e).length) {
      issues.push({
        severity: "warning",
        code: "SLOTS_TOO_SMALL",
        message: `${label(e)} tem ${count} colunas em um lado e só ${gondolaGeometry(e).length} células; aumente o comprimento`,
        elementIds: [e.id],
      });
    }
  }

  for (const dup of duplicated.values()) {
    issues.push({
      severity: "error",
      code: "ESTANTE_DUPLICATED",
      message: `Estante ${gondolaLabels.get(dup.estanteId) ?? "?"}: ${dup.codes.length === 1 ? "coluna" : "colunas"} ${formatCodes(dup.codes)} do ${FACE_SIDE[dup.face]} em mais de uma gôndola`,
      elementIds: dup.elementIds,
    });
  }

  for (const [estanteId, elementId] of seenEstante) {
    for (const face of ["A", "B"] as const) {
      const all = slots.get(estanteId)?.[face] ?? [];
      const missing = all.filter((code) => !covered.has(`${estanteId}|${face}|${code}`));
      if (!missing.length) continue;
      const estante = `Estante ${gondolaLabels.get(estanteId) ?? "?"}`;
      issues.push({
        severity: "warning",
        code: "FACE_NOT_MAPPED",
        message:
          missing.length === all.length
            ? `${estante} tem ${all.length} colunas no ${FACE_SIDE[face]}, mas nenhuma gôndola atende esse lado`
            : `${estante}: ${missing.length === 1 ? "coluna" : "colunas"} ${formatCodes(missing)} do ${FACE_SIDE[face]} fora de todas as gôndolas`,
        elementIds: [elementId],
      });
    }
  }

  for (const [estanteId, code] of gondolaLabels) {
    const faceSlots = slots.get(estanteId);
    if (!seenEstante.has(estanteId) && (faceSlots?.A.length ?? 0) + (faceSlots?.B.length ?? 0) > 0) {
      issues.push({ severity: "warning", code: "ESTANTE_NOT_PLACED", message: `Estante ${code} do cadastro não está na planta` });
    }
  }

  const rt = new PlanRuntime(plan, slots);
  const receiving = plan.elements.find((e) => e.type === "RECEIVING_AREA");
  if (receiving && (perimeterCell(rt.grid, receiving) < 0 || !rt.isReachable(rt.receivingCell))) {
    issues.push({
      severity: "warning",
      code: "RECEIVING_BLOCKED",
      message: "Área de recebimento sem passagem livre ao redor; a armazenagem não consegue partir dela",
      elementIds: [receiving.id],
    });
  }
  for (const e of plan.elements) {
    if (e.type !== "PACKING_POINT") continue;
    const point = rt.packingPoints.find((p) => p.elementId === e.id);
    if (point && rt.isReachable(point.cell)) continue;
    issues.push({
      severity: "warning",
      code: "PACKING_UNREACHABLE",
      message: `${e.label || "Packing"} sem caminho livre a partir de nenhum início`,
      elementIds: [e.id],
    });
  }

  let reachable = 0;
  const blockedByElement = new Map<string, number>();
  for (const p of rt.accessPoints) {
    if (rt.isReachable(p.cell)) reachable++;
    else blockedByElement.set(p.elementId, (blockedByElement.get(p.elementId) ?? 0) + 1);
  }
  for (const [elementId, count] of blockedByElement) {
    const e = plan.elements.find((x) => x.id === elementId)!;
    issues.push({
      severity: "error",
      code: "ACCESS_BLOCKED",
      message: `${label(e)}: ${count} posições sem acesso a partir do início`,
      elementIds: [elementId],
    });
  }

  return {
    ok: !issues.some((i) => i.severity === "error"),
    issues,
    totalAccessPoints: rt.accessPoints.length,
    reachableAccessPoints: reachable,
  };
}
