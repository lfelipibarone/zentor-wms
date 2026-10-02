import type { WarehouseFloorElement } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { elementEstanteIds, sortSlotCodes } from "./access-points.js";
import { LegacyRouteEngine } from "./legacy-engine.js";
import { PhysicalRouteEngine, PlanRuntime } from "./physical-engine.js";
import type {
  Face,
  GondolaSlots,
  FloorElementSpec,
  FloorPlanSpec,
  RouteEngine,
  RouteEngineKind,
} from "./types.js";

export type {
  FaceSlots,
  GondolaSlots,
  FloorElementSpec,
  FloorPlanSpec,
  RoutableLocation,
  RouteEngine,
  RouteEngineKind,
} from "./types.js";
export { LegacyRouteEngine } from "./legacy-engine.js";
export { PhysicalRouteEngine, PlanRuntime } from "./physical-engine.js";
export { pickNextItemByEngine, sortPendingItemsByEngine } from "./route-helpers.js";

export const ROUTING_ENGINE_KEY = "routing.engine";
const CACHE_TTL_MS = 30_000;

const legacyEngine = new LegacyRouteEngine();
const cache = new Map<string, { engine: RouteEngine; expiresAt: number }>();

export function invalidateRouteEngine(tenantId: string): void {
  cache.delete(tenantId);
}

export async function getRoutingEngineKind(tenantId: string): Promise<RouteEngineKind> {
  const row = await prisma.systemSetting.findUnique({
    where: { tenantId_key: { tenantId, key: ROUTING_ENGINE_KEY } },
    select: { value: true },
  });
  return row?.value === "PHYSICAL" ? "PHYSICAL" : "LEGACY";
}

export function toElementSpec(e: WarehouseFloorElement): FloorElementSpec {
  return {
    id: e.id,
    type: e.type,
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    rotation: e.rotation,
    estanteId: e.estanteId,
    estanteIdB: e.estanteIdB,
    faceAEnabled: e.faceAEnabled,
    faceBEnabled: e.faceBEnabled,
    colunaReversedA: e.colunaReversedA,
    colunaReversedB: e.colunaReversedB,
    colunaMinA: e.colunaMinA,
    colunaMaxA: e.colunaMaxA,
    colunaMinB: e.colunaMinB,
    colunaMaxB: e.colunaMaxB,
    label: e.label,
  };
}

/** Colunas de cada lado (LD = A, LE = B) de cada estante, em ordem numérica. */
export async function loadGondolaSlots(
  tenantId: string,
  estanteIds: string[],
): Promise<GondolaSlots> {
  const slots: GondolaSlots = new Map();
  if (estanteIds.length === 0) return slots;
  const linhas = await prisma.warehouseLinha.findMany({
    where: { tenantId, coluna: { estanteId: { in: estanteIds } } },
    select: { face: true, coluna: { select: { code: true, estanteId: true } } },
    distinct: ["colunaId", "face"],
  });
  const codes = new Map<string, Record<Face, string[]>>();
  for (const l of linhas) {
    const id = l.coluna.estanteId;
    const entry = codes.get(id) ?? { A: [], B: [] };
    entry[l.face === "B" ? "B" : "A"].push(l.coluna.code);
    codes.set(id, entry);
  }
  for (const [id, entry] of codes) {
    slots.set(id, { A: sortSlotCodes(entry.A), B: sortSlotCodes(entry.B) });
  }
  return slots;
}

export async function loadFloorPlanSpecs(
  tenantId: string,
  barracaoId?: string,
): Promise<FloorPlanSpec[]> {
  const plans = await prisma.warehouseFloorPlan.findMany({
    where: { tenantId, ...(barracaoId ? { barracaoId } : {}) },
    include: { elements: true },
  });
  return plans.map((p) => ({
    id: p.id,
    barracaoId: p.barracaoId,
    cellSizeCm: p.cellSizeCm,
    widthCells: p.widthCells,
    heightCells: p.heightCells,
    version: p.version,
    elements: p.elements.map(toElementSpec),
  }));
}

export function gondolaEstanteIds(plans: FloorPlanSpec[]): string[] {
  const ids = new Set<string>();
  for (const p of plans) {
    for (const e of p.elements) {
      for (const id of elementEstanteIds(e)) ids.add(id);
    }
  }
  return [...ids];
}

export async function buildPhysicalEngine(tenantId: string): Promise<PhysicalRouteEngine> {
  const plans = await loadFloorPlanSpecs(tenantId);
  const slots = await loadGondolaSlots(tenantId, gondolaEstanteIds(plans));
  return new PhysicalRouteEngine(plans.map((p) => new PlanRuntime(p, slots)));
}

/**
 * Motor de rota do tenant. `LEGACY` (padrão) usa corredor/linha; `PHYSICAL` usa a planta
 * e recorre ao legado para localizações fora do mapa.
 */
export async function getRouteEngine(tenantId: string): Promise<RouteEngine> {
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.engine;

  const kind = await getRoutingEngineKind(tenantId);
  const engine = kind === "PHYSICAL" ? await buildPhysicalEngine(tenantId) : legacyEngine;
  cache.set(tenantId, { engine, expiresAt: Date.now() + CACHE_TTL_MS });
  return engine;
}
