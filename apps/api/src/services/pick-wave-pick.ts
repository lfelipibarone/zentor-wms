import {
  InventoryMovementType,
  PickWaveLineSortStatus,
  PickWaveStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { PickWaveError, assertWaveOperatorForMutation } from "./pick-wave.js";
import { findProductByBarcode } from "./location-stock.js";
import {
  ensurePickingEndLog,
  ensurePickingStartLog,
} from "./order-time-log-helpers.js";

export interface ConsolidatedPickInput {
  lineId: string;
  locationBarcode: string;
  productBarcode?: string;
  quantity: number;
  userId: string;
}

export async function confirmConsolidatedPick(input: ConsolidatedPickInput) {
  const quantity = Math.floor(Number(input.quantity));
  if (quantity <= 0) {
    throw new PickWaveError("Quantidade inválida");
  }

  const line = await prisma.pickWaveLine.findUnique({
    where: { id: input.lineId },
    include: {
      wave: true,
      product: true,
      pickLocation: true,
      allocations: {
        include: { orderItem: true },
      },
    },
  });

  if (!line) throw new PickWaveError("Linha da onda não encontrada", 404);
  if (line.wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está ativa");
  }
  await assertWaveOperatorForMutation(line.waveId, input.userId);
  if (line.sortStatus === PickWaveLineSortStatus.SORTED) {
    throw new PickWaveError("Linha já finalizada no packing");
  }

  const locBarcode = input.locationBarcode.trim().toUpperCase();
  if (line.pickLocation.barcode !== locBarcode) {
    throw new PickWaveError("Gôndola incorreta para esta linha");
  }

  if (input.productBarcode) {
    const product = await findProductByBarcode(input.productBarcode);
    if (!product || product.id !== line.productId) {
      throw new PickWaveError("Produto não corresponde à linha da onda");
    }
  }

  const remainingLine = line.quantityTotal - line.quantityPicked;
  if (quantity > remainingLine) {
    throw new PickWaveError(
      `Quantidade excede o pendente da onda (máx. ${remainingLine})`,
    );
  }

  if (line.pickLocation.currentQuantity < quantity) {
    throw new PickWaveError(
      `Estoque insuficiente na gôndola (disponível: ${line.pickLocation.currentQuantity})`,
    );
  }

  let toAllocate = quantity;
  const allocationUpdates: { id: string; addPick: number; addSorted: number }[] =
    [];

  const sortedAllocs = [...line.allocations].sort((a, b) => {
    const da = a.orderItem.quantityOrdered - a.orderItem.quantityPicked;
    const db = b.orderItem.quantityOrdered - b.orderItem.quantityPicked;
    return db - da;
  });

  for (const alloc of sortedAllocs) {
    if (toAllocate <= 0) break;
    const pickedFromWave = Math.min(
      alloc.orderItem.quantityPicked,
      alloc.quantity,
    );
    const allocPickRemaining = alloc.quantity - pickedFromWave;
    const itemRemaining =
      alloc.orderItem.quantityOrdered - alloc.orderItem.quantityPicked;
    const canTake = Math.min(toAllocate, allocPickRemaining, itemRemaining);
    if (canTake <= 0) continue;
    allocationUpdates.push({
      id: alloc.id,
      addPick: canTake,
      addSorted: 0,
    });
    toAllocate -= canTake;
  }

  if (toAllocate > 0) {
    throw new PickWaveError("Não foi possível alocar quantidade nos pedidos");
  }

  const newLinePicked = line.quantityPicked + quantity;
  const newSortStatus =
    newLinePicked >= line.quantityTotal
      ? PickWaveLineSortStatus.PICKED
      : line.sortStatus === PickWaveLineSortStatus.PENDING
        ? PickWaveLineSortStatus.PENDING
        : line.sortStatus;

  await prisma.$transaction(async (tx) => {
    await tx.location.update({
      where: { id: line.pickLocationId },
      data: { currentQuantity: { decrement: quantity } },
    });

    for (const upd of allocationUpdates) {
      const alloc = line.allocations.find((a) => a.id === upd.id)!;
      const newPicked = alloc.orderItem.quantityPicked + upd.addPick;
      await tx.orderItem.update({
        where: { id: alloc.orderItemId },
        data: { quantityPicked: newPicked },
      });
    }

    const now = new Date();
    const firstOrderId = line.allocations[0]?.orderItem?.orderId ?? null;

    await tx.inventoryMovement.create({
      data: {
        tenantId: line.wave.tenantId,
        type: InventoryMovementType.PICK_ALLOCATION,
        quantity,
        userId: input.userId,
        productId: line.productId,
        fromLocationId: line.pickLocationId,
        orderId: firstOrderId,
        pickWaveLineId: line.id,
        startedAt: line.pickStartedAt ?? now,
        completedAt: now,
        notes: `Pick consolidado onda · linha ${line.id}`,
      },
    });

    const lineComplete = newLinePicked >= line.quantityTotal;
    await tx.pickWaveLine.update({
      where: { id: line.id },
      data: {
        quantityPicked: newLinePicked,
        sortStatus: lineComplete
          ? PickWaveLineSortStatus.PICKED
          : newSortStatus,
        pickedById: input.userId,
        ...(line.pickStartedAt == null
          ? { pickStartedAt: now }
          : {}),
        ...(lineComplete ? { pickCompletedAt: now } : {}),
      },
    });

    const affectedOrderIds = new Set(
      allocationUpdates.map((upd) => {
        const alloc = line.allocations.find((a) => a.id === upd.id)!;
        return alloc.orderItem.orderId;
      }),
    );

    for (const orderId of affectedOrderIds) {
      await ensurePickingStartLog(tx, orderId, input.userId);

      const items = await tx.orderItem.findMany({ where: { orderId } });
      const pickComplete = items.every(
        (i) => i.quantityPicked >= i.quantityOrdered,
      );
      if (pickComplete) {
        await ensurePickingEndLog(tx, orderId, input.userId);
      }
    }
  });

  const updated = await prisma.pickWaveLine.findUnique({
    where: { id: line.id },
    include: { product: true, pickLocation: true },
  });

  return {
    quantityPicked: updated!.quantityPicked,
    quantityTotal: updated!.quantityTotal,
    sortStatus: updated!.sortStatus,
    readyForSort: updated!.sortStatus === PickWaveLineSortStatus.PICKED,
    location: {
      currentQuantity: updated!.pickLocation.currentQuantity,
    },
  };
}
