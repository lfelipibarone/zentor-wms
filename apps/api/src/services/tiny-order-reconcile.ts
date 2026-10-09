import { OrderStatus, OrderTimeLogEvent } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { recordOrderStageChange } from "./order-stage-log.js";
import {
  TINY_ORDER_SITUACAO_CANCELADA,
  TINY_ORDER_SITUACOES_ENCERRADAS,
} from "./tiny-integration.js";

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
  if (!TINY_ORDER_SITUACOES_ENCERRADAS.has(params.situacao)) return "keep";

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
