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
  upsertOrderFromTiny,
} from "./tiny-integration.js";

const LAST_SYNC_KEY = "tiny.orders.lastSyncAt";
const TINY_MAX_SYNC_DAYS = 90;

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
    client = await getTinyApiClient(params.tenantId);
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

  const limit = 100;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await client.listPedidos({
      dataInicial: formatDate(start),
      dataFinal: formatDate(end),
      limit,
      offset,
    });

    result.listedFromTiny += page.items.length;

    for (const raw of page.items) {
      const row = asRecord(raw);
      if (!row) continue;
      const pedidoId = num(row.id);
      if (!pedidoId) continue;

      const listSituacao = parseTinyPedidoSituacao(row);
      const erpOrderId = tinyErpOrderId(pedidoId);

      if (listSituacao === TINY_ORDER_SITUACAO_CANCELADA) {
        if (await removeCancelledTinyPending(params.tenantId, pedidoId)) {
          result.cancelledRemoved += 1;
        } else {
          result.skipped += 1;
        }
        continue;
      }

      if (!isTinyOrderSituacaoSyncable(listSituacao)) {
        result.skipped += 1;
        continue;
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
          continue;
        }

        if (!isTinyOrderSituacaoSyncable(fullSituacao)) {
          result.skipped += 1;
          continue;
        }

        const payload = parseTinyApiPedido(full);
        if (!payload) {
          result.skipped += 1;
          continue;
        }

        const upsert = await upsertOrderFromTiny(params.tenantId, payload);
        if (upsert.created) {
          result.created += 1;
        } else {
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
        }
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao processar pedido";
        result.errors.push({ erpOrderId, message });
      }
    }

    const pag = asRecord(page.pagination);
    total = num(pag?.total) || page.items.length;
    if (page.items.length < limit) break;
    offset += limit;
    if (offset > 5000) break;
  }

  await setLastSyncAt(params.tenantId);

  if (result.listedFromTiny === 0) {
    result.warning =
      "A API Tiny não retornou pedidos de venda no período. Confira se existem pedidos no ERP (últimos " +
      `${days} dias), se o aplicativo OAuth tem permissão de Pedidos de Venda e se a conta conectada é a correta.`;
  } else if (result.created === 0 && result.updated === 0 && result.errors.length === 0) {
    result.warning =
      `${result.listedFromTiny} pedido(s) listado(s), mas nenhum foi importado. Situações aceitas: Aberta (0), Faturada (1), Aprovada (3), Preparando envio (4), Pronto envio (7). Cancelados (2) removem pedido PENDING existente. SKUs precisam existir no cadastro WMS.`;
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
