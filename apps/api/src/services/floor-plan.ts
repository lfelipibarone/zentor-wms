import { FloorElementType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  gondolaEstanteIds,
  invalidateRouteEngine,
  loadGondolaSlots,
  loadFloorPlanSpecs,
  PhysicalRouteEngine,
  PlanRuntime,
  type FloorElementSpec,
  type FloorPlanSpec,
} from "./route-engine/index.js";
import { validateFloorPlan, type PlanValidation } from "./route-engine/validation.js";
import { gondolaCode } from "./warehouse-layout.js";

const DEFAULT_WIDTH = 60;
const DEFAULT_HEIGHT = 40;
const MAX_CELLS = 400;
const MAX_ELEMENTS = 2000;
const ELEMENT_TYPES = new Set<string>(Object.values(FloorElementType));

export class FloorPlanConflictError extends Error {
  constructor() {
    super("A planta foi alterada por outra pessoa. Recarregue antes de salvar.");
    this.name = "FloorPlanConflictError";
  }
}

export type FloorPlanDraft = {
  cellSizeCm?: number;
  widthCells: number;
  heightCells: number;
  elements: Array<Partial<FloorElementSpec> & { type: string }>;
};

function toInt(v: unknown, fallback = 0): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function optionalColuna(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 9999 ? n : null;
}

/** Faixa de colunas de um lado; de/até invertidos são trocados. */
function colunaRange(min: unknown, max: unknown): [number | null, number | null] {
  const a = optionalColuna(min);
  const b = optionalColuna(max);
  return a !== null && b !== null && a > b ? [b, a] : [a, b];
}

function sanitizeDraft(barracaoId: string, draft: FloorPlanDraft, planId = "draft", version = 0): FloorPlanSpec {
  const widthCells = toInt(draft.widthCells, DEFAULT_WIDTH);
  const heightCells = toInt(draft.heightCells, DEFAULT_HEIGHT);
  if (widthCells < 4 || heightCells < 4 || widthCells > MAX_CELLS || heightCells > MAX_CELLS) {
    throw new Error(`Tamanho do barracão deve ficar entre 4 e ${MAX_CELLS} células`);
  }
  const cellSizeCm = toInt(draft.cellSizeCm, 50);
  if (cellSizeCm < 10 || cellSizeCm > 500) {
    throw new Error("Tamanho da célula deve ficar entre 10 e 500 cm");
  }
  const raw = Array.isArray(draft.elements) ? draft.elements : [];
  if (raw.length > MAX_ELEMENTS) throw new Error(`Máximo de ${MAX_ELEMENTS} elementos por planta`);

  const elements: FloorElementSpec[] = raw.map((e, i) => {
    if (!ELEMENT_TYPES.has(e.type)) throw new Error(`Tipo de elemento inválido: ${e.type}`);
    const width = Math.max(1, toInt(e.width, 1));
    const height = Math.max(1, toInt(e.height, 1));
    const gondola = e.type === "GONDOLA";
    const [colunaMinA, colunaMaxA] = gondola ? colunaRange(e.colunaMinA, e.colunaMaxA) : [null, null];
    const [colunaMinB, colunaMaxB] = gondola ? colunaRange(e.colunaMinB, e.colunaMaxB) : [null, null];
    return {
      id: typeof e.id === "string" && e.id ? e.id : `new-${i}`,
      type: e.type as FloorElementSpec["type"],
      x: toInt(e.x),
      y: toInt(e.y),
      width,
      height,
      rotation: ((toInt(e.rotation) % 360) + 360) % 360,
      estanteId: e.type === "GONDOLA" ? e.estanteId || null : null,
      estanteIdB:
        e.type === "GONDOLA" && e.estanteId && e.estanteIdB && e.estanteIdB !== e.estanteId ? e.estanteIdB : null,
      faceAEnabled: e.faceAEnabled ?? true,
      faceBEnabled: e.faceBEnabled ?? false,
      colunaReversedA: e.colunaReversedA ?? false,
      colunaReversedB: e.colunaReversedB ?? false,
      colunaMinA,
      colunaMaxA,
      colunaMinB,
      colunaMaxB,
      label: typeof e.label === "string" ? e.label.trim().slice(0, 60) || null : null,
    };
  });

  return { id: planId, barracaoId, cellSizeCm, widthCells, heightCells, version, elements };
}

async function assertBarracao(tenantId: string, barracaoId: string) {
  const barracao = await prisma.warehouseBarracao.findFirst({
    where: { id: barracaoId, tenantId },
    select: { id: true, code: true, name: true },
  });
  if (!barracao) throw new Error("Barracão não encontrado");
  return barracao;
}

