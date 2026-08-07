import type { Order, OrderItem } from "@prisma/client";
import {
  clusterOrdersByProximity,
  sortOrdersByPickProximity,
} from "./order-proximity.js";
import {
  profileProximityDistance,
  type OrderPickProfile,
} from "./pick-wave-order-profile.js";
import type { WaveSettings } from "./wave-settings.js";

export type OrderWithItems = Order & { items: OrderItem[] };

export type WavePartitionStrategy =
  | "SINGLE_ITEM"
  | "PROXIMITY"
  | "BY_PRODUCT";

export type WavePartitionSettings = {
  partitionEnabled: boolean;
  minOrdersPerWave: number;
  maxWavesPerBatch: number;
  strategy: WavePartitionStrategy;
  proximityMaxDistance: number;
};

export const BY_PRODUCT_MAX_DISTINCT_SKUS = 5;

export function pendingProductIds(order: OrderWithItems): Set<string> {
  const ids = new Set<string>();
  for (const it of order.items) {
    if (it.quantityOrdered - it.quantityPicked > 0 && it.productId) {
      ids.add(it.productId);
    }
  }
  return ids;
}

export function countPendingDistinctSkus(order: OrderWithItems): number {
  return pendingProductIds(order).size;
}

export function isEligibleForByProductWave(order: OrderWithItems): boolean {
  return countPendingDistinctSkus(order) <= BY_PRODUCT_MAX_DISTINCT_SKUS;
}

export type WaveExcludedReason =
  | "too_many_skus"
  | "no_link"
  | "below_min_wave"
  | "not_single_item";

export function getExcludedOrderDetails(
  allCandidates: OrderWithItems[],
  includedInWaves: OrderWithItems[][],
  strategy: WavePartitionStrategy,
): Array<{ orderId: string; reason: WaveExcludedReason }> {
  if (strategy !== "SINGLE_ITEM" && strategy !== "BY_PRODUCT") return [];
  const included = new Set(includedInWaves.flatMap((g) => g.map((o) => o.id)));
  const out: Array<{ orderId: string; reason: WaveExcludedReason }> = [];
  for (const o of allCandidates) {
    if (included.has(o.id)) continue;
    if (strategy === "BY_PRODUCT" && !isEligibleForByProductWave(o)) {
      out.push({ orderId: o.id, reason: "too_many_skus" });
    } else if (strategy === "SINGLE_ITEM") {
      out.push({ orderId: o.id, reason: "not_single_item" });
    } else {
      out.push({ orderId: o.id, reason: "no_link" });
    }
  }
  return out;
}

export function ordersSharePendingProduct(
  a: OrderWithItems,
  b: OrderWithItems,
): boolean {
  const aProducts = pendingProductIds(a);
  for (const p of pendingProductIds(b)) {
    if (aProducts.has(p)) return true;
  }
  return false;
}

export function ordersLinkedForWave(
  a: OrderWithItems,
  b: OrderWithItems,
  profiles: Map<string, OrderPickProfile>,
  maxDistance: number,
): boolean {
  if (ordersSharePendingProduct(a, b)) return true;
  const pa = profiles.get(a.id);
  const pb = profiles.get(b.id);
  if (!pa || !pb) return false;
  return profileProximityDistance(pa, pb) <= maxDistance;
}

export function findConnectedComponents(
  orders: OrderWithItems[],
  profiles: Map<string, OrderPickProfile>,
  maxDistance: number,
): OrderWithItems[][] {
  const visited = new Set<string>();
  const components: OrderWithItems[][] = [];

  for (const seed of orders) {
    if (visited.has(seed.id)) continue;
    const queue: OrderWithItems[] = [seed];
    const component: OrderWithItems[] = [];
    visited.add(seed.id);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      component.push(cur);
      for (const other of orders) {
        if (visited.has(other.id)) continue;
        if (ordersLinkedForWave(cur, other, profiles, maxDistance)) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }
    components.push(component);
  }

  return components;
}

