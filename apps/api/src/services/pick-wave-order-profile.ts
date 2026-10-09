import { LocationType, type Order, type OrderItem } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  locationDistance,
  toRouteCoord,
  type RouteCoord,
} from "./location-route.js";
import type { OrderWithItems } from "./pick-wave-partition.js";
import { getRouteEngine } from "./route-engine/index.js";
import type { RoutableLocation, RouteEngine } from "./route-engine/types.js";

export type PickLocationRef = {
  locationId: string;
  barcode: string;
  corridor: string;
  row: string;
};

export type OrderPickProfile = {
  orderId: string;
  distinctProductIds: string[];
  isSingleItem: boolean;
  singleProductId: string | null;
  pickLocationIds: string[];
  coords: RouteCoord[];
  centroid: RouteCoord;
  routeHint: string;
  /** Gôndolas que o pedido visita (para descrever a região de um grupo) */
  locationRefs?: PickLocationRef[];
  /** Mapa físico: localização do pedido mais central (medoide) e a distância em metros do motor. */
  routeAnchor?: RoutableLocation;
  routeDistance?: (a: RoutableLocation, b: RoutableLocation) => number;
};

/** Localização que minimiza a soma das distâncias até as demais do pedido. */
function medoid(engine: RouteEngine, locs: RoutableLocation[]): RoutableLocation | undefined {
  if (locs.length <= 2) return locs[0];
  let best = locs[0];
  let bestSum = Infinity;
  for (const a of locs) {
    let sum = 0;
    for (const b of locs) if (a !== b) sum += engine.distance(a, b);
    if (sum < bestSum) {
      bestSum = sum;
      best = a;
    }
  }
  return best;
}

export function profilesUsePhysicalDistance(profiles: Map<string, OrderPickProfile>): boolean {
  for (const p of profiles.values()) if (p.routeDistance) return true;
  return false;
}

/** Limite de proximidade na unidade dos perfis: metros (mapa físico) ou Manhattan (legado). */
export function proximityLimitFor(
  profiles: Map<string, OrderPickProfile>,
  settings: { proximityMaxDistance: number; proximityMaxDistanceMeters?: number },
): number {
  return profilesUsePhysicalDistance(profiles)
    ? (settings.proximityMaxDistanceMeters ?? 10)
    : settings.proximityMaxDistance;
}

export function formatRouteHint(refs: PickLocationRef[]): string {
  if (refs.length === 0) return "—";
  const corridors = [...new Set(refs.map((r) => r.corridor))].sort();
  const rows = refs.map((r) => parseInt(r.row, 10)).filter((n) => !Number.isNaN(n));
  const minRow = rows.length ? Math.min(...rows) : 0;
  const maxRow = rows.length ? Math.max(...rows) : 0;
  const c = corridors.slice(0, 3).join(", ");
  if (corridors.length === 1) {
    return minRow === maxRow
      ? `Corredor ${corridors[0]} · linha ${String(minRow).padStart(2, "0")}`
      : `Corredor ${corridors[0]} · linhas ${String(minRow).padStart(2, "0")}–${String(maxRow).padStart(2, "0")}`;
  }
  return corridors.length > 3
    ? `Corredores ${c} (+${corridors.length - 3})`
    : `Corredores ${c}`;
}

function averageCoord(coords: RouteCoord[]): RouteCoord {
  if (coords.length === 0) return { corridor: 0, row: 0 };
  const sum = coords.reduce(
    (acc, c) => ({ corridor: acc.corridor + c.corridor, row: acc.row + c.row }),
    { corridor: 0, row: 0 },
  );
  return {
    corridor: Math.round(sum.corridor / coords.length),
    row: Math.round(sum.row / coords.length),
  };
}

function pendingProductIds(orders: OrderWithItems[]): string[] {
  const ids = new Set<string>();
  for (const o of orders) {
    for (const it of o.items) {
      if (it.quantityOrdered - it.quantityPicked > 0 && it.productId) {
        ids.add(it.productId);
      }
    }
  }
  return [...ids];
}

