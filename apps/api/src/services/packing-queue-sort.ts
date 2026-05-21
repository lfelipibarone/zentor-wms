import { computeOrderPriority } from "./marketplace-priority.js";
import {
  locationDistance,
  sortLocationsByRoute,
  toRouteCoord,
  type LocationLike,
  type RouteCoord,
} from "./location-route.js";

export type PackingSortItem = {
  id: string;
  erpOrderId: string;
  priority: number;
  collectionDeadline: Date | null;
  marketplace: string | null;
  items: Array<{
    quantityPicked: number;
    pickLocation: LocationLike | null;
  }>;
};

export type WaveLineSortItem = {
  id: string;
  waveUrgency: number;
  collectionDeadline: Date | null;
  pickLocation: LocationLike;
};

function isCollectionToday(deadline: Date | null, now: Date): boolean {
  if (!deadline) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return deadline >= start && deadline <= end;
}

/** Urgência 0–100 para fila de packing (reusa computeOrderPriority + bônus coleta hoje). */
export function scorePackingUrgency(
  order: Pick<
    PackingSortItem,
    "collectionDeadline" | "marketplace" | "priority"
  >,
  now = new Date(),
): number {
  let score = computeOrderPriority({
    collectionDeadline: order.collectionDeadline,
    marketplace: order.marketplace,
  });
  if (order.priority > score) score = order.priority;

  if (isCollectionToday(order.collectionDeadline, now)) {
    score += 5;
    if (order.collectionDeadline) {
      const hoursUntil =
        (order.collectionDeadline.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntil <= 0) score = Math.min(100, score + 15);
      else if (hoursUntil <= 2) score = Math.min(100, score + 10);
    }
  }
  return Math.min(100, score);
}

export function formatRouteLabel(
  loc: LocationLike & { barcode?: string },
): string {
  return loc.barcode
    ? `${loc.corridor}-${loc.row} · ${loc.barcode}`
    : `${loc.corridor}-${loc.row}`;
}

/** Primeira gôndola na rota entre itens já separados. */
export function orderRouteAnchor(
  items: PackingSortItem["items"],
): { coord: RouteCoord; label: string } | null {
  const locs = items
    .filter((i) => i.quantityPicked > 0 && i.pickLocation)
    .map((i) => i.pickLocation!);
  if (locs.length === 0) {
    const any = items.find((i) => i.pickLocation)?.pickLocation;
    if (!any) return null;
    return { coord: toRouteCoord(any), label: formatRouteLabel(any) };
  }
  const sorted = sortLocationsByRoute(locs);
  const first = sorted[0]!;
  return { coord: toRouteCoord(first), label: formatRouteLabel(first) };
}

export function comparePackingOrders(
  a: PackingSortItem,
  b: PackingSortItem,
  now = new Date(),
  cursor?: RouteCoord | null,
): number {
  const urgA = scorePackingUrgency(a, now);
  const urgB = scorePackingUrgency(b, now);
  if (urgB !== urgA) return urgB - urgA;

  if (cursor) {
    const anchorA = orderRouteAnchor(a.items);
    const anchorB = orderRouteAnchor(b.items);
    const distA = anchorA
      ? locationDistance(cursor, anchorA.coord)
      : Number.MAX_SAFE_INTEGER;
    const distB = anchorB
      ? locationDistance(cursor, anchorB.coord)
      : Number.MAX_SAFE_INTEGER;
    if (distA !== distB) return distA - distB;
  }

  const dlA = a.collectionDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const dlB = b.collectionDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (dlA !== dlB) return dlA - dlB;

  return a.erpOrderId.localeCompare(b.erpOrderId);
}

export function sortPackingOrders<T extends PackingSortItem>(
  orders: T[],
  now = new Date(),
): T[] {
  const sorted = [...orders];
  sorted.sort((a, b) => comparePackingOrders(a, b, now));
  let cursor: RouteCoord | null = null;
  const result: T[] = [];
  const remaining = new Set(sorted.map((o) => o.id));

  while (remaining.size > 0) {
    let best: T | null = null;
    let bestCmp = 0;
    for (const o of sorted) {
      if (!remaining.has(o.id)) continue;
      const cmp = comparePackingOrders(o, best ?? o, now, cursor);
      if (!best || cmp < 0) {
        best = o;
        bestCmp = cmp;
      }
    }
    if (!best) break;
    remaining.delete(best.id);
    result.push(best);
    const anchor = orderRouteAnchor(best.items);
    if (anchor) cursor = anchor.coord;
    void bestCmp;
  }
  return result;
}

export function compareWavePackingLines(
  a: WaveLineSortItem,
  b: WaveLineSortItem,
  cursor?: RouteCoord | null,
): number {
  if (b.waveUrgency !== a.waveUrgency) return b.waveUrgency - a.waveUrgency;

  if (cursor) {
    const coordA = toRouteCoord(a.pickLocation);
    const coordB = toRouteCoord(b.pickLocation);
    const distA = locationDistance(cursor, coordA);
    const distB = locationDistance(cursor, coordB);
    if (distA !== distB) return distA - distB;
  } else {
    const cA = toRouteCoord(a.pickLocation);
    const cB = toRouteCoord(b.pickLocation);
    if (cA.corridor !== cB.corridor) return cA.corridor - cB.corridor;
    if (cA.row !== cB.row) return cA.row - cB.row;
  }

  const dlA = a.collectionDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const dlB = b.collectionDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (dlA !== dlB) return dlA - dlB;

  return a.id.localeCompare(b.id);
}

export function sortWavePackingLines<T extends WaveLineSortItem>(
  lines: T[],
): T[] {
  const sorted = [...lines];
  sorted.sort((a, b) => compareWavePackingLines(a, b));
  let cursor: RouteCoord | null = null;
  const result: T[] = [];
  const remaining = new Set(sorted.map((l) => l.id));

  while (remaining.size > 0) {
    let best: T | null = null;
    for (const l of sorted) {
      if (!remaining.has(l.id)) continue;
      const cmp = best ? compareWavePackingLines(l, best, cursor) : -1;
      if (!best || cmp < 0) best = l;
    }
    if (!best) break;
    remaining.delete(best.id);
    result.push(best);
    cursor = toRouteCoord(best.pickLocation);
  }
  return result;
}

export function aggregateWaveUrgency(
  orders: Array<{
    priority: number;
    collectionDeadline: Date | null;
    marketplace: string | null;
  }>,
  now = new Date(),
): { waveUrgency: number; collectionDeadline: Date | null } {
  let waveUrgency = 0;
  let collectionDeadline: Date | null = null;

  for (const o of orders) {
    const u = scorePackingUrgency(o, now);
    if (u > waveUrgency) waveUrgency = u;
    if (o.collectionDeadline) {
      if (
        !collectionDeadline ||
        o.collectionDeadline.getTime() < collectionDeadline.getTime()
      ) {
        collectionDeadline = o.collectionDeadline;
      }
    }
  }
  return { waveUrgency, collectionDeadline };
}
