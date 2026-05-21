import type { Order, OrderItem } from "@prisma/client";
import type { WaveSettings } from "./wave-settings.js";

export type OrderWithItems = Order & { items: OrderItem[] };

export type WavePartitionSettings = {
  partitionEnabled: boolean;
  minOrdersPerWave: number;
  maxWavesPerBatch: number;
};

export function partitionOrdersIntoWaves(
  orders: OrderWithItems[],
  settings: WavePartitionSettings,
): OrderWithItems[][] {
  if (orders.length === 0) return [];
  if (!settings.partitionEnabled) return [orders];

  const assigned = new Set<string>();
  const productToOrders = new Map<string, Set<string>>();

  for (const order of orders) {
    for (const item of order.items) {
      const remaining = item.quantityOrdered - item.quantityPicked;
      if (remaining <= 0) continue;
      let set = productToOrders.get(item.productId);
      if (!set) {
        set = new Set();
        productToOrders.set(item.productId, set);
      }
      set.add(order.id);
    }
  }

  const products = [...productToOrders.entries()].sort(
    (a, b) => b[1].size - a[1].size,
  );

  const groups: OrderWithItems[][] = [];

  for (const [, orderIds] of products) {
    if (groups.length >= settings.maxWavesPerBatch) break;

    const waveOrders = orders.filter(
      (o) => orderIds.has(o.id) && !assigned.has(o.id),
    );
    if (waveOrders.length < settings.minOrdersPerWave) continue;

    for (const o of waveOrders) assigned.add(o.id);
    groups.push(waveOrders);
  }

  const unassigned = orders.filter((o) => !assigned.has(o.id));
  if (unassigned.length > 0) {
    if (groups.length === 0) {
      groups.push(unassigned);
    } else if (unassigned.length >= settings.minOrdersPerWave) {
      groups.push(unassigned);
    } else {
      groups[groups.length - 1]!.push(...unassigned);
    }
  }

  return groups.slice(0, settings.maxWavesPerBatch);
}

export function waveSettingsToPartition(
  settings: WaveSettings & {
    partitionEnabled?: boolean;
    minOrdersPerWave?: number;
    maxWavesPerBatch?: number;
  },
): WavePartitionSettings {
  return {
    partitionEnabled: settings.partitionEnabled ?? true,
    minOrdersPerWave: settings.minOrdersPerWave ?? 3,
    maxWavesPerBatch: settings.maxWavesPerBatch ?? 10,
  };
}
