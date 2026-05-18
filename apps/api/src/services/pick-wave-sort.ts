import { OrderStatus, PickWaveLineSortStatus, PickWaveStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { PickWaveError, assertWaveOperatorForMutation } from "./pick-wave.js";

export interface SortAllocationInput {
  lineId: string;
  allocationId: string;
  quantity: number;
  basketBarcode?: string;
  userId: string;
}

async function checkOrderComplete(orderId: string, tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const complete = items.every(
    (i) => i.quantityPicked >= i.quantityOrdered,
  );
  if (complete) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PICKED_AWAITING_CONFERENCE },
    });
  }
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
  await assertWaveOperatorForMutation(line.waveId, input.userId);
  if (line.quantityPicked < line.quantityTotal) {
    throw new PickWaveError("Conclua o pick na gôndola antes do packing");
  }

  const alloc = line.allocations.find((a) => a.id === input.allocationId);
  if (!alloc) throw new PickWaveError("Alocação não encontrada", 404);

  const allocRemaining = alloc.quantity - alloc.quantitySorted;
  if (quantity > allocRemaining) {
    throw new PickWaveError(`Máximo para este pedido: ${allocRemaining}`);
  }

  let basketId = alloc.orderItem.order.basketId;
  if (input.basketBarcode?.trim()) {
    const basket = await prisma.basket.findFirst({
      where: { barcode: input.basketBarcode.trim(), active: true },
    });
    if (!basket) throw new PickWaveError("Cesta não encontrada", 404);
    basketId = basket.id;
  } else if (!basketId) {
    throw new PickWaveError("Bipe a cesta do pedido antes de confirmar");
  }

  const newSorted = alloc.quantitySorted + quantity;
  const allocComplete = newSorted >= alloc.quantity;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.pickWaveAllocation.update({
      where: { id: alloc.id },
      data: {
        quantitySorted: newSorted,
        sortedById: input.userId,
        ...(alloc.sortStartedAt == null ? { sortStartedAt: now } : {}),
        ...(allocComplete ? { sortCompletedAt: now } : {}),
      },
    });

    if (basketId && alloc.orderItem.order.basketId !== basketId) {
      await tx.order.update({
        where: { id: alloc.orderItem.orderId },
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

    await checkOrderComplete(alloc.orderItem.orderId, tx);
  });

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
    orderStatus: updatedAlloc!.orderItem.order.status,
  };
}
