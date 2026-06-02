import { LocationType, type Order, type OrderItem } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  locationDistance,
  toRouteCoord,
  type RouteCoord,
} from "./location-route.js";
import type { OrderWithItems } from "./pick-wave-partition.js";

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
};

function formatRouteHint(coords: RouteCoord[], refs: PickLocationRef[]): string {
  if (refs.length === 0) return "—";
  const corridors = [...new Set(refs.map((r) => r.corridor))].sort();
  const rows = refs.map((r) => parseInt(r.row, 10)).filter((n) => !Number.isNaN(n));
  const minRow = rows.length ? Math.min(...rows) : 0;
  const maxRow = rows.length ? Math.max(...rows) : 0;
  const c = corridors.slice(0, 3).join(", ");
  if (corridors.length === 1) {
    return minRow === maxRow
      ? `Corredor ${corridors[0]} · fileira ${String(minRow).padStart(2, "0")}`
      : `Corredor ${corridors[0]} · fileiras ${String(minRow).padStart(2, "0")}–${String(maxRow).padStart(2, "0")}`;
  }
  return `Corredores ${c}`;
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
      if (it.quantityOrdered - it.quantityPicked > 0) ids.add(it.productId);
    }
  }
  return [...ids];
}

export async function buildOrderPickProfiles(
  tenantId: string,
  orders: OrderWithItems[],
): Promise<Map<string, OrderPickProfile>> {
  const productIds = pendingProductIds(orders);
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
            currentQuantity: true,
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
    list.sort((a, b) => a.currentQuantity - b.currentQuantity);
  }

  const result = new Map<string, OrderPickProfile>();

  for (const order of orders) {
    const pendingItems = order.items.filter(
      (it) => it.quantityOrdered - it.quantityPicked > 0,
    );
    const distinct = [...new Set(pendingItems.map((it) => it.productId))];
    const refs: PickLocationRef[] = [];
    const coordList: RouteCoord[] = [];
    const locIdSet = new Set<string>();

    for (const it of pendingItems) {
      let loc: (typeof locations)[0] | undefined;
      if (it.pickLocationId) {
        loc = locations.find((l) => l.id === it.pickLocationId);
      }
      if (!loc) {
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
      routeHint: formatRouteHint(coordList, refs),
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

/** Distância entre perfis (Manhattan + bônus se compartilham pick face). */
export function profileProximityDistance(
  a: OrderPickProfile,
  b: OrderPickProfile,
): number {
  let d = locationDistance(a.centroid, b.centroid);
  const shared = a.pickLocationIds.some((id) => b.pickLocationIds.includes(id));
  if (shared) d = Math.max(0, d - 1);
  return d;
}
