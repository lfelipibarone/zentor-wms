import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getTinyApiClient, TinyApiError, isTinyRateLimitError } from "./tiny-api-v3-client.js";
import { isTinyConnectedError } from "./tiny-purchase-receipt.js";
import {
  isTinyOrderSituacaoSyncable,
  logIntegrationEvent,
  parseTinyApiPedido,
  parseTinyPedidoSituacao,
  TINY_ORDER_SITUACAO_CANCELADA,
  TINY_ORDER_SITUACOES_SYNC,
  upsertOrderFromTiny,
} from "./tiny-integration.js";
import {
  clearTinySyncCheckpoint,
  isTinySyncCheckpointResumable,
  readTinySyncCheckpoint,
  TINY_ORDERS_CHECKPOINT_KEY,
  TINY_ORDERS_LAST_SYNC_KEY,
  writeTinySyncCheckpoint,
  type TinySyncCheckpointState,
} from "./tiny-sync-checkpoint.js";
import {
  releaseTinySyncLock,
  tryAcquireTinySyncLock,
} from "./tiny-sync-lock.js";

const TINY_MAX_SYNC_DAYS = 90;
const TINY_LIST_PAGE_SIZE = 100;
const TINY_LIST_MAX_OFFSET = 5000;
const TINY_SYNCABLE_SITUACOES = [...TINY_ORDER_SITUACOES_SYNC].sort(
  (a, b) => a - b,
);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function tinyErpOrderId(pedidoId: number): string {
  return `TINY-${pedidoId}`;
}

export type SyncSalesOrdersResult = {
  created: number;
  updated: number;
  skipped: number;
  /** Pedidos retornados pelo GET /pedidos no período (antes dos filtros WMS). */
  listedFromTiny: number;
  ordersRemoved: number;
  wavesRemoved: number;
  demoRemoved: number;
  cancelledRemoved: number;
  errors: Array<{ erpOrderId: string; message: string }>;
  tinyConnected: boolean;
  resumed: boolean;
  rateLimited: boolean;
  warning?: string;
};

export type TinyCleanupStats = {
  ordersRemoved: number;
  wavesRemoved: number;
  demoRemoved: number;
};

type TinyCleanupDb = Pick<typeof prisma, "order" | "pickWave" | "$transaction">;

async function getLastSyncAt(tenantId: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { tenantId_key: { tenantId, key: TINY_ORDERS_LAST_SYNC_KEY } },
  });
  return row?.value?.trim() || null;
}

async function setLastSyncAt(tenantId: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId, key: TINY_ORDERS_LAST_SYNC_KEY } },
    create: {
      tenantId,
      key: TINY_ORDERS_LAST_SYNC_KEY,
      value: new Date().toISOString(),
    },
    update: { value: new Date().toISOString() },
  });
}

async function loadNonUpdatableErpOrderIds(
  tenantId: string,
): Promise<Set<string>> {
  const rows = await prisma.order.findMany({
    where: {
      tenantId,
      erpOrderId: { startsWith: "TINY-" },
      status: { notIn: [OrderStatus.PENDING, OrderStatus.PAUSED_ISSUE] },
    },
    select: { erpOrderId: true },
  });
  return new Set(rows.map((r) => r.erpOrderId));
}

/** Pedidos fictícios do seed — nunca apagar TINY-* ou pedidos reais. */
export const DEMO_ORDER_WHERE = {
  OR: [
    { erpOrderId: { startsWith: "ERP-DEMO-" } },
    { erpOrderId: { startsWith: "ERP-MOB-" } },
    { erpOrderId: "ERP-10042" },
  ],
} as const;

