import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  removeDemoSeedOrdersAndWaves,
  wipeAllTenantOrdersAndWaves,
} from "./sync-sales-orders-from-tiny.js";
import {
  shouldRunTinyDailySync,
  shouldRunTinyOrderReconcile,
  TINY_ORDER_SYNC_TARGET_MINUTES,
} from "./tiny-order-sync-scheduler.js";

describe("tiny order sync automation", () => {
  it("dispara o sync diário apenas após o horário e uma vez por dia", () => {
    const todayKey = "2026-06-04";
    assert.equal(
      shouldRunTinyDailySync({
        todayKey,
        lastRunDate: null,
        nowMinutes: TINY_ORDER_SYNC_TARGET_MINUTES - 1,
      }),
      false,
    );
    assert.equal(
      shouldRunTinyDailySync({
        todayKey,
        lastRunDate: null,
        nowMinutes: TINY_ORDER_SYNC_TARGET_MINUTES,
      }),
      true,
    );
    assert.equal(
      shouldRunTinyDailySync({
        todayKey,
        lastRunDate: todayKey,
        nowMinutes: TINY_ORDER_SYNC_TARGET_MINUTES + 5,
      }),
      false,
    );
  });

  it("dispara conciliação com o Tiny no intervalo, não a cada tick", () => {
    assert.equal(shouldRunTinyOrderReconcile({ lastReconcileAt: null }), true);
    assert.equal(
      shouldRunTinyOrderReconcile({
        lastReconcileAt: "2026-10-21T10:00:00.000Z",
        nowMs: Date.parse("2026-10-21T10:10:00.000Z"),
        intervalMs: 30 * 60 * 1000,
      }),
      false,
    );
    assert.equal(
      shouldRunTinyOrderReconcile({
        lastReconcileAt: "2026-10-21T10:00:00.000Z",
        nowMs: Date.parse("2026-10-21T10:30:00.000Z"),
        intervalMs: 30 * 60 * 1000,
      }),
      true,
    );
  });

  it("removeDemoSeedOrdersAndWaves apaga só pedidos demo e ondas vazias de demo", async () => {
    const calls: string[] = [];

    const db = {
      order: {
        count: async ({ where }: { where: { tenantId: string; OR?: unknown } }) => {
          calls.push(`order.count:${where.tenantId}:${where.OR ? "demo" : "all"}`);
          return where.OR ? 3 : 12;
        },
        deleteMany: async ({ where }: { where: { tenantId: string; OR?: unknown } }) => {
          calls.push(`order.deleteMany:${where.tenantId}:${where.OR ? "demo" : "all"}`);
          return { count: where.OR ? 3 : 0 };
        },
      },
      pickWave: {
        findMany: async () => {
          calls.push("wave.findMany:demo-only");
          return [{ id: "wave-1" }];
        },
        deleteMany: async ({ where }: { where: { id?: { in: string[] } } }) => {
          calls.push(`wave.deleteMany:${where.id?.in?.join(",") ?? "all"}`);
          return { count: 1 };
        },
        count: async ({ where }: { where: { tenantId: string } }) => {
          calls.push(`wave.count:${where.tenantId}`);
          return 4;
        },
      },
      $transaction: async (ops: unknown) =>
        Array.isArray(ops) ? Promise.all(ops) : ops,
    };

    const result = await removeDemoSeedOrdersAndWaves(db as never, "tenant-1");

    assert.deepEqual(result, {
      ordersRemoved: 3,
      wavesRemoved: 1,
      demoRemoved: 3,
    });
    assert.equal(calls.includes("order.deleteMany:tenant-1:demo"), true);
    assert.equal(calls.includes("wave.deleteMany:wave-1"), true);
  });

  it("wipeAllTenantOrdersAndWaves apaga todo o tenant (seed)", async () => {
    const calls: string[] = [];

    const db = {
      order: {
        count: async ({ where }: { where: { tenantId: string; OR?: unknown } }) => {
          calls.push(`order.count:${where.tenantId}:${where.OR ? "demo" : "all"}`);
          return where.OR ? 3 : 12;
        },
        deleteMany: async ({ where }: { where: { tenantId: string } }) => {
          calls.push(`order.deleteMany:${where.tenantId}`);
          return { count: 12 };
        },
      },
      pickWave: {
        count: async ({ where }: { where: { tenantId: string } }) => {
          calls.push(`wave.count:${where.tenantId}`);
          return 4;
        },
        deleteMany: async ({ where }: { where: { tenantId: string } }) => {
          calls.push(`wave.deleteMany:${where.tenantId}`);
          return { count: 4 };
        },
      },
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    };

    const result = await wipeAllTenantOrdersAndWaves(db as never, "tenant-1");

    assert.deepEqual(result, {
      ordersRemoved: 12,
      wavesRemoved: 4,
      demoRemoved: 3,
    });
    assert.equal(calls.includes("wave.deleteMany:tenant-1"), true);
    assert.equal(calls.includes("order.deleteMany:tenant-1"), true);
  });
});
