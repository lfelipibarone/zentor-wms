import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanupTenantOrdersAndWaves,
} from "./sync-sales-orders-from-tiny.js";
import {
  shouldRunTinyDailySync,
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

  it("limpa pedidos e ondas do tenant antes do backfill", async () => {
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

    const result = await cleanupTenantOrdersAndWaves(db as never, "tenant-1");

    assert.deepEqual(result, {
      ordersRemoved: 12,
      wavesRemoved: 4,
      demoRemoved: 3,
    });
    assert.equal(calls.includes("wave.deleteMany:tenant-1"), true);
    assert.equal(calls.includes("order.deleteMany:tenant-1"), true);
  });
});