/** Remove só dados demo antes da 1ª sync Tiny. Preserva pedidos TINY-* existentes. */
export async function removeDemoSeedOrdersAndWaves(
  db: TinyCleanupDb,
  tenantId: string,
): Promise<TinyCleanupStats> {
  const demoWhere = { tenantId, ...DEMO_ORDER_WHERE };

  const [demoRemoved, wavesOnlyDemo] = await db.$transaction([
    db.order.count({ where: demoWhere }),
    db.pickWave.findMany({
      where: {
        tenantId,
        orders: { every: { order: DEMO_ORDER_WHERE } },
      },
      select: { id: true },
    }),
  ]);

  const waveIds = wavesOnlyDemo.map((w) => w.id);

  await db.$transaction([
    db.pickWave.deleteMany({ where: { id: { in: waveIds } } }),
    db.order.deleteMany({ where: demoWhere }),
  ]);

  return {
    ordersRemoved: demoRemoved,
    wavesRemoved: waveIds.length,
    demoRemoved,
  };
}

/** Apaga todos os pedidos e ondas do tenant. Uso exclusivo do seed (`pnpm db:seed`). */
export async function wipeAllTenantOrdersAndWaves(
  db: TinyCleanupDb,
  tenantId: string,
): Promise<TinyCleanupStats> {
  const [ordersRemoved, wavesRemoved, demoRemoved] = await db.$transaction([
    db.order.count({ where: { tenantId } }),
    db.pickWave.count({ where: { tenantId } }),
    db.order.count({ where: { tenantId, ...DEMO_ORDER_WHERE } }),
  ]);

  await db.$transaction([
    db.pickWave.deleteMany({ where: { tenantId } }),
    db.order.deleteMany({ where: { tenantId } }),
  ]);

  return { ordersRemoved, wavesRemoved, demoRemoved };
}

/** @deprecated Use removeDemoSeedOrdersAndWaves ou wipeAllTenantOrdersAndWaves */
export async function cleanupTenantOrdersAndWaves(
  db: TinyCleanupDb,
  tenantId: string,
): Promise<TinyCleanupStats> {
  return wipeAllTenantOrdersAndWaves(db, tenantId);
}

async function removeCancelledTinyPending(
  tenantId: string,
  pedidoId: number,
): Promise<boolean> {
  const erpOrderId = tinyErpOrderId(pedidoId);
  const existing = await prisma.order.findFirst({
    where: {
      tenantId,
      erpOrderId,
      status: OrderStatus.PENDING,
    },
    select: { id: true },
  });
  if (!existing) return false;

  await prisma.order.delete({ where: { id: existing.id } });
  return true;
}

