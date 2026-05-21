import { InventoryMovementType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode } from "./location-stock.js";
import {
  reconcilePickTargetsAfterStockChange,
  type ReconcileResult,
} from "./pick-location-reconcile.js";

export class LocationAdjustError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "LocationAdjustError";
  }
}

function formatLocation(loc: { corridor: string; row: string; barcode: string }) {
  return `${loc.corridor}-${loc.row} · ${loc.barcode}`;
}

export type AdjustLocationInput = {
  tenantId: string;
  userId: string;
  locationId?: string;
  barcode?: string;
  countedQuantity: number;
  productBarcode?: string;
  reason?: string;
  orderId?: string;
  itemId?: string;
  waveLineId?: string;
};

export type AdjustLocationResult = {
  location: {
    id: string;
    barcode: string;
    type: string;
    corridor: string;
    row: string;
    currentQuantity: number;
    capacity: number;
    minThreshold: number;
    label: string;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
    } | null;
  };
  previousQuantity: number;
  adjustmentDelta: number;
  reconciliation: ReconcileResult;
};

export async function adjustLocationQuantity(
  input: AdjustLocationInput,
): Promise<AdjustLocationResult> {
  const counted = Math.floor(Number(input.countedQuantity));
  if (!Number.isFinite(counted) || counted < 0) {
    throw new LocationAdjustError("Quantidade contada inválida");
  }

  const location = input.locationId
    ? await prisma.location.findFirst({
        where: { id: input.locationId, tenantId: input.tenantId, active: true },
        include: { product: true },
      })
    : await prisma.location.findFirst({
        where: {
          tenantId: input.tenantId,
          barcode: input.barcode?.trim(),
          active: true,
        },
        include: { product: true },
      });

  if (!location) {
    throw new LocationAdjustError("Localização não encontrada", 404);
  }

  if (counted > location.capacity) {
    throw new LocationAdjustError(
      `Quantidade excede a capacidade (${location.capacity})`,
    );
  }

  if (input.productBarcode?.trim() && location.productId) {
    const product = await findProductByBarcode(input.productBarcode);
    if (!product || product.id !== location.productId) {
      throw new LocationAdjustError("Produto não corresponde a este endereço");
    }
  }

  const previousQuantity = location.currentQuantity;
  const delta = counted - previousQuantity;

  const noteParts = [
    "Mobile count correction",
    `was=${previousQuantity}`,
    `counted=${counted}`,
  ];
  if (input.reason?.trim()) noteParts.push(`reason=${input.reason.trim()}`);
  if (input.orderId) noteParts.push(`orderId=${input.orderId}`);
  if (input.waveLineId) noteParts.push(`waveLineId=${input.waveLineId}`);
  const notes = noteParts.join("; ");

  await prisma.$transaction(async (tx) => {
    await tx.location.update({
      where: { id: location.id },
      data: { currentQuantity: counted },
    });

    if (delta !== 0 && location.productId) {
      await tx.inventoryMovement.create({
        data: {
          tenantId: input.tenantId,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: Math.abs(delta),
          userId: input.userId,
          productId: location.productId,
          fromLocationId: delta < 0 ? location.id : undefined,
          toLocationId: delta > 0 ? location.id : undefined,
          orderId: input.orderId,
          notes,
        },
      });
    }
  });

  const productId = location.productId;
  const reconciliation = productId
    ? await reconcilePickTargetsAfterStockChange(input.tenantId, productId, {
        adjustedLocationId: location.id,
        orderId: input.orderId,
        itemId: input.itemId,
        waveLineId: input.waveLineId,
      })
    : {
        pulmaoOnly: false,
        orderItems: [],
        waveLines: [],
        warnings: ["Local sem produto — nenhuma rota de pick recalculada"],
      };

  const updated = await prisma.location.findUnique({
    where: { id: location.id },
    include: { product: true },
  });

  return {
    location: {
      id: updated!.id,
      barcode: updated!.barcode,
      type: updated!.type,
      corridor: updated!.corridor,
      row: updated!.row,
      currentQuantity: updated!.currentQuantity,
      capacity: updated!.capacity,
      minThreshold: updated!.minThreshold,
      label: formatLocation(updated!),
      product: updated!.product
        ? {
            id: updated!.product.id,
            sku: updated!.product.sku,
            name: updated!.product.name,
            barcode: updated!.product.barcode,
          }
        : null,
    },
    previousQuantity,
    adjustmentDelta: delta,
    reconciliation,
  };
}
