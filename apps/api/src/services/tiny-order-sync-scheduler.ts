import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { syncProductsFromTiny } from "./sync-products-from-tiny.js";
import { syncSalesOrdersFromTiny } from "./sync-sales-orders-from-tiny.js";
import {
  getConnectionRateLimitUntil,
  readRateLimitUntilFromMetadata,
} from "./tiny-rate-limit.js";
import {
  isTinySyncCheckpointResumable,
  readTinySyncCheckpoint,
  TINY_ORDERS_CHECKPOINT_KEY,
  TINY_PRODUCTS_CHECKPOINT_KEY,
} from "./tiny-sync-checkpoint.js";
import { isTinySyncLocked } from "./tiny-sync-lock.js";

const AUTO_SYNC_LAST_RUN_KEY = "tiny.orders.lastAutoSyncDate";
export const TINY_ORDER_SYNC_TARGET_MINUTES = 7 * 60;
/** Intervalo quando há checkpoint pendente (retomada automática). */
const TINY_RESUME_TICK_MS = 30_000;
/** Intervalo normal sem checkpoint pendente. */
const TINY_IDLE_TICK_MS = 60_000;

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

async function isConnectionInRateLimitCooldown(
  connectionId: string,
): Promise<boolean> {
  const conn = await prisma.tinyConnection.findUnique({
    where: { id: connectionId },
    select: { metadata: true },
  });
  const metadataUntil = readRateLimitUntilFromMetadata(conn?.metadata) ?? 0;
  const until = Math.max(
    getConnectionRateLimitUntil(connectionId),
    metadataUntil,
  );
  return until > Date.now();
}

async function tryResumeProductsSync(connection: {
  id: string;
  tenantId: string;
  userId: string;
}): Promise<boolean> {
  if (isTinySyncLocked(connection.tenantId, "products")) return false;

  const pendingCheckpoint = await readTinySyncCheckpoint(
    connection.tenantId,
    TINY_PRODUCTS_CHECKPOINT_KEY,
  );
  const shouldResume = isTinySyncCheckpointResumable(pendingCheckpoint, {
    connectionId: connection.id,
  });
  if (!shouldResume) return false;

  if (await isConnectionInRateLimitCooldown(connection.id)) {
    console.log(
      `[tiny-sync] ${connection.tenantId}/${connection.id}: produtos aguardando rate limit`,
    );
    return true;
  }

  console.log(
    `[tiny-sync] ${connection.tenantId}/${connection.id}: retomando sync de produtos (offset ${pendingCheckpoint!.offset})`,
  );

  const result = await syncProductsFromTiny({
    tenantId: connection.tenantId,
    userId: connection.userId,
    connectionId: connection.id,
  });

  if (!result.tinyConnected) return true;

  if (result.rateLimited) {
    console.log(
      `[tiny-sync] ${connection.tenantId}/${connection.id}: produtos pausados por rate limit — retomará automaticamente`,
    );
    return true;
  }

  console.log(
    `[tiny-sync] ${connection.tenantId}/${connection.id}: produtos — ${result.created} criados, ${result.updated} atualizados, ${result.skipped} ignorados${result.resumed ? " (retomado)" : ""}`,
  );
  return true;
}

async function tryAutoSyncOrdersForConnection(connection: {
  id: string;
  tenantId: string;
  userId: string;
}): Promise<boolean> {
  if (isTinySyncLocked(connection.tenantId, "orders")) return false;

  const todayKey = todayKeyInSaoPaulo();
  const nowMinutes = currentMinutesInSaoPaulo();
  const lastRunDate = await getLastAutoSyncDate(connection.tenantId);
  const pendingCheckpoint = await readTinySyncCheckpoint(
    connection.tenantId,
    TINY_ORDERS_CHECKPOINT_KEY,
  );
  const shouldResume = isTinySyncCheckpointResumable(pendingCheckpoint, {
    connectionId: connection.id,
  });

  if (
    !shouldResume &&
    !shouldRunTinyDailySync({
      todayKey,
      lastRunDate,
      nowMinutes,
      targetMinutes: parseTargetMinutes("07:00"),
    })
  ) {
    return false;
  }

  if (await isConnectionInRateLimitCooldown(connection.id)) {
    if (shouldResume) {
      console.log(
        `[tiny-sync] ${connection.tenantId}/${connection.id}: pedidos aguardando rate limit`,
      );
    }
    return shouldResume;
  }

  if (shouldResume) {
    console.log(
      `[tiny-sync] ${connection.tenantId}/${connection.id}: retomando sync de pedidos (offset ${pendingCheckpoint!.offset})`,
    );
  }

  const result = await syncSalesOrdersFromTiny({
    tenantId: connection.tenantId,
    userId: connection.userId,
    connectionId: connection.id,
  });
  if (!result.tinyConnected) return shouldResume;

  if (result.rateLimited) {
    console.log(
      `[tiny-sync] ${connection.tenantId}/${connection.id}: pedidos pausados por rate limit — retomará automaticamente`,
    );
    return true;
  }

  await setLastAutoSyncDate(connection.tenantId, todayKey);
  console.log(
    `[tiny-sync] ${connection.tenantId}/${connection.id}: pedidos — ${result.created} criados, ${result.updated} atualizados, ${result.skipped} ignorados${result.resumed ? " (retomado)" : ""}`,
  );
  return shouldResume;
}

async function tryAutoSyncForConnection(connection: {
  id: string;
  tenantId: string;
  userId: string;
}): Promise<boolean> {
  const productsPending = await tryResumeProductsSync(connection);
  const ordersPending = await tryAutoSyncOrdersForConnection(connection);
  return productsPending || ordersPending;
}

export async function tryAutoSyncTinyOrders(): Promise<boolean> {
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

  let anyPending = false;
  const seenTenants = new Set<string>();
  for (const connection of connections) {
    if (seenTenants.has(connection.tenantId)) continue;
    seenTenants.add(connection.tenantId);
    try {
      const pending = await tryAutoSyncForConnection(connection);
      if (pending) anyPending = true;
    } catch (e) {
      console.warn(
        `[tiny-sync] ${connection.tenantId}/${connection.id}`,
        e,
      );
    }
  }
  return anyPending;
}

export function startTinyOrderSyncScheduler(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = (delayMs: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, delayMs);
  };

  const tick = () => {
    void tryAutoSyncTinyOrders()
      .then((anyPending) => {
        scheduleNext(anyPending ? TINY_RESUME_TICK_MS : TINY_IDLE_TICK_MS);
      })
      .catch(() => {
        scheduleNext(TINY_IDLE_TICK_MS);
      });
  };

  tick();
}
