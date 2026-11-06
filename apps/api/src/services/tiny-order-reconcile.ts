import { OrderStatus, OrderTimeLogEvent } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { recordOrderStageChange } from "./order-stage-log.js";
import {
  parseTinyPedidoSituacao,
  TINY_ORDER_SITUACAO_CANCELADA,
  TINY_ORDER_SITUACOES_SYNC,
  TINY_SEPARACAO_SITUACOES_BLOCK_PICKING,
} from "./tiny-integration.js";
import {
  getTinyApiClient,
  isTinyRateLimitError,
  type TinyApiV3Client,
} from "./tiny-api-v3-client.js";

export const TINY_CANCELLED_PAUSE_REASON =
  "Pedido cancelado no Tiny ERP — conferir antes de seguir com a operação";

/** Pedidos TINY-* que ainda podem estar desatualizados em relação ao ERP. */
export const TINY_RECONCILE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.PAUSED_ISSUE,
  OrderStatus.PICKING,
  OrderStatus.PICKED_AWAITING_CONFERENCE,
  OrderStatus.PACKING_RETURNED_TO_PICKING,
  OrderStatus.DISPATCHING,
];

export type TinyReconcileAction = "keep" | "remove" | "flag_cancelled";

export function decideTinyOrderReconcileAction(params: {
  situacao: number | null;
  status: OrderStatus;
  hasOperationalProgress: boolean;
  alreadyFlagged: boolean;
}): TinyReconcileAction {
  if (params.situacao === null) return "keep";
  if (TINY_ORDER_SITUACOES_SYNC.has(params.situacao)) return "keep";

  if (params.status === OrderStatus.PENDING) return "remove";
  if (
    params.status === OrderStatus.PAUSED_ISSUE &&
    !params.hasOperationalProgress
  ) {
    return "remove";
  }

  if (
    params.situacao === TINY_ORDER_SITUACAO_CANCELADA &&
    !params.alreadyFlagged
  ) {
    return "flag_cancelled";
  }
  return "keep";
}

/**
 * Pedidos Em Separação no Tiny não devem ficar na fila de picking do WMS
 * (ainda que a venda continue Faturada).
 */
export function decideTinySeparacaoBlockAction(params: {
  separacaoSituacao: number | null;
  status: OrderStatus;
  hasOperationalProgress: boolean;
}): TinyReconcileAction {
  if (
    params.separacaoSituacao === null ||
    !TINY_SEPARACAO_SITUACOES_BLOCK_PICKING.has(params.separacaoSituacao)
  ) {
    return "keep";
  }
  if (params.status === OrderStatus.PENDING) return "remove";
  if (
    params.status === OrderStatus.PAUSED_ISSUE &&
    !params.hasOperationalProgress
  ) {
    return "remove";
  }
  return "keep";
}

