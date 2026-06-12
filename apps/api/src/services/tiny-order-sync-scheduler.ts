import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { syncSalesOrdersFromTiny } from "./sync-sales-orders-from-tiny.js";

const AUTO_SYNC_LAST_RUN_KEY = "tiny.orders.lastAutoSyncDate";
export const TINY_ORDER_SYNC_TARGET_MINUTES = 7 * 60;

function todayKeyInSaoPaulo(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

function currentMinutesInSaoPaulo(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function parseTargetMinutes(targetTime: string): number {
  const [hour, minute] = targetTime.split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return TINY_ORDER_SYNC_TARGET_MINUTES;
  }
  return hour * 60 + minute;
}

export function shouldRunTinyDailySync(params: {
  todayKey: string;
  lastRunDate: string | null;
  nowMinutes: number;
  targetMinutes?: number;
}): boolean {
  return (
    params.nowMinutes >= (params.targetMinutes ?? TINY_ORDER_SYNC_TARGET_MINUTES) &&
    params.lastRunDate !== params.todayKey
  );
}

async function getLastAutoSyncDate(tenantId: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { tenantId_key: { tenantId, key: AUTO_SYNC_LAST_RUN_KEY } },
  });
  return row?.value?.trim() || null;
}

async function setLastAutoSyncDate(
  tenantId: string,
  value: string,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId, key: AUTO_SYNC_LAST_RUN_KEY } },
    create: {
      tenantId,
      key: AUTO_SYNC_LAST_RUN_KEY,
      value,
    },
    update: { value },
  });
}

async function tryAutoSyncForConnection(connection: {
  id: string;
  tenantId: string;
  userId: string;
}): Promise<void> {
  const todayKey = todayKeyInSaoPaulo();
  const nowMinutes = currentMinutesInSaoPaulo();
  const lastRunDate = await getLastAutoSyncDate(connection.tenantId);

  if (
    !shouldRunTinyDailySync({
      todayKey,
      lastRunDate,
      nowMinutes,
      targetMinutes: parseTargetMinutes("07:00"),
    })
  ) {
    return;
  }

  const result = await syncSalesOrdersFromTiny({
    tenantId: connection.tenantId,
    userId: connection.userId,
    connectionId: connection.id,
  });
  if (!result.tinyConnected) return;

  await setLastAutoSyncDate(connection.tenantId, todayKey);
  console.log(
    `[tiny-order-sync] ${connection.tenantId}/${connection.id}: ${result.created} criados, ${result.updated} atualizados, ${result.skipped} ignorados`,
  );
}

export async function tryAutoSyncTinyOrders(): Promise<void> {
  const connections = await prisma.tinyConnection.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      status: TinyConnectionStatus.CONNECTED,
      isDefault: true,
      tenant: { active: true },
    },
    select: { id: true, tenantId: true, userId: true },
  });

  const seenTenants = new Set<string>();
  for (const connection of connections) {
    if (seenTenants.has(connection.tenantId)) continue;
    seenTenants.add(connection.tenantId);
    try {
      await tryAutoSyncForConnection(connection);
    } catch (e) {
      console.warn(`[tiny-order-sync] ${connection.tenantId}/${connection.id}`, e);
    }
  }
}

export function startTinyOrderSyncScheduler(): void {
  const tick = () => {
    void tryAutoSyncTinyOrders();
  };

  tick();
  setInterval(tick, 60_000);
}