export async function buildOrderPickProfiles(
  tenantId: string,
  orders: OrderWithItems[],
): Promise<Map<string, OrderPickProfile>> {
  const productIds = pendingProductIds(orders);
  const engine = await getRouteEngine(tenantId);
  const physical = engine.kind === "PHYSICAL";
  const routeDistance = physical
    ? (a: RoutableLocation, b: RoutableLocation) => engine.distance(a, b)
    : undefined;
  const locations =
    productIds.length > 0
      ? await prisma.location.findMany({
          where: {
            tenantId,
            active: true,
            type: LocationType.PICK_FACE,
            productId: { in: productIds },
          },
          select: {
            id: true,
            productId: true,
            barcode: true,
            corridor: true,
            row: true,
            estanteId: true,
            face: true,
            fillPercent: true,
          },
        })
      : [];

  const facesByProduct = new Map<string, typeof locations>();
  for (const loc of locations) {
    if (!loc.productId) continue;
    const list = facesByProduct.get(loc.productId) ?? [];
    list.push(loc);
    facesByProduct.set(loc.productId, list);
  }
  for (const list of facesByProduct.values()) {
    // mesma regra do pick: gôndolas com produto primeiro, a mais vazia antes
    list.sort(
      (a, b) =>
        Number(a.fillPercent <= 0) - Number(b.fillPercent <= 0) || a.fillPercent - b.fillPercent,
    );
  }

  const result = new Map<string, OrderPickProfile>();

  for (const order of orders) {
    const pendingItems = order.items.filter(
      (it) => it.quantityOrdered - it.quantityPicked > 0,
    );
    const distinct = [
      ...new Set(
        pendingItems
          .map((it) => it.productId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const refs: PickLocationRef[] = [];
    const coordList: RouteCoord[] = [];
    const routeLocs: RoutableLocation[] = [];
    const locIdSet = new Set<string>();

    for (const it of pendingItems) {
      let loc: (typeof locations)[0] | undefined;
      if (it.pickLocationId) {
        loc = locations.find((l) => l.id === it.pickLocationId);
      }
      if (!loc && it.productId) {
        const faces = facesByProduct.get(it.productId);
        loc = faces?.[0];
      }
      if (!loc) continue;
      if (!locIdSet.has(loc.id)) {
        locIdSet.add(loc.id);
        refs.push({
          locationId: loc.id,
          barcode: loc.barcode,
          corridor: loc.corridor,
          row: loc.row,
        });
        coordList.push(toRouteCoord(loc));
        routeLocs.push(loc);
      }
    }

    const centroid = averageCoord(coordList);
    result.set(order.id, {
      orderId: order.id,
      distinctProductIds: distinct,
      isSingleItem: distinct.length === 1,
      singleProductId: distinct.length === 1 ? distinct[0]! : null,
      pickLocationIds: [...locIdSet],
      coords: coordList,
      centroid,
      routeHint: formatRouteHint(refs),
      locationRefs: refs,
      ...(physical && routeLocs.length > 0
        ? { routeAnchor: medoid(engine, routeLocs), routeDistance }
        : {}),
    });
  }

  return result;
}

export function orderUrgencyScore(o: Order): number {
  const deadline = o.collectionDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return o.priority * 1_000_000_000_000 - deadline;
}

export function sortOrdersByUrgency<T extends Order>(orders: T[]): T[] {
  return [...orders].sort((a, b) => orderUrgencyScore(b) - orderUrgencyScore(a));
}

/** Distância entre perfis (metros no mapa físico, senão Manhattan) com bônus se compartilham pick face. */
export function profileProximityDistance(
  a: OrderPickProfile,
  b: OrderPickProfile,
): number {
  const physical = a.routeDistance && a.routeAnchor && b.routeAnchor;
  let d = physical
    ? a.routeDistance!(a.routeAnchor!, b.routeAnchor!)
    : locationDistance(a.centroid, b.centroid);
  const shared = a.pickLocationIds.some((id) => b.pickLocationIds.includes(id));
  if (shared) d = Math.max(0, d - 1);
  return d;
}