function parseSeparacaoVendaId(item: Record<string, unknown>): number | null {
  const venda = item.venda;
  if (!venda || typeof venda !== "object" || Array.isArray(venda)) return null;
  const id = Number((venda as { id?: unknown }).id);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function parseSeparacaoSituacao(item: Record<string, unknown>): number | null {
  if (item.situacao === null || item.situacao === undefined) return null;
  const n = Number(item.situacao);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/** Lista no Tiny as separações que bloqueiam picking e devolve erpOrderIds TINY-*. */
export async function listTinySeparacaoBlockedErpOrderIds(
  client: TinyApiV3Client,
): Promise<Map<string, number>> {
  const blocked = new Map<string, number>();
  for (const situacao of TINY_SEPARACAO_SITUACOES_BLOCK_PICKING) {
    let offset = 0;
    for (;;) {
      const page = await client.listSeparacoes({
        situacao,
        limit: 100,
        offset,
      });
      for (const raw of page.items) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const row = raw as Record<string, unknown>;
        const vendaId = parseSeparacaoVendaId(row);
        const sepSit = parseSeparacaoSituacao(row) ?? situacao;
        if (!vendaId) continue;
        if (!TINY_SEPARACAO_SITUACOES_BLOCK_PICKING.has(sepSit)) continue;
        blocked.set(`TINY-${vendaId}`, sepSit);
      }
      const total = Number(page.pagination.total ?? 0);
      offset += page.items.length;
      if (page.items.length === 0 || (total > 0 && offset >= total) || offset >= 2000) {
        break;
      }
    }
  }
  return blocked;
}

/**
 * Remove da fila WMS os PENDING (sem progresso) que já estão Em Separação
 * no módulo Separação do Tiny.
 */
export async function removeOrdersBlockedByTinySeparacao(params: {
  tenantId: string;
  client: TinyApiV3Client;
}): Promise<{ checked: number; removed: number }> {
  const blocked = await listTinySeparacaoBlockedErpOrderIds(params.client);
  if (blocked.size === 0) return { checked: 0, removed: 0 };

  const erpIds = [...blocked.keys()];
  const candidates = await prisma.order.findMany({
    where: {
      tenantId: params.tenantId,
      erpOrderId: { in: erpIds },
      status: {
        in: [OrderStatus.PENDING, OrderStatus.PAUSED_ISSUE],
      },
    },
    select: {
      id: true,
      erpOrderId: true,
      status: true,
      basketId: true,
      assignedPickerId: true,
      items: { select: { quantityPicked: true, quantityPacked: true } },
      _count: { select: { timeLogs: true } },
    },
  });

  let removed = 0;
  for (const order of candidates) {
    const hasOperationalProgress =
      order.basketId !== null ||
      order.assignedPickerId !== null ||
      order._count.timeLogs > 0 ||
      order.items.some((i) => i.quantityPicked > 0 || i.quantityPacked > 0);
    const action = decideTinySeparacaoBlockAction({
      separacaoSituacao: blocked.get(order.erpOrderId) ?? null,
      status: order.status,
      hasOperationalProgress,
    });
    if (action !== "remove") continue;
    await prisma.order.delete({ where: { id: order.id } });
    removed += 1;
  }

  return { checked: candidates.length, removed };
}

export type TinyReconcileOutcome = "removed" | "flagged" | "kept" | "missing";

/**
 * Aplica a situação atual do Tiny a um pedido do WMS: remove da fila pedidos
 * que ainda não entraram em operação e pausa os que já estão em operação
 * quando cancelados no ERP.
 */
export async function applyTinySituacaoToOrder(params: {
  tenantId: string;
  erpOrderId: string;
  situacao: number | null;
  userId?: string;
}): Promise<TinyReconcileOutcome> {
  const order = await prisma.order.findFirst({
    where: { tenantId: params.tenantId, erpOrderId: params.erpOrderId },
    select: {
      id: true,
      status: true,
      basketId: true,
      assignedPickerId: true,
      items: { select: { quantityPicked: true, quantityPacked: true } },
      _count: { select: { timeLogs: true } },
    },
  });
  if (!order) return "missing";
  if (order.status === OrderStatus.DISPATCHED) return "kept";

  const hasOperationalProgress =
    order.basketId !== null ||
    order.assignedPickerId !== null ||
    order._count.timeLogs > 0 ||
    order.items.some((i) => i.quantityPicked > 0 || i.quantityPacked > 0);

  let action = decideTinyOrderReconcileAction({
    situacao: params.situacao,
    status: order.status,
    hasOperationalProgress,
    alreadyFlagged: false,
  });

  if (action === "flag_cancelled") {
    const [timeLog, stageLog] = await Promise.all([
      prisma.orderTimeLog.findFirst({
        where: { orderId: order.id, reason: TINY_CANCELLED_PAUSE_REASON },
        select: { id: true },
      }),
      prisma.orderStageLog.findFirst({
        where: { orderId: order.id, reason: TINY_CANCELLED_PAUSE_REASON },
        select: { id: true },
      }),
    ]);
    if (timeLog || stageLog) action = "keep";
  }

  if (action === "remove") {
    await prisma.order.delete({ where: { id: order.id } });
    return "removed";
  }

  if (action === "flag_cancelled") {
    await prisma.$transaction(async (tx) => {
      if (order.status !== OrderStatus.PAUSED_ISSUE) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.PAUSED_ISSUE },
        });
      }
      await recordOrderStageChange(tx, {
        tenantId: params.tenantId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: OrderStatus.PAUSED_ISSUE,
        userId: params.userId ?? null,
        reason: TINY_CANCELLED_PAUSE_REASON,
      });
      if (params.userId) {
        await tx.orderTimeLog.create({
          data: {
            orderId: order.id,
            userId: params.userId,
            event: OrderTimeLogEvent.PAUSE,
            reason: TINY_CANCELLED_PAUSE_REASON,
          },
        });
      }
    });
    return "flagged";
  }

  return "kept";
}