export function orderLinksToAnyInGroup(
  order: OrderWithItems,
  group: OrderWithItems[],
  profiles: Map<string, OrderPickProfile>,
  maxDistance: number,
): boolean {
  return group.some((o) =>
    ordersLinkedForWave(order, o, profiles, maxDistance),
  );
}

export function partitionOrdersIntoWaves(
  orders: OrderWithItems[],
  settings: WavePartitionSettings,
  profiles?: Map<string, OrderPickProfile>,
): OrderWithItems[][] {
  return partitionOrders(orders, settings.strategy, settings, profiles);
}

export function partitionOrders(
  orders: OrderWithItems[],
  strategy: WavePartitionStrategy,
  settings: WavePartitionSettings,
  profiles?: Map<string, OrderPickProfile>,
): OrderWithItems[][] {
  if (orders.length === 0) return [];
  if (!settings.partitionEnabled) return [orders];

  switch (strategy) {
    case "SINGLE_ITEM":
      return partitionOrdersSingleItem(orders, settings, profiles);
    case "PROXIMITY":
      return partitionOrdersByProximity(orders, settings, profiles);
    case "BY_PRODUCT":
    default:
      return partitionOrdersByProduct(orders, settings, profiles);
  }
}

function mergeSmallGroups(
  groups: OrderWithItems[][],
  settings: WavePartitionSettings,
): OrderWithItems[][] {
  const out = [...groups];
  const unassigned: OrderWithItems[] = [];
  const assigned = new Set<string>();

  for (const g of out) {
    for (const o of g) assigned.add(o.id);
  }

  for (const g of out) {
    if (g.length < settings.minOrdersPerWave && out.length > 1) {
      for (const o of g) {
        if (!unassigned.find((x) => x.id === o.id)) unassigned.push(o);
      }
    }
  }

  const kept = out.filter((g) => g.length >= settings.minOrdersPerWave);
  if (unassigned.length > 0) {
    if (kept.length === 0) {
      kept.push(unassigned);
    } else if (unassigned.length >= settings.minOrdersPerWave) {
      kept.push(unassigned);
    } else {
      kept[kept.length - 1]!.push(...unassigned);
    }
  }

  return kept.slice(0, settings.maxWavesPerBatch);
}

function partitionOrdersSingleItem(
  orders: OrderWithItems[],
  settings: WavePartitionSettings,
  profiles?: Map<string, OrderPickProfile>,
): OrderWithItems[][] {
  const mono = orders.filter((o) => {
    const p = profiles?.get(o.id);
    if (p) return p.isSingleItem;
    const pending = o.items.filter(
      (it) => it.quantityOrdered - it.quantityPicked > 0,
    );
    const distinct = new Set(pending.map((it) => it.productId));
    return distinct.size === 1;
  });

  if (mono.length === 0) return [];

  const sorted = profiles
    ? sortOrdersByPickProximity(mono, profiles)
    : mono;

  const groups: OrderWithItems[][] = [];
  let batch: OrderWithItems[] = [];

  for (const o of sorted) {
    batch.push(o);
    if (batch.length >= settings.minOrdersPerWave) {
      groups.push(batch);
      batch = [];
      if (groups.length >= settings.maxWavesPerBatch) break;
    }
  }

  if (batch.length > 0 && groups.length < settings.maxWavesPerBatch) {
    if (groups.length === 0) {
      groups.push(batch);
    } else if (batch.length >= settings.minOrdersPerWave) {
      groups.push(batch);
    } else {
      groups[groups.length - 1]!.push(...batch);
    }
  }

  return groups.slice(0, settings.maxWavesPerBatch);
}