export async function syncSalesOrdersFromTiny(params: {
  tenantId: string;
  userId?: string;
  connectionId?: string;
  days?: number;
  /** Ignora checkpoint e recomeça do início */
  forceRestart?: boolean;
}): Promise<SyncSalesOrdersResult> {
  const days = Math.min(Math.max(params.days ?? 30, 1), TINY_MAX_SYNC_DAYS);
  const result: SyncSalesOrdersResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    listedFromTiny: 0,
    ordersRemoved: 0,
    wavesRemoved: 0,
    demoRemoved: 0,
    cancelledRemoved: 0,
    errors: [],
    tinyConnected: false,
    resumed: false,
    rateLimited: false,
  };

  if (!tryAcquireTinySyncLock(params.tenantId, "orders")) {
    return {
      ...result,
      tinyConnected: true,
      warning: "Sync de pedidos já em andamento.",
    };
  }

  try {
  let client;
  try {
    client = await getTinyApiClient({
      tenantId: params.tenantId,
      userId: params.userId,
      connectionId: params.connectionId,
    });
  } catch (e) {
    if (isTinyRateLimitError(e)) {
      return {
        ...result,
        tinyConnected: true,
        rateLimited: true,
        warning:
          e instanceof Error
            ? e.message
            : "Rate limit Olist ERP: sync pausada. Retome em alguns minutos.",
      };
    }
    if (isTinyConnectedError(e) || e instanceof TinyApiError) {
      return {
        ...result,
        tinyConnected: false,
        warning:
          "Tiny ERP não conectado. Configure OAuth em Integrações → Tiny.",
      };
    }
    throw e;
  }

  result.tinyConnected = true;

  if (params.forceRestart) {
    await clearTinySyncCheckpoint(params.tenantId, TINY_ORDERS_CHECKPOINT_KEY);
  }

  const savedCheckpoint = await readTinySyncCheckpoint(
    params.tenantId,
    TINY_ORDERS_CHECKPOINT_KEY,
  );
  let resume = isTinySyncCheckpointResumable(savedCheckpoint, {
    connectionId: params.connectionId,
    forceRestart: params.forceRestart,
  });

  if (resume && savedCheckpoint!.days !== undefined && savedCheckpoint!.days !== days) {
    await clearTinySyncCheckpoint(params.tenantId, TINY_ORDERS_CHECKPOINT_KEY);
    resume = false;
  }

  result.resumed = resume;
  const effectiveDays = resume ? (savedCheckpoint!.days ?? days) : days;

  const hadSyncBefore =
    resume || (await getLastSyncAt(params.tenantId)) !== null;
  if (!hadSyncBefore) {
    const cleanup = await removeDemoSeedOrdersAndWaves(prisma, params.tenantId);
    result.ordersRemoved = cleanup.ordersRemoved;
    result.wavesRemoved = cleanup.wavesRemoved;
    result.demoRemoved = cleanup.demoRemoved;
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - effectiveDays);
  const dateRange = {
    dataInicial: formatDate(start),
    dataFinal: formatDate(end),
  };

  const nonUpdatableOrders = await loadNonUpdatableErpOrderIds(params.tenantId);
  const connectionId = params.connectionId?.trim() || null;
  const startedAt = resume
    ? savedCheckpoint!.startedAt
    : new Date().toISOString();

  let situacaoIndex = resume ? (savedCheckpoint!.situacaoIndex ?? 0) : 0;
  let phase: "syncable" | "cancelled" = resume
    ? (savedCheckpoint!.phase ?? "syncable")
    : "syncable";
  let offset = resume ? savedCheckpoint!.offset : 0;
  let total = resume ? (savedCheckpoint!.total ?? Infinity) : Infinity;
  let checkpointSaved = false;

  const persistCheckpoint = async (
    next: Pick<
      TinySyncCheckpointState,
      "situacaoIndex" | "phase" | "offset" | "total" | "situacao"
    >,
    opts?: { pauseReason?: "rate_limit" | "interrupted" },
  ) => {
    const state: TinySyncCheckpointState = {
      status: "running",
      kind: "orders",
      offset: next.offset,
      total: Number.isFinite(next.total) ? next.total : null,
      startedAt,
      updatedAt: new Date().toISOString(),
      connectionId,
      days: effectiveDays,
      situacaoIndex: next.situacaoIndex,
      situacao: next.situacao,
      phase: next.phase,
      stats: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        listedFromTiny: result.listedFromTiny,
        cancelledRemoved: result.cancelledRemoved,
      },
      pauseReason: opts?.pauseReason,
    };
    await writeTinySyncCheckpoint(params.tenantId, TINY_ORDERS_CHECKPOINT_KEY, state);
    checkpointSaved = true;
  };

  const processSyncablePedido = async (pedidoId: number) => {
    const erpOrderId = tinyErpOrderId(pedidoId);
    if (nonUpdatableOrders.has(erpOrderId)) {
      result.skipped += 1;
      return;
    }

    try {
      const full = await client.getPedido(pedidoId);
      const fullSituacao = parseTinyPedidoSituacao(full);

      if (fullSituacao === TINY_ORDER_SITUACAO_CANCELADA) {
        if (await removeCancelledTinyPending(params.tenantId, pedidoId)) {
          result.cancelledRemoved += 1;
        } else {
          result.skipped += 1;
        }
        return;
      }

      if (!isTinyOrderSituacaoSyncable(fullSituacao)) {
        result.skipped += 1;
        return;
      }

      const payload = parseTinyApiPedido(full);
      if (!payload) {
        result.skipped += 1;
        return;
      }

      const upsert = await upsertOrderFromTiny(params.tenantId, payload);
      if (upsert.created) {
        result.created += 1;
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: upsert.orderId },
        select: { status: true },
      });
      if (
        order &&
        (order.status === OrderStatus.PENDING ||
          order.status === OrderStatus.PAUSED_ISSUE)
      ) {
        result.updated += 1;
      } else {
        nonUpdatableOrders.add(erpOrderId);
        result.skipped += 1;
      }
    } catch (e) {
      if (isTinyRateLimitError(e)) throw e;
      const message =
        e instanceof Error ? e.message : "Erro ao processar pedido";
      result.errors.push({ erpOrderId, message });
    }
  };

  const processCancelledPedido = async (pedidoId: number) => {
    if (await removeCancelledTinyPending(params.tenantId, pedidoId)) {
      result.cancelledRemoved += 1;
    } else {
      result.skipped += 1;
    }
  };

  const syncSyncableSituacao = async (situacao: number, startOffset: number) => {
    let pageOffset = startOffset;
    let pageTotal = total;

    while (pageOffset < pageTotal) {
      await persistCheckpoint({
        situacaoIndex,
        phase: "syncable",
        offset: pageOffset,
        total: pageTotal,
        situacao,
      });

      const page = await client.listPedidos({
        ...dateRange,
        situacao,
        limit: TINY_LIST_PAGE_SIZE,
        offset: pageOffset,
      });

      result.listedFromTiny += page.items.length;

      for (const raw of page.items) {
        const pedidoId = num(asRecord(raw)?.id);
        if (!pedidoId) continue;
        await processSyncablePedido(pedidoId);
      }

      const pag = asRecord(page.pagination);
      pageTotal = num(pag?.total) || page.items.length;
      const nextOffset = pageOffset + TINY_LIST_PAGE_SIZE;

      if (page.items.length < TINY_LIST_PAGE_SIZE) {
        pageOffset = nextOffset;
        break;
      }

      pageOffset = nextOffset;
      if (pageOffset > TINY_LIST_MAX_OFFSET) break;

      await persistCheckpoint({
        situacaoIndex,
        phase: "syncable",
        offset: pageOffset,
        total: pageTotal,
        situacao,
      });
    }

    return pageOffset;
  };

  const syncCancelledPedidos = async (startOffset: number) => {
    let pageOffset = startOffset;
    let pageTotal = total;

    while (pageOffset < pageTotal) {
      await persistCheckpoint({
        situacaoIndex: TINY_SYNCABLE_SITUACOES.length,
        phase: "cancelled",
        offset: pageOffset,
        total: pageTotal,
        situacao: TINY_ORDER_SITUACAO_CANCELADA,
      });

      const page = await client.listPedidos({
        ...dateRange,
        situacao: TINY_ORDER_SITUACAO_CANCELADA,
        limit: TINY_LIST_PAGE_SIZE,
        offset: pageOffset,
      });

      for (const raw of page.items) {
        const pedidoId = num(asRecord(raw)?.id);
        if (!pedidoId) continue;
        await processCancelledPedido(pedidoId);
      }

      const pag = asRecord(page.pagination);
      pageTotal = num(pag?.total) || page.items.length;
      const nextOffset = pageOffset + TINY_LIST_PAGE_SIZE;

      if (page.items.length < TINY_LIST_PAGE_SIZE) {
        pageOffset = nextOffset;
        break;
      }

      pageOffset = nextOffset;
      if (pageOffset > TINY_LIST_MAX_OFFSET) break;

      await persistCheckpoint({
        situacaoIndex: TINY_SYNCABLE_SITUACOES.length,
        phase: "cancelled",
        offset: pageOffset,
        total: pageTotal,
        situacao: TINY_ORDER_SITUACAO_CANCELADA,
      });
    }
  };

  try {
    if (phase === "syncable") {
      for (; situacaoIndex < TINY_SYNCABLE_SITUACOES.length; situacaoIndex++) {
        const situacao = TINY_SYNCABLE_SITUACOES[situacaoIndex]!;
        const startOffset =
          resume && situacaoIndex === (savedCheckpoint!.situacaoIndex ?? 0)
            ? offset
            : 0;
        total = Infinity;
        await syncSyncableSituacao(situacao, startOffset);
        offset = 0;
      }
    }

    phase = "cancelled";
    const cancelledStartOffset =
      resume &&
      savedCheckpoint!.phase === "cancelled" &&
      situacaoIndex >= TINY_SYNCABLE_SITUACOES.length
        ? offset
        : 0;
    total = Infinity;
    await syncCancelledPedidos(cancelledStartOffset);

    await clearTinySyncCheckpoint(params.tenantId, TINY_ORDERS_CHECKPOINT_KEY);
    await setLastSyncAt(params.tenantId);
  } catch (e) {
    const situacao =
      phase === "cancelled"
        ? TINY_ORDER_SITUACAO_CANCELADA
        : TINY_SYNCABLE_SITUACOES[situacaoIndex] ??
          TINY_SYNCABLE_SITUACOES[0]!;
    await persistCheckpoint(
      {
        situacaoIndex,
        phase,
        offset,
        total,
        situacao,
      },
      {
        pauseReason: isTinyRateLimitError(e) ? "rate_limit" : "interrupted",
      },
    ).catch(() => undefined);

    if (isTinyRateLimitError(e)) {
      result.rateLimited = true;
      result.warning =
        (e instanceof Error ? e.message : null) ??
        "Rate limit Olist ERP: sync pausada. Retome em alguns minutos.";
      await logIntegrationEvent({
        tenantId: params.tenantId,
        source: "TINY",
        eventType: "sync_orders",
        status: "ERROR",
        message: `Sync pausada por rate limit. Criados: ${result.created}, atualizados: ${result.updated}`,
        payload: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          listedFromTiny: result.listedFromTiny,
          errorCount: result.errors.length,
          days: effectiveDays,
          rateLimited: true,
          resumed: result.resumed,
        },
      });
      return result;
    }
    throw e;
  }

  if (result.resumed) {
    result.warning =
      "Sync retomado de checkpoint. " +
      (result.warning ? `${result.warning} ` : "") +
      "Use «Recomeçar do zero» para forçar reimportação completa.";
  } else if (result.listedFromTiny === 0) {
    result.warning =
      `Nenhum pedido importável nos últimos ${effectiveDays} dias. O WMS importa apenas Aberta (0), Faturada (1), Aprovada (3), Preparando envio (4) e Pronto envio (7). Pedidos já enviados (5) ou entregues (6) são ignorados. Confira se há pedidos pendentes no ERP e se o OAuth tem permissão de Pedidos de Venda.`;
  } else if (result.errors.length > 0) {
    result.warning = `${result.errors.length} pedido(s) com erro ao importar. Veja errors[] no resultado.`;
  } else if (result.created === 0 && result.updated === 0) {
    result.warning =
      `${result.listedFromTiny} pedido(s) elegível(is), mas nenhum foi importado. Os pedidos podem já existir no WMS em outro status.`;
  }

  await logIntegrationEvent({
    tenantId: params.tenantId,
    source: "TINY",
    eventType: "sync_orders",
    status: result.errors.length > 0 ? "ERROR" : "OK",
    message: `Criados: ${result.created}, atualizados: ${result.updated}, ignorados: ${result.skipped}${result.resumed ? ", retomado" : ""}`,
    payload: {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      listedFromTiny: result.listedFromTiny,
      ordersRemoved: result.ordersRemoved,
      wavesRemoved: result.wavesRemoved,
      demoRemoved: result.demoRemoved,
      cancelledRemoved: result.cancelledRemoved,
      errorCount: result.errors.length,
      days: effectiveDays,
      resumed: result.resumed,
    },
  });

  return result;
  } finally {
    releaseTinySyncLock(params.tenantId, "orders");
  }
}
