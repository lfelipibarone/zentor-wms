import { createHash } from "node:crypto";
import type { Order } from "@prisma/client";
import {
  buildOrderPickProfiles,
  orderUrgencyScore,
  profileProximityDistance,
  sortOrdersByUrgency,
  type OrderPickProfile,
} from "./pick-wave-order-profile.js";
import type { OrderWithItems } from "./pick-wave-partition.js";
import { sortLocationsByRoute } from "./location-route.js";

export type ProximityClusterOptions = {
  maxDistance: number;
  maxOrdersPerCluster?: number;
  maxClusters?: number;
};

export type ProximityCluster<T extends Order = OrderWithItems> = {
  id: string;
  orders: T[];
  orderIds: string[];
  routeHint: string;
  proximityScore: number;
};

function stableClusterId(orderIds: string[]): string {
  const sorted = [...orderIds].sort();
  return createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 12);
}

function clusterRouteHint(profiles: OrderPickProfile[]): string {
  if (profiles.length === 0) return "—";
  const hints = profiles.map((p) => p.routeHint);
  const unique = [...new Set(hints)];
  return unique.length === 1 ? unique[0]! : `${unique[0]} (+${unique.length - 1})`;
}

export function clusterOrdersByProximity<T extends OrderWithItems>(
  orders: T[],
  profiles: Map<string, OrderPickProfile>,
  opts: ProximityClusterOptions,
): ProximityCluster<T>[] {
  if (orders.length === 0) return [];

  const sorted = sortOrdersByUrgency(orders);
  const assigned = new Set<string>();
  const clusters: ProximityCluster<T>[] = [];
  const maxPer = opts.maxOrdersPerCluster ?? 8;
  const maxClusters = opts.maxClusters ?? 10;

  for (const seed of sorted) {
    if (assigned.has(seed.id)) continue;
    if (clusters.length >= maxClusters) break;

    const seedProfile = profiles.get(seed.id);
    if (!seedProfile) continue;

    const group: T[] = [seed];
    assigned.add(seed.id);
    let centroid = { ...seedProfile.centroid };

    let changed = true;
    while (changed && group.length < maxPer) {
      changed = false;
      for (const candidate of sorted) {
        if (assigned.has(candidate.id)) continue;
        const cp = profiles.get(candidate.id);
        if (!cp) continue;
        const dist = profileProximityDistance(
          { ...seedProfile, centroid },
          cp,
        );
        if (dist <= opts.maxDistance) {
          group.push(candidate);
          assigned.add(candidate.id);
          centroid = {
            corridor: Math.round(
              (centroid.corridor * (group.length - 1) + cp.centroid.corridor) /
                group.length,
            ),
            row: Math.round(
              (centroid.row * (group.length - 1) + cp.centroid.row) /
                group.length,
            ),
          };
          changed = true;
          if (group.length >= maxPer) break;
        }
      }
    }

    const groupProfiles = group
      .map((o) => profiles.get(o.id))
      .filter((p): p is OrderPickProfile => !!p);
    const avgDist =
      groupProfiles.length <= 1
        ? 0
        : groupProfiles.reduce((s, p, i, arr) => {
            if (i === 0) return 0;
            return (
              s + profileProximityDistance(arr[0]!, p) / (groupProfiles.length - 1)
            );
          }, 0);

    clusters.push({
      id: stableClusterId(group.map((o) => o.id)),
      orders: group,
      orderIds: group.map((o) => o.id),
      routeHint: clusterRouteHint(groupProfiles),
      proximityScore: Math.max(0, opts.maxDistance - avgDist),
    });
  }

  return clusters;
}

/** Ordena pedidos por vizinho mais próximo (greedy TSP) dentro de faixas de urgência. */
export function sortOrdersByPickProximity<T extends OrderWithItems>(
  orders: T[],
  profiles: Map<string, OrderPickProfile>,
): T[] {
  if (orders.length <= 1) return [...orders];

  const buckets = new Map<number, T[]>();
  for (const o of orders) {
    const key = orderUrgencyScore(o);
    const list = buckets.get(key) ?? [];
    list.push(o);
    buckets.set(key, list);
  }

  const keys = [...buckets.keys()].sort((a, b) => b - a);
  const out: T[] = [];

  for (const key of keys) {
    const bucket = buckets.get(key)!;
    const remaining = [...bucket];
    const profiled = remaining.filter((o) => profiles.has(o.id));
    const unprofiled = remaining.filter((o) => !profiles.has(o.id));

    let current = profiled.shift()!;
    out.push(current);
    while (profiled.length > 0) {
      const cp = profiles.get(current.id)!;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < profiled.length; i++) {
        const d = profileProximityDistance(cp, profiles.get(profiled[i]!.id)!);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      current = profiled.splice(bestIdx, 1)[0]!;
      out.push(current);
    }
    out.push(...unprofiled);
  }

  return out;
}

export async function buildPickProximityGroups(
  tenantId: string,
  orders: OrderWithItems[],
  opts?: { maxDistance?: number; maxGroups?: number; maxOrdersPerGroup?: number },
): Promise<ProximityCluster<OrderWithItems>[]> {
  const profiles = await buildOrderPickProfiles(tenantId, orders);
  const eligible = orders.filter((o) => profiles.has(o.id));
  return clusterOrdersByProximity(eligible, profiles, {
    maxDistance: opts?.maxDistance ?? 2,
    maxClusters: opts?.maxGroups ?? 10,
    maxOrdersPerCluster: opts?.maxOrdersPerGroup ?? 8,
  });
}

export function orderProximityNeighborCount(
  orderId: string,
  clusters: ProximityCluster[],
): number {
  for (const g of clusters) {
    if (g.orderIds.includes(orderId)) {
      return Math.max(0, g.orderIds.length - 1);
    }
  }
  return 0;
}

export function sortOrderItemsByRoute<
  T extends { pickLocation: { corridor: string; row: string } | null },
>(items: T[]): T[] {
  const withLoc = items.filter((i) => i.pickLocation);
  const without = items.filter((i) => !i.pickLocation);
  const sortedLocs = sortLocationsByRoute(
    withLoc.map((i) => i.pickLocation!),
  );
  const ordered: T[] = [];
  for (const loc of sortedLocs) {
    const match = withLoc.find(
      (i) =>
        i.pickLocation!.corridor === loc.corridor &&
        i.pickLocation!.row === loc.row,
    );
    if (match && !ordered.includes(match)) ordered.push(match);
  }
  return [...ordered, ...without];
}
