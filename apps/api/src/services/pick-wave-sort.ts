import { OrderStatus, PickWaveLineSortStatus, PickWaveStatus } from "@prisma/client";
import { Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { PickWaveError, assertWaveOperatorForMutation } from "./pick-wave.js";
import { recordOrderStageChange } from "./order-stage-log.js";
import {
  ensureDispatchStartLog,
  ensurePackEndLog,
  ensurePackStartLog,
  ensurePickingEndLog,
} from "./order-time-log-helpers.js";
import { notifyUsersWithPermission } from "./notifications.js";

export interface SortAllocationInput {
  lineId: string;
  allocationId: string;
  quantity: number;
  basketBarcode?: string;
  userId: string;
  /** Packing pelo painel web — não exige ser o operador que aceitou a onda no mobile */
  webPacking?: boolean;
}

export async function checkOrderComplete(
  orderId: string,
  tenantId: string,
  userId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const complete = items.every(
    (i) => i.quantityPicked >= i.quantityOrdered,
  );
  if (!complete) return;

  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  if (order.status === OrderStatus.PICKED_AWAITING_CONFERENCE) return;

  await tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.PICKED_AWAITING_CONFERENCE },
  });
  await recordOrderStageChange(tx, {
    tenantId,
    orderId,
    fromStatus: order.status,
    toStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
    userId,
  });
  await ensurePickingEndLog(tx, orderId, userId);
}

/** Quando todas as alocações do pedido estão sorted → PACK_END + DISPATCHING. */
async function finalizeOrderIfFullySorted(
  orderId: string,
  tenantId: string,
  userId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<boolean> {
  const allocations = await tx.pickWaveAllocation.findMany({
    where: { orderItem: { orderId } },
  });
  if (allocations.length === 0) return false;

  const allSorted = allocations.every((a) => a.quantitySorted >= a.quantity);
  if (!allSorted) return false;

  await ensurePackEndLog(tx, orderId, userId);

  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) return false;
  if (
    order.status === OrderStatus.DISPATCHING ||
    order.status === OrderStatus.DISPATCHED
  ) {
    return true;
  }

  await tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.DISPATCHING },
  });
  await recordOrderStageChange(tx, {
    tenantId,
    orderId,
    fromStatus: order.status,
    toStatus: OrderStatus.DISPATCHING,
    userId,
  });
  await ensureDispatchStartLog(tx, orderId, userId);
  return true;
}