export async function listBarracaoEstantes(tenantId: string, barracaoId: string) {
  const estantes = await prisma.warehouseEstante.findMany({
    where: { tenantId, corredor: { setor: { barracaoId } } },
    orderBy: [{ pickOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, corredor: { select: { code: true } } },
  });
  const ids = estantes.map((e) => e.id);
  const [slots, linhaCodes] = await Promise.all([
    loadGondolaSlots(tenantId, ids),
    prisma.warehouseLinha.findMany({
      where: { tenantId, coluna: { estanteId: { in: ids } } },
      select: { code: true, face: true, coluna: { select: { estanteId: true } } },
      distinct: ["colunaId", "code", "face"],
    }),
  ]);
  const linhasByEstante = new Map<string, { all: Set<string>; A: Set<string>; B: Set<string> }>();
  for (const l of linhaCodes) {
    const sets = linhasByEstante.get(l.coluna.estanteId) ?? { all: new Set(), A: new Set(), B: new Set() };
    sets.all.add(l.code);
    sets[l.face].add(l.code);
    linhasByEstante.set(l.coluna.estanteId, sets);
  }

  return estantes
    .map((e) => ({
      id: e.id,
      code: gondolaCode(e.code, e.corredor.code),
      name: e.name,
      /** Colunas do LD (Face A) e do LE (Face B), ao longo da gôndola. */
      colunasLD: slots.get(e.id)?.A ?? [],
      colunasLE: slots.get(e.id)?.B ?? [],
      /** Quantidade de linhas (altura). */
      linhas: linhasByEstante.get(e.id)?.all.size ?? 0,
      linhasLD: linhasByEstante.get(e.id)?.A.size ?? 0,
      linhasLE: linhasByEstante.get(e.id)?.B.size ?? 0,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
}

async function validationFor(
  tenantId: string,
  barracaoId: string,
  plan: FloorPlanSpec,
  preloaded?: Awaited<ReturnType<typeof listBarracaoEstantes>>,
): Promise<PlanValidation> {
  const estantes = preloaded ?? (await listBarracaoEstantes(tenantId, barracaoId));
  const slots = new Map(estantes.map((e) => [e.id, { A: e.colunasLD, B: e.colunasLE }]));
  return validateFloorPlan(plan, slots, new Map(estantes.map((e) => [e.id, e.code])));
}

export async function getFloorPlanEditorData(tenantId: string, barracaoId: string) {
  const barracao = await assertBarracao(tenantId, barracaoId);
  const [saved] = await loadFloorPlanSpecs(tenantId, barracaoId);
  const plan: FloorPlanSpec = saved ?? {
    id: "draft",
    barracaoId,
    cellSizeCm: 50,
    widthCells: DEFAULT_WIDTH,
    heightCells: DEFAULT_HEIGHT,
    version: 0,
    elements: [],
  };
  const estantes = await listBarracaoEstantes(tenantId, barracaoId);
  const validation = await validationFor(tenantId, barracaoId, plan, estantes);
  return { barracao, plan, saved: Boolean(saved), estantes, validation };
}

export async function saveFloorPlan(
  tenantId: string,
  barracaoId: string,
  draft: FloorPlanDraft & { expectedVersion?: number },
) {
  await assertBarracao(tenantId, barracaoId);
  const spec = sanitizeDraft(barracaoId, draft);

  const estanteIds = gondolaEstanteIds([spec]);
  if (estanteIds.length) {
    const valid = await prisma.warehouseEstante.count({
      where: { tenantId, id: { in: estanteIds }, corredor: { setor: { barracaoId } } },
    });
    if (valid !== estanteIds.length) throw new Error("Gôndola vinculada a estante de outro barracão");
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.warehouseFloorPlan.findUnique({ where: { barracaoId } });
    if (draft.expectedVersion !== undefined && (current?.version ?? 0) !== draft.expectedVersion) {
      throw new FloorPlanConflictError();
    }
    const plan = current
      ? await tx.warehouseFloorPlan.update({
          where: { id: current.id },
          data: {
            cellSizeCm: spec.cellSizeCm,
            widthCells: spec.widthCells,
            heightCells: spec.heightCells,
            version: { increment: 1 },
          },
        })
      : await tx.warehouseFloorPlan.create({
          data: {
            tenantId,
            barracaoId,
            cellSizeCm: spec.cellSizeCm,
            widthCells: spec.widthCells,
            heightCells: spec.heightCells,
          },
        });
    await tx.warehouseFloorElement.deleteMany({ where: { floorPlanId: plan.id } });
    if (spec.elements.length) {
      await tx.warehouseFloorElement.createMany({
        data: spec.elements.map((e) => ({
          tenantId,
          floorPlanId: plan.id,
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          rotation: e.rotation,
          estanteId: e.estanteId ?? null,
          estanteIdB: e.estanteIdB ?? null,
          faceAEnabled: e.faceAEnabled,
          faceBEnabled: e.faceBEnabled,
          colunaReversedA: e.colunaReversedA,
          colunaReversedB: e.colunaReversedB,
          colunaMinA: e.colunaMinA ?? null,
          colunaMaxA: e.colunaMaxA ?? null,
          colunaMinB: e.colunaMinB ?? null,
          colunaMaxB: e.colunaMaxB ?? null,
          label: e.label ?? null,
        })),
      });
    }
  });

  invalidateRouteEngine(tenantId);
  return getFloorPlanEditorData(tenantId, barracaoId);
}

export async function validateFloorPlanDraft(tenantId: string, barracaoId: string, draft?: FloorPlanDraft) {
  await assertBarracao(tenantId, barracaoId);
  if (draft) return validationFor(tenantId, barracaoId, sanitizeDraft(barracaoId, draft));
  const [saved] = await loadFloorPlanSpecs(tenantId, barracaoId);
  if (!saved) throw new Error("Barracão ainda não tem planta salva");
  return validationFor(tenantId, barracaoId, saved);
}

/** Todas as plantas do tenant válidas; usado para liberar o motor físico. */
export async function validateAllFloorPlans(tenantId: string) {
  const plans = await loadFloorPlanSpecs(tenantId);
  const results = await Promise.all(
    plans.map(async (p) => ({ barracaoId: p.barracaoId, validation: await validationFor(tenantId, p.barracaoId, p) })),
  );
  return { plans: results, ok: plans.length > 0 && results.every((r) => r.validation.ok) };
}

function locationLabel(loc: { barcode: string }) {
  return loc.barcode;
}

export async function previewFloorPlanRoute(
  tenantId: string,
  barracaoId: string,
  input: { locationIds?: string[]; orderId?: string; draft?: FloorPlanDraft },
) {
  await assertBarracao(tenantId, barracaoId);
  let plan: FloorPlanSpec | undefined;
  if (input.draft) plan = sanitizeDraft(barracaoId, input.draft);
  else [plan] = await loadFloorPlanSpecs(tenantId, barracaoId);
  if (!plan) throw new Error("Barracão ainda não tem planta salva");

  let locationIds = (input.locationIds ?? []).filter(Boolean);
  let orderLabel: string | null = null;
  if (input.orderId) {
    const order = await prisma.order.findFirst({
      where: { tenantId, OR: [{ id: input.orderId }, { erpOrderId: input.orderId }] },
      select: { erpOrderId: true, items: { select: { pickLocationId: true } } },
    });
    if (!order) throw new Error("Pedido não encontrado");
    orderLabel = order.erpOrderId;
    locationIds = order.items.map((i) => i.pickLocationId).filter((id): id is string => Boolean(id));
  }
  if (locationIds.length === 0) throw new Error("Informe localizações ou um pedido com itens alocados");
  if (locationIds.length > 200) throw new Error("Máximo de 200 localizações na simulação");

  const locations = await prisma.location.findMany({
    where: { tenantId, id: { in: [...new Set(locationIds)] } },
    select: { id: true, corridor: true, row: true, face: true, barcode: true, estanteId: true },
  });

  const slots = await loadGondolaSlots(tenantId, gondolaEstanteIds([plan]));
  const rt = new PlanRuntime(plan, slots);
  const engine = new PhysicalRouteEngine([rt]);
  const sorted = engine.sortByRoute(locations);

  const toXY = (cell: number) => [cell % rt.grid.width, Math.floor(cell / rt.grid.width)] as const;
  const stops: Array<{ locationId: string; label: string; x: number; y: number; distanceMeters: number }> = [];
  const unmapped: string[] = [];
  const path: Array<readonly [number, number]> = [];
  let current = rt.startCell;
  let totalSteps = 0;

  for (const loc of sorted) {
    const point = engine.locate(loc);
    if (!point) {
      unmapped.push(locationLabel(loc));
      continue;
    }
    const segment = current >= 0 ? rt.path(current, point.cell) : [point.cell];
    const steps = Math.max(0, segment.length - 1);
    totalSteps += steps;
    path.push(...segment.slice(path.length ? 1 : 0).map(toXY));
    const [x, y] = toXY(point.cell);
    stops.push({ locationId: loc.id, label: locationLabel(loc), x, y, distanceMeters: steps * rt.metersPerCell });
    current = point.cell;
  }

  let toPackingMeters: number | null = null;
  if (current >= 0 && rt.packingCell >= 0) {
    const segment = rt.path(current, rt.packingCell);
    if (segment.length) {
      totalSteps += segment.length - 1;
      toPackingMeters = (segment.length - 1) * rt.metersPerCell;
      path.push(...segment.slice(1).map(toXY));
    }
  }

  return {
    orderLabel,
    stops,
    unmapped,
    path,
    toPackingMeters,
    totalMeters: totalSteps * rt.metersPerCell,
  };
}
