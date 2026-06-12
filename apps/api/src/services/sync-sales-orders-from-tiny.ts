import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getTinyApiClient, TinyApiError } from "./tiny-api-v3-client.js";
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

const LAST_SYNC_KEY = "tiny.orders.lastSyncAt";
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
    where: { tenantId_key: { tenantId, key: LAST_SYNC_KEY } },
  });
  return row?.value?.trim() || null;
}

async function setLastSyncAt(tenantId: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId, key: LAST_SYNC_KEY } },
    create: {
      tenantId,
      key: LAST_SYNC_KEY,
      value: new Date().toISOString(),
    },
    update: { value: new Date().toISOString() },
  });
}

export async function cleanupTenantOrdersAndWaves(
  db: TinyCleanupDb,
  tenantId: string,
): Promise<TinyCleanupStats> {
  const [ordersRemoved, wavesRemoved, demoRemoved] = await db.$transaction([
    db.order.count({ where: { tenantId } }),
    db.pickWave.count({ where: { tenantId } }),
    db.order.count({
      where: {
        tenantId,
        OR: [
          { erpOrderId: { startsWith: "ERP-DEMO-" } },
          { erpOrderId: { startsWith: "ERP-MOB-" } },
          { erpOrderId: "ERP-10042" },
        ],
      },
    }),
  ]);

  await db.$transaction([
    db.pickWave.deleteMany({ where: { tenantId } }),
    db.order.deleteMany({ where: { tenantId } }),
  ]);

  return { ordersRemoved, wavesRemoved, demoRemoved };
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
  };

  let client;
  try {
    client = await getTinyApiClient({
      tenantId: params.tenantId,
      userId: params.userId,
      connectionId: params.connectionId,
    });
  } catch (e) {
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

  const hadSyncBefore = (await getLastSyncAt(params.tenantId)) !== null;
  if (!hadSyncBefore) {
    const cleanup = await cleanupTenantOrdersAndWaves(prisma, params.tenantId);
    result.ordersRemoved = cleanup.ordersRemoved;
    result.wavesRemoved = cleanup.wavesRemoved;
    result.demoRemoved = cleanup.demoRemoved;
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const dateRange = {
    dataInicial: formatDate(start),
    dataFinal: formatDate(end),
  };

  const processSyncablePedido = async (pedidoId: number) => {
    const erpOrderId = tinyErpOrderId(pedidoId);
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
        result.skipped += 1;
      }
    } catch (e) {
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

  for (const situacao of TINY_SYNCABLE_SITUACOES) {
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const page = await client.listPedidos({
        ...dateRange,
        situacao,
        limit: TINY_LIST_PAGE_SIZE,
        offset,
      });

      result.listedFromTiny += page.items.length;

      for (const raw of page.items) {
        const pedidoId = num(asRecord(raw)?.id);
        if (!pedidoId) continue;
        await processSyncablePedido(pedidoId);
      }

      const pag = asRecord(page.pagination);
      total = num(pag?.total) || page.items.length;
      if (page.items.length < TINY_LIST_PAGE_SIZE) break;
      offset += TINY_LIST_PAGE_SIZE;
      if (offset > TINY_LIST_MAX_OFFSET) break;
    }
  }

  {
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const page = await client.listPedidos({
        ...dateRange,
        situacao: TINY_ORDER_SITUACAO_CANCELADA,
        limit: TINY_LIST_PAGE_SIZE,
        offset,
      });

      for (const raw of page.items) {
        const pedidoId = num(asRecord(raw)?.id);
        if (!pedidoId) continue;
        await processCancelledPedido(pedidoId);
      }

      const pag = asRecord(page.pagination);
      total = num(pag?.total) || page.items.length;
      if (page.items.length < TINY_LIST_PAGE_SIZE) break;
      offset += TINY_LIST_PAGE_SIZE;
      if (offset > TINY_LIST_MAX_OFFSET) break;
    }
  }

  await setLastSyncAt(params.tenantId);

  if (result.listedFromTiny === 0) {
    result.warning =
      `Nenhum pedido importável nos últimos ${days} dias. O WMS importa apenas Aberta (0), Faturada (1), Aprovada (3), Preparando envio (4) e Pronto envio (7). Pedidos já enviados (5) ou entregues (6) são ignorados. Confira se há pedidos pendentes no ERP e se o OAuth tem permissão de Pedidos de Venda.`;
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
    status: "OK",
    message: `Criados: ${result.created}, atualizados: ${result.updated}, ignorados: ${result.skipped}`,
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
      days,
    },
  });

  return result;
}
