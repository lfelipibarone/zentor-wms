import {
  accessKey,
  buildAccessIndex,
  normalizeFace,
  type AccessPoint,
} from "./access-points.js";
import { colunaFromRow } from "../location-route.js";
import {
  buildFloorGrid,
  elementAnchorCell,
  isWalkable,
  perimeterCell,
  type FloorGrid,
} from "./floor-grid.js";
import { LegacyRouteEngine } from "./legacy-engine.js";
import { DistanceFieldCache, tracePath } from "./pathfinding.js";
import { solveOpenTour } from "./tour.js";
import type {
  GondolaSlots,
  FloorPlanSpec,
  RoutableLocation,
  RouteEngine,
  RouteOrigin,
  RoutePoint,
} from "./types.js";

/** Penalidade (m) quando um dos lados não está no mapa ou fica em outro barracão. */
export const UNMAPPED_PENALTY_METERS = 500;

export class PlanRuntime {
  readonly grid: FloorGrid;
  readonly cache: DistanceFieldCache;
  readonly accessByKey: Map<string, AccessPoint>;
  readonly accessPoints: AccessPoint[];
  readonly startCell: number;
  readonly packingCell: number;
  /** Onde a armazenagem começa: área de recebimento, senão doca, senão início. */
  readonly receivingCell: number;
  readonly metersPerCell: number;

  constructor(
    readonly plan: FloorPlanSpec,
    slots: GondolaSlots,
  ) {
    this.grid = buildFloorGrid(plan);
    this.cache = new DistanceFieldCache(this.grid);
    const index = buildAccessIndex(this.grid, plan.elements, slots);
    this.accessByKey = index.byKey;
    this.accessPoints = index.points;
    const start = plan.elements.find((e) => e.type === "START_POINT");
    const packing = plan.elements.find((e) => e.type === "PACKING_POINT");
    const receiving = plan.elements.find((e) => e.type === "RECEIVING_AREA");
    const dock = plan.elements.find((e) => e.type === "DOCK");
    this.startCell = start ? elementAnchorCell(this.grid, start) : -1;
    this.packingCell = packing ? elementAnchorCell(this.grid, packing) : -1;
    const receivingCell = receiving ? perimeterCell(this.grid, receiving) : -1;
    const dockCell = dock ? elementAnchorCell(this.grid, dock) : -1;
    this.receivingCell = receivingCell >= 0 ? receivingCell : dockCell >= 0 ? dockCell : this.startCell;
    this.metersPerCell = plan.cellSizeCm / 100;
  }

  originCell(origin: RouteOrigin = "START"): number {
    return origin === "RECEIVING" ? this.receivingCell : this.startCell;
  }

  isReachable(cell: number): boolean {
    if (!isWalkable(this.grid, cell)) return false;
    if (this.startCell < 0) return true;
    return this.cache.steps(this.startCell, cell) >= 0;
  }

  path(from: number, to: number): number[] {
    return tracePath(this.cache.get(from), to);
  }
}

export class PhysicalRouteEngine implements RouteEngine {
  readonly kind = "PHYSICAL" as const;
  private readonly runtimes = new Map<string, PlanRuntime>();
  private readonly runtimeByEstante = new Map<string, PlanRuntime>();
  private readonly legacy = new LegacyRouteEngine();

  constructor(runtimes: PlanRuntime[]) {
    for (const rt of runtimes) {
      this.runtimes.set(rt.plan.id, rt);
      for (const p of rt.accessPoints) this.runtimeByEstante.set(p.estanteId, rt);
    }
  }

  runtime(planId: string): PlanRuntime | undefined {
    return this.runtimes.get(planId);
  }

  runtimeForBarracao(barracaoId: string): PlanRuntime | undefined {
    for (const rt of this.runtimes.values()) {
      if (rt.plan.barracaoId === barracaoId) return rt;
    }
    return undefined;
  }

  locate(loc: RoutableLocation): RoutePoint | null {
    if (!loc.estanteId) return null;
    const rt = this.runtimeByEstante.get(loc.estanteId);
    if (!rt) return null;
    const point = rt.accessByKey.get(
      accessKey(loc.estanteId, colunaFromRow(loc.row), normalizeFace(loc.face)),
    );
    if (!point || !rt.isReachable(point.cell)) return null;
    return { planId: rt.plan.id, cell: point.cell };
  }

  distance(a: RoutableLocation, b: RoutableLocation): number {
    const pa = this.locate(a);
    const pb = this.locate(b);
    if (!pa && !pb) return this.legacy.distance(a, b);
    if (!pa || !pb || pa.planId !== pb.planId) return UNMAPPED_PENALTY_METERS;
    const rt = this.runtimes.get(pa.planId)!;
    const steps = rt.cache.steps(pa.cell, pb.cell);
    return steps < 0 ? UNMAPPED_PENALTY_METERS : steps * rt.metersPerCell;
  }

  sortByRoute<T extends RoutableLocation>(
    locations: T[],
    start?: RoutableLocation | null,
    from: RouteOrigin = "START",
  ): T[] {
    if (locations.length <= 1) return [...locations];

    const startPoint = start ? this.locate(start) : null;
    const groups = new Map<string, { loc: T; cell: number }[]>();
    const unmapped: T[] = [];
    for (const loc of locations) {
      const p = this.locate(loc);
      if (!p) {
        unmapped.push(loc);
        continue;
      }
      const list = groups.get(p.planId) ?? [];
      list.push({ loc, cell: p.cell });
      groups.set(p.planId, list);
    }

    const planOrder = [...groups.keys()];
    if (startPoint && groups.has(startPoint.planId)) {
      planOrder.splice(planOrder.indexOf(startPoint.planId), 1);
      planOrder.unshift(startPoint.planId);
    }

    const out: T[] = [];
    for (const planId of planOrder) {
      const rt = this.runtimes.get(planId)!;
      const nodes = groups.get(planId)!;
      const origin =
        startPoint && startPoint.planId === planId ? startPoint.cell : rt.originCell(from);
      const order = this.tour(rt, nodes.map((n) => n.cell), origin);
      for (const i of order) out.push(nodes[i]!.loc);
    }

    out.push(...this.legacy.sortByRoute(unmapped, start));
    return out;
  }

  /** Índices de `cells` na ordem de visita a partir de `origin` (-1 = sem partida). */
  tour(rt: PlanRuntime, cells: number[], origin: number): number[] {
    const steps = (a: number, b: number) => {
      const s = rt.cache.steps(a, b);
      return s < 0 ? Number.MAX_SAFE_INTEGER / 4 : s;
    };
    return solveOpenTour(
      cells.length,
      (i) => (origin >= 0 ? steps(origin, cells[i]!) : 0),
      (i, j) => steps(cells[i]!, cells[j]!),
    );
  }
}
