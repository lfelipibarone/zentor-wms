import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Order, OrderItem } from "@prisma/client";
import {
  clusterOrdersByProximity,
  sortOrdersByPickProximity,
} from "./order-proximity.js";
import type { OrderPickProfile } from "./pick-wave-order-profile.js";
import type { OrderWithItems } from "./pick-wave-partition.js";

function mockOrder(
  id: string,
  centroid: { corridor: number; row: number },
  multiSku = false,
): OrderWithItems {
  const productIds = multiSku ? ["p1", "p2"] : ["p1"];
  const items: OrderItem[] = productIds.map((pid, i) => ({
    id: `${id}-item-${i}`,
    orderId: id,
    productId: pid,
    quantityOrdered: 1,
    quantityPicked: 0,
    quantityPacked: 0,
    pickLocationId: null,
    lineNumber: i + 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as OrderItem[];
  return {
    id,
    tenantId: "t1",
    erpOrderId: id,
    status: "PENDING",
    priority: 0,
    marketplace: "SHOPEE",
    collectionDeadline: null,
    customerName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items,
  } as OrderWithItems & Order;
}

function profile(
  orderId: string,
  centroid: { corridor: number; row: number },
  isSingleItem = true,
): OrderPickProfile {
  return {
    orderId,
    distinctProductIds: isSingleItem ? ["p1"] : ["p1", "p2"],
    isSingleItem,
    singleProductId: isSingleItem ? "p1" : null,
    pickLocationIds: [`loc-${orderId}`],
    coords: [centroid],
    centroid,
    routeHint: `Corredor ${centroid.corridor}`,
  };
}

describe("order-proximity", () => {
  it("agrupa pedidos com centróides próximos", () => {
    const o1 = mockOrder("a", { corridor: 1, row: 1 });
    const o2 = mockOrder("b", { corridor: 1, row: 2 });
    const o3 = mockOrder("z", { corridor: 9, row: 9 });
    const profiles = new Map<string, OrderPickProfile>([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 1, row: 2 })],
      ["z", profile("z", { corridor: 9, row: 9 })],
    ]);
    const clusters = clusterOrdersByProximity([o1, o2, o3], profiles, {
      maxDistance: 2,
      maxClusters: 10,
      maxOrdersPerCluster: 8,
    });
    const ab = clusters.find((c) => c.orderIds.includes("a"));
    assert.ok(ab);
    assert.ok(ab.orderIds.includes("b"));
    assert.equal(ab.orderIds.includes("z"), false);
  });

  it("ordena por vizinho mais próximo dentro do bucket de urgência", () => {
    const o1 = mockOrder("a", { corridor: 1, row: 1 });
    const o2 = mockOrder("b", { corridor: 1, row: 2 });
    const o3 = mockOrder("c", { corridor: 5, row: 5 });
    const profiles = new Map<string, OrderPickProfile>([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 1, row: 2 })],
      ["c", profile("c", { corridor: 5, row: 5 })],
    ]);
    const sorted = sortOrdersByPickProximity([o3, o1, o2], profiles);
    const ids = sorted.map((o) => o.id);
    const abNear =
      Math.abs(ids.indexOf("a") - ids.indexOf("b")) === 1;
    assert.ok(abNear, "a e b devem ficar adjacentes na fila");
    assert.ok(
      Math.abs(ids.indexOf("a") - ids.indexOf("c")) > 1 ||
        Math.abs(ids.indexOf("b") - ids.indexOf("c")) > 1,
      "c deve ficar mais distante de a/b",
    );
  });
});
