import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderItem } from "@prisma/client";
import type { OrderPickProfile } from "./pick-wave-order-profile.js";
import {
  findConnectedComponents,
  getExcludedOrderDetails,
  getExcludedOrderIds,
  isEligibleForByProductWave,
  orderLinksToAnyInGroup,
  partitionOrders,
  pendingProductIds,
  type OrderWithItems,
} from "./pick-wave-partition.js";

function mockOrder(
  id: string,
  productIds: string[],
  centroid?: { corridor: number; row: number },
): OrderWithItems {
  const items = productIds.map((pid, i) => ({
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
  } as OrderWithItems;
}

function profile(
  orderId: string,
  centroid: { corridor: number; row: number },
): OrderPickProfile {
  return {
    orderId,
    distinctProductIds: [],
    isSingleItem: false,
    singleProductId: null,
    pickLocationIds: [`loc-${orderId}`],
    coords: [centroid],
    centroid,
    routeHint: `C${centroid.corridor}`,
  };
}

const baseSettings = {
  partitionEnabled: true,
  minOrdersPerWave: 3,
  maxWavesPerBatch: 10,
  strategy: "BY_PRODUCT" as const,
  proximityMaxDistance: 2,
};

describe("pick-wave-partition BY_PRODUCT", () => {
  it("exclui pedido isolado sem SKU em comum com o grupo", () => {
    const o1 = mockOrder("a", ["p1"]);
    const o2 = mockOrder("b", ["p1"]);
    const o3 = mockOrder("c", ["p1"]);
    const isolated = mockOrder("z", ["p9"], { corridor: 9, row: 9 });

    const profiles = new Map([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 1, row: 1 })],
      ["c", profile("c", { corridor: 1, row: 2 })],
      ["z", profile("z", { corridor: 9, row: 9 })],
    ]);

    const groups = partitionOrders(
      [o1, o2, o3, isolated],
      "BY_PRODUCT",
      baseSettings,
      profiles,
    );
    const excluded = getExcludedOrderIds(
      [o1, o2, o3, isolated],
      groups,
      "BY_PRODUCT",
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.length, 3);
    assert.deepEqual(excluded, ["z"]);
  });

  it("inclui pedido só por proximidade quando ligado ao grupo", () => {
    const o1 = mockOrder("a", ["p1"]);
    const o2 = mockOrder("b", ["p1"]);
    const o3 = mockOrder("c", ["p2"], { corridor: 1, row: 2 });

    const profiles = new Map([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 1, row: 1 })],
      ["c", profile("c", { corridor: 1, row: 2 })],
    ]);

    const groups = partitionOrders(
      [o1, o2, o3],
      "BY_PRODUCT",
      { ...baseSettings, minOrdersPerWave: 3 },
      profiles,
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.length, 3);
    assert.ok(groups[0]!.some((o) => o.id === "c"));
  });

  it("não força onda quando componente é menor que o mínimo", () => {
    const o1 = mockOrder("a", ["p1"]);
    const o2 = mockOrder("b", ["p1"]);

    const profiles = new Map([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 1, row: 1 })],
    ]);

    const groups = partitionOrders(
      [o1, o2],
      "BY_PRODUCT",
      { ...baseSettings, minOrdersPerWave: 3 },
      profiles,
    );

    assert.equal(groups.length, 0);
    assert.equal(
      getExcludedOrderIds([o1, o2], groups, "BY_PRODUCT").length,
      2,
    );
  });

  it("orderLinksToAnyInGroup exige SKU ou proximidade", () => {
    const a = mockOrder("a", ["p1"]);
    const b = mockOrder("b", ["p2"], { corridor: 5, row: 5 });
    const profiles = new Map([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 5, row: 5 })],
    ]);
    assert.equal(
      orderLinksToAnyInGroup(b, [a], profiles, 2),
      false,
    );
    assert.equal(pendingProductIds(a).has("p1"), true);
  });

  it("exclui pedido com mais de 5 SKUs distintos", () => {
    const manySkus = mockOrder("many", [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
    const o1 = mockOrder("a", ["p1"]);
    const o2 = mockOrder("b", ["p1"]);
    const o3 = mockOrder("c", ["p1"]);
    assert.equal(isEligibleForByProductWave(manySkus), false);
    assert.equal(isEligibleForByProductWave(o1), true);

    const profiles = new Map([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 1, row: 1 })],
      ["c", profile("c", { corridor: 1, row: 2 })],
      ["many", profile("many", { corridor: 1, row: 3 })],
    ]);

    const groups = partitionOrders(
      [o1, o2, o3, manySkus],
      "BY_PRODUCT",
      baseSettings,
      profiles,
    );
    const details = getExcludedOrderDetails(
      [o1, o2, o3, manySkus],
      groups,
      "BY_PRODUCT",
    );
    assert.equal(groups[0]!.length, 3);
    assert.ok(
      details.some((d) => d.orderId === "many" && d.reason === "too_many_skus"),
    );
  });

  it("findConnectedComponents une por SKU", () => {
    const o1 = mockOrder("a", ["p1"]);
    const o2 = mockOrder("b", ["p1"]);
    const o3 = mockOrder("c", ["p9"]);
    const profiles = new Map([
      ["a", profile("a", { corridor: 1, row: 1 })],
      ["b", profile("b", { corridor: 1, row: 2 })],
      ["c", profile("c", { corridor: 9, row: 9 })],
    ]);
    const comps = findConnectedComponents([o1, o2, o3], profiles, 2);
    assert.equal(comps.length, 2);
    const withA = comps.find((c) => c.some((o) => o.id === "a"));
    assert.equal(withA?.length, 2);
  });
});