export async function confirmSortAllocation(input: SortAllocationInput) {
  const quantity = Math.floor(Number(input.quantity));
  if (quantity <= 0) {
    throw new PickWaveError("Quantidade inválida");
  }

  const line = await prisma.pickWaveLine.findUnique({
    where: { id: input.lineId },
    include: {
      wave: true,
      allocations: {
        include: {
          orderItem: { include: { order: true } },
        },
      },
    },
  });

  if (!line) throw new PickWaveError("Linha não encontrada", 404);
  if (line.wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está ativa");
  }
  if (!input.webPacking) {
    await assertWaveOperatorForMutation(line.waveId, input.userId, line.partId);
  } else {
    const stillPicking = await prisma.pickWaveLine.count({
      where: {
        waveId: line.waveId,
        sortStatus: PickWaveLineSortStatus.PENDING,
      },
    });
    if (stillPicking > 0) {
      throw new PickWaveError("A onda ainda está em separação. Confira quando o separador finalizar.");
    }
  }
  const alloc = line.allocations.find((a) => a.id === input.allocationId);
  if (!alloc) throw new PickWaveError("Alocação não encontrada", 404);

  const allocRemaining = alloc.quantity - alloc.quantitySorted;
  if (quantity > allocRemaining) {
    throw new PickWaveError(`Máximo para este pedido: ${allocRemaining}`);
  }

  // Linha parcial só acontece quando o packing devolveu um pedido ao separador:
  // os outros pedidos seguem conferindo, o devolvido espera a nova coleta.
  if (line.quantityPicked < line.quantityTotal) {
    const pickedForAlloc = Math.min(alloc.orderItem.quantityPicked, alloc.quantity);
    if (pickedForAlloc - alloc.quantitySorted < quantity) {
      throw new PickWaveError(
        alloc.quantitySorted === 0 && pickedForAlloc === 0
          ? "Aguardando o separador coletar de novo para este pedido"
          : "Conclua o pick na gôndola antes do packing",
      );
    }
  }

  let basketId = alloc.orderItem.order.basketId;
  if (input.basketBarcode?.trim()) {
    const basket = await prisma.basket.findFirst({
      where: { barcode: input.basketBarcode.trim(), active: true },
    });
    if (!basket) throw new PickWaveError("Cesta não encontrada", 404);
    basketId = basket.id;
  } else if (!basketId && !input.webPacking) {
    throw new PickWaveError("Bipe a cesta do pedido antes de confirmar");
  }

  const newSorted = alloc.quantitySorted + quantity;
  const allocComplete = newSorted >= alloc.quantity;
  const now = new Date();
  const orderId = alloc.orderItem.orderId;
  const erpOrderId = alloc.orderItem.order.erpOrderId;
  const tenantId = line.wave.tenantId;
  let orderCompleted = false;

  await prisma.$transaction(async (tx) => {
    await ensurePackStartLog(tx, orderId, input.userId);

    await tx.pickWaveAllocation.update({
      where: { id: alloc.id },
      data: {
        quantitySorted: newSorted,
        sortedById: input.userId,
        ...(alloc.sortStartedAt == null ? { sortStartedAt: now } : {}),
        ...(allocComplete ? { sortCompletedAt: now } : {}),
      },
    });

    const orderItem = await tx.orderItem.findUnique({
      where: { id: alloc.orderItemId },
    });
    if (orderItem) {
      const nextPacked = Math.min(
        orderItem.quantityPicked,
        orderItem.quantityPacked + quantity,
      );
      if (nextPacked !== orderItem.quantityPacked) {
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: { quantityPacked: nextPacked },
        });
      }
    }

    if (basketId && alloc.orderItem.order.basketId !== basketId) {
      await tx.order.update({
        where: { id: orderId },
        data: { basketId },
      });
    }

    const allSorted = line.allocations.every((a) => {
      const next =
        a.id === alloc.id ? newSorted : a.quantitySorted;
      return next >= a.quantity;
    });

    if (allSorted) {
      await tx.pickWaveLine.update({
        where: { id: line.id },
        data: { sortStatus: PickWaveLineSortStatus.SORTED },
      });
    }

    await checkOrderComplete(orderId, tenantId, input.userId, tx);
    orderCompleted = await finalizeOrderIfFullySorted(
      orderId,
      tenantId,
      input.userId,
      tx,
    );
  });

  if (orderCompleted) {
    await notifyUsersWithPermission(Permission.SHIPPING_VIEW, {
      title: "Pedido pronto para expedir",
      body: `${erpOrderId} aguarda despacho.`,
      category: "SHIPPING",
      data: { orderId, erpOrderId },
    });
  }

  const updatedAlloc = await prisma.pickWaveAllocation.findUnique({
    where: { id: alloc.id },
    include: {
      orderItem: { include: { order: { include: { basket: true } } } },
    },
  });

  const updatedLine = await prisma.pickWaveLine.findUnique({
    where: { id: line.id },
  });

  return {
    quantitySorted: updatedAlloc!.quantitySorted,
    allocationRemaining:
      updatedAlloc!.quantity - updatedAlloc!.quantitySorted,
    lineSortStatus: updatedLine!.sortStatus,
    basketCode: updatedAlloc!.orderItem.order.basket?.code ?? null,
    orderId,
    erpOrderId,
    orderStatus: updatedAlloc!.orderItem.order.status,
    orderCompleted,
  };
}
