import {
  InventoryMovementType,
  PickWaveLineSortStatus,
  PickWaveStatus,
} from "@prisma/client";
import { gondolaScanMatches, productMatchesCode } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { PickWaveError, assertWaveOperatorForMutation } from "./pick-wave.js";
import { checkOrderComplete } from "./pick-wave-sort.js";
import { ensurePickingStartLog } from "./order-time-log-helpers.js";
import { assertWaveShareStarted, finishShareIfDone } from "./work-share.js";
import { decrementFaceOnPick, stockModeFields } from "./location-level.js";
import { reconcilePickTargetsAfterStockChange } from "./pick-location-reconcile.js";

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
  const shareId = await assertWaveShareStarted(line.waveId, line.partId, input.userId);
  await assertWaveOperatorForMutation(line.waveId, input.userId, line.partId);
  if (line.sortStatus === PickWaveLineSortStatus.SORTED) {
    throw new PickWaveError("Linha já finalizada no packing");
  }

  const scanned = input.locationBarcode ?? "";
  let locationOk = gondolaScanMatches({
    locationBarcode: line.pickLocation.barcode,
    scanned,
    product: line.product,
  });
  if (!locationOk && scanned.trim()) {
    const found = await prisma.location.findFirst({
      where: {
        tenantId: line.wave.tenantId,
        active: true,
        barcode: { equals: scanned.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });
    locationOk = found?.id === line.pickLocationId;
  }
  if (!locationOk) {
    throw new PickWaveError("Gôndola incorreta para esta linha");
  }

  if (input.productBarcode && !productMatchesCode(line.product, input.productBarcode)) {
    throw new PickWaveError("Produto não corresponde à linha da onda");
  }

  const remainingLine = line.quantityTotal - line.quantityPicked;
  if (quantity > remainingLine) {
    throw new PickWaveError(
      `Quantidade excede o pendente da onda (máx. ${remainingLine})`,
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

  const level = await prisma.$transaction(async (tx) => {
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
    const change = await decrementFaceOnPick(tx, line.pickLocation, quantity);

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
        ...(change ? { percentBefore: change.before, percentAfter: change.after } : {}),
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
      await checkOrderComplete(orderId, line.wave.tenantId, input.userId, tx);
    }
    return change;
  });

  if (shareId) await finishShareIfDone(shareId);

  if (level && level.unitsAfter <= 0 && level.unitsBefore > 0) {
    await reconcilePickTargetsAfterStockChange(line.wave.tenantId, line.productId, {
      adjustedLocationId: line.pickLocationId,
      waveLineId: line.id,
    });
  }

  const updated = await prisma.pickWaveLine.findUnique({
    where: { id: line.id },
    include: { product: true, pickLocation: true },
  });

  const pendingWhere = {
    sortStatus: PickWaveLineSortStatus.PENDING,
  } as const;
  const [pendingInWave, pendingInPart] = await Promise.all([
    prisma.pickWaveLine.count({
      where: { waveId: line.waveId, ...pendingWhere },
    }),
    line.partId
      ? prisma.pickWaveLine.count({
          where: { waveId: line.waveId, partId: line.partId, ...pendingWhere },
        })
      : Promise.resolve(0),
  ]);

  if (pendingInWave === 0) {
    const waveOrders = await prisma.pickWaveOrder.findMany({
      where: { waveId: line.waveId },
      select: { orderId: true },
    });
    await prisma.$transaction(async (tx) => {
      for (const { orderId } of waveOrders) {
        await checkOrderComplete(orderId, line.wave.tenantId, input.userId, tx);
      }
    });
    // Gera etiqueta de TODOS os pedidos da onda (ex.: 10/10) em background
    const { scheduleWaveShippingLabels } = await import(
      "./ensure-shipping-labels.js"
    );
    scheduleWaveShippingLabels(line.wave.tenantId, line.waveId);
  }

  return {
    quantityPicked: updated!.quantityPicked,
    quantityTotal: updated!.quantityTotal,
    sortStatus: updated!.sortStatus,
    readyForSort: updated!.sortStatus === PickWaveLineSortStatus.PICKED,
    wavePickFinished: pendingInWave === 0,
    partPickFinished: line.partId ? pendingInPart === 0 : pendingInWave === 0,
    location: {
      id: updated!.pickLocation.id,
      fillPercent: updated!.pickLocation.fillPercent,
      minPercent: updated!.pickLocation.minPercent,
      ...stockModeFields(updated!.pickLocation),
    },
  };
}