export type ReconcileOpenTinyOrdersResult = {
  checked: number;
  cancelledRemoved: number;
  closedRemoved: number;
  cancelledFlagged: number;
  skipped: number;
  errors: Array<{ erpOrderId: string; message: string }>;
  tinyConnected: boolean;
  rateLimited: boolean;
  warning?: string;
};

const TINY_RECONCILE_BATCH = 100;

/** Reconsulta o Tiny para cada pedido TINY-* ainda aberto no WMS e tira da fila os que já saíram do estágio importável. */
export async function reconcileOpenTinyOrders(params: {
  tenantId: string;
  userId?: string;
  connectionId?: string;
}): Promise<ReconcileOpenTinyOrdersResult> {
  const result: ReconcileOpenTinyOrdersResult = {
    checked: 0,
    cancelledRemoved: 0,
    closedRemoved: 0,
    cancelledFlagged: 0,
    skipped: 0,
    errors: [],
    tinyConnected: false,
    rateLimited: false,
  };

  let client;
  try {
    client = await getTinyApiClient({
      tenantId: params.tenantId,
      userId: params.userId,
      connectionId: params.connectionId,
    });
  } catch (e) {
    if (isTinyRateLimitError(e)) {
      result.tinyConnected = true;
      result.rateLimited = true;
      result.warning =
        e instanceof Error
          ? e.message
          : "Rate limit Olist ERP: conciliação pausada.";
      return result;
    }
    result.warning = "Tiny ERP não conectado.";
    return result;
  }
  result.tinyConnected = true;

  let cursor: string | undefined;
  for (;;) {
    const batch: Array<{ id: string; erpOrderId: string }> =
      await prisma.order.findMany({
      where: {
        tenantId: params.tenantId,
        erpOrderId: { startsWith: "TINY-" },
        status: { in: TINY_RECONCILE_ORDER_STATUSES },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: TINY_RECONCILE_BATCH,
      select: { id: true, erpOrderId: true },
    });
    if (batch.length === 0) break;

    for (const order of batch) {
      result.checked += 1;
      cursor = order.id;
      const pedidoId = Number(order.erpOrderId.slice("TINY-".length));
      if (!Number.isFinite(pedidoId) || pedidoId <= 0) {
        result.skipped += 1;
        continue;
      }
      try {
        const full = await client.getPedido(pedidoId);
        const situacao = parseTinyPedidoSituacao(full);
        const outcome = await applyTinySituacaoToOrder({
          tenantId: params.tenantId,
          erpOrderId: order.erpOrderId,
          situacao,
          userId: params.userId,
        });
        if (outcome === "removed") {
          if (situacao === TINY_ORDER_SITUACAO_CANCELADA) result.cancelledRemoved += 1;
          else result.closedRemoved += 1;
        } else if (outcome === "flagged") {
          result.cancelledFlagged += 1;
        } else {
          result.skipped += 1;
        }
      } catch (e) {
        if (isTinyRateLimitError(e)) {
          result.rateLimited = true;
          result.warning =
            e instanceof Error
              ? e.message
              : "Rate limit Olist ERP: conciliação pausada.";
          return result;
        }
        result.errors.push({
          erpOrderId: order.erpOrderId,
          message: e instanceof Error ? e.message : "Erro ao conciliar pedido",
        });
      }
    }
  }

  return result;
}