function partitionOrdersByProximity(
  orders: OrderWithItems[],
  settings: WavePartitionSettings,
  profiles?: Map<string, OrderPickProfile>,
): OrderWithItems[][] {
  if (!profiles || profiles.size === 0) {
    return partitionOrdersByProduct(orders, settings, profiles);
  }

  const clusters = clusterOrdersByProximity(orders, profiles, {
    maxDistance: settings.proximityMaxDistance,
    maxClusters: settings.maxWavesPerBatch,
    maxOrdersPerCluster: Math.max(settings.minOrdersPerWave, 50),
  });

  const groups = clusters
    .map((c) =>
      profiles
        ? sortOrdersByPickProximity(c.orders, profiles)
        : c.orders,
    )
    .filter((g) => g.length >= 1);

  return mergeSmallGroups(groups, settings);
}

function buildComponentIndex(
  orders: OrderWithItems[],
  profiles: Map<string, OrderPickProfile>,
  maxDistance: number,
): Map<string, OrderWithItems[]> {
  const index = new Map<string, OrderWithItems[]>();
  for (const comp of findConnectedComponents(orders, profiles, maxDistance)) {
    for (const o of comp) {
      index.set(o.id, comp);
    }
  }
  return index;
}

function partitionOrdersByProduct(
  orders: OrderWithItems[],
  settings: WavePartitionSettings,
  profiles?: Map<string, OrderPickProfile>,
): OrderWithItems[][] {
  const eligible = orders.filter(isEligibleForByProductWave);
  const profileMap = profiles ?? new Map<string, OrderPickProfile>();
  const componentByOrderId = buildComponentIndex(
    eligible,
    profileMap,
    settings.proximityMaxDistance,
  );

  const assigned = new Set<string>();
  const groups: OrderWithItems[][] = [];

  while (groups.length < settings.maxWavesPerBatch) {
    const productCounts = new Map<string, number>();
    for (const order of eligible) {
      if (assigned.has(order.id)) continue;
      for (const pid of pendingProductIds(order)) {
        productCounts.set(pid, (productCounts.get(pid) ?? 0) + 1);
      }
    }
    if (productCounts.size === 0) break;

    const products = [...productCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    );

    let formed = false;
    for (const [productId] of products) {
      const seed = eligible.find(
        (o) =>
          !assigned.has(o.id) && pendingProductIds(o).has(productId),
      );
      if (!seed) continue;

      const component = componentByOrderId.get(seed.id);
      if (!component) continue;

      const waveOrders = component.filter((o) => !assigned.has(o.id));
      if (waveOrders.length < settings.minOrdersPerWave) continue;

      const sorted =
        profileMap.size > 0
          ? sortOrdersByPickProximity(waveOrders, profileMap)
          : waveOrders;

      for (const o of sorted) assigned.add(o.id);
      groups.push(sorted);
      formed = true;
      break;
    }

    if (!formed) break;
  }

  return groups;
}

export function waveSettingsToPartition(
  settings: WaveSettings & {
    partitionEnabled?: boolean;
    minOrdersPerWave?: number;
    maxWavesPerBatch?: number;
    defaultPartitionStrategy?: WavePartitionStrategy;
    proximityMaxDistance?: number;
  },
  strategyOverride?: WavePartitionStrategy,
): WavePartitionSettings {
  return {
    partitionEnabled: settings.partitionEnabled ?? true,
    minOrdersPerWave: settings.minOrdersPerWave ?? 3,
    maxWavesPerBatch: settings.maxWavesPerBatch ?? 10,
    strategy: strategyOverride ?? settings.defaultPartitionStrategy ?? "BY_PRODUCT",
    proximityMaxDistance: settings.proximityMaxDistance ?? 2,
  };
}

export function getExcludedOrderIds(
  allCandidates: OrderWithItems[],
  includedInWaves: OrderWithItems[][],
  strategy: WavePartitionStrategy,
): string[] {
  if (strategy !== "SINGLE_ITEM" && strategy !== "BY_PRODUCT") return [];
  const included = new Set(includedInWaves.flatMap((g) => g.map((o) => o.id)));
  return allCandidates.filter((o) => !included.has(o.id)).map((o) => o.id);
}
