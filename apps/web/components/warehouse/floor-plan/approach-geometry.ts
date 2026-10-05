import type { ApproachStop } from "@/lib/api/approach-waves";
import type { FloorElement, FloorPlanEstante } from "@/lib/api/floor-plan";
import { elementAt, faceColunaRange, faceColunas, faceHalfRect, gondolaView, type Face } from "./geometry";

export const APPROACH_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

function faceAt(e: FloorElement, px: number, py: number): Face | null {
  for (const face of ["A", "B"] as Face[]) {
    const r = faceHalfRect(e, face);
    if (px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height) return face;
  }
  return null;
}

function faceEstanteId(e: FloorElement, face: Face): string | null {
  return (face === "B" ? e.estanteIdB || e.estanteId : e.estanteId) || null;
}

function stopBounds(stop: ApproachStop): { min: number; max: number } | null {
  if (stop.colunaFrom == null && stop.colunaTo == null) return null;
  const a = stop.colunaFrom ?? stop.colunaTo!;
  const b = stop.colunaTo ?? stop.colunaFrom!;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Parada do lado da gôndola clicado (coordenadas contínuas em células); gôndola sem faixa = estante inteira. */
export function stopFromPoint(
  elements: FloorElement[],
  estantes: Map<string, FloorPlanEstante>,
  px: number,
  py: number,
): ApproachStop | null {
  const e = elementAt(elements, Math.floor(px), Math.floor(py));
  if (!e || e.type !== "GONDOLA") return null;
  const face = faceAt(e, px, py);
  if (!face || (face === "A" ? !e.faceAEnabled : !e.faceBEnabled)) return null;
  const estanteId = faceEstanteId(e, face);
  if (!estanteId) return null;
  const range = faceColunaRange(e, face);
  if (range.min == null && range.max == null) return { estanteId, face, colunaFrom: null, colunaTo: null };
  const nums = faceColunas(gondolaView(e, estantes), face)
    .map((c) => Number.parseInt(c, 10))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return { estanteId, face, colunaFrom: range.min, colunaTo: range.max };
  return { estanteId, face, colunaFrom: Math.min(...nums), colunaTo: Math.max(...nums) };
}

export function sameStop(a: ApproachStop, b: ApproachStop): boolean {
  return a.estanteId === b.estanteId && a.face === b.face && a.colunaFrom === b.colunaFrom && a.colunaTo === b.colunaTo;
}

/** Metades de gôndola que atendem a parada (mesma estante e lado, com alguma coluna dentro da faixa). */
export function stopRects(stop: ApproachStop, elements: FloorElement[], estantes: Map<string, FloorPlanEstante>) {
  const bounds = stopBounds(stop);
  const out: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const e of elements) {
    if (e.type !== "GONDOLA") continue;
    if (stop.face === "A" ? !e.faceAEnabled : !e.faceBEnabled) continue;
    if (faceEstanteId(e, stop.face) !== stop.estanteId) continue;
    if (bounds) {
      const codes = faceColunas(gondolaView(e, estantes), stop.face);
      const hit = codes.some((c) => {
        const n = Number.parseInt(c, 10);
        return !Number.isNaN(n) && n >= bounds.min && n <= bounds.max;
      });
      if (!hit) continue;
    }
    out.push(faceHalfRect(e, stop.face));
  }
  return out;
}

export function stopLabel(stop: ApproachStop, code: (estanteId: string) => string): string {
  const side = stop.face === "A" ? "LD" : "LE";
  if (stop.colunaFrom == null && stop.colunaTo == null) return `${code(stop.estanteId)} ${side} (inteira)`;
  return `${code(stop.estanteId)} ${side} ${stop.colunaFrom ?? stop.colunaTo}→${stop.colunaTo ?? stop.colunaFrom}`;
}
