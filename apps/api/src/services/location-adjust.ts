import { InventoryMovementType, LocationType, type Product } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode } from "./location-stock.js";
import { getPulmaoStockQuantity, setPulmaoStock } from "./pulmao-inventory.js";
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
    /** Saldo do produto informado (no pulmão, só o do SKU contado) */
    productQuantity: number;
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

  const isPulmao = location.type === LocationType.PULMAO;

  if (!isPulmao && counted > location.capacity) {
    throw new LocationAdjustError(
      `Quantidade excede a capacidade (${location.capacity})`,
    );
  }

  let pulmaoProduct: Product | null = null;
  if (isPulmao) {
    if (!input.productBarcode?.trim()) {
      throw new LocationAdjustError("Informe o produto contado neste pulmão");
    }
    pulmaoProduct = await findProductByBarcode(input.tenantId, input.productBarcode);
    if (!pulmaoProduct) {
      throw new LocationAdjustError("Produto não cadastrado", 404);
    }
  } else if (input.productBarcode?.trim() && location.productId) {
    const product = await findProductByBarcode(input.tenantId, input.productBarcode);
    if (!product || product.id !== location.productId) {
      throw new LocationAdjustError("Produto não corresponde a este endereço");
    }
  }

  const productId = pulmaoProduct?.id ?? location.productId;
  const previousQuantity = pulmaoProduct
    ? await getPulmaoStockQuantity(prisma, location.id, pulmaoProduct.id)
    : location.currentQuantity;
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
    if (pulmaoProduct) {
      await setPulmaoStock(
        tx,
        { tenantId: input.tenantId, locationId: location.id, productId: pulmaoProduct.id },
        counted,
      );
    } else {
      await tx.location.update({
        where: { id: location.id },
        data: { currentQuantity: counted },
      });
    }

    if (delta !== 0 && productId) {
      await tx.inventoryMovement.create({
        data: {
          tenantId: input.tenantId,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: Math.abs(delta),
          userId: input.userId,
          productId,
          fromLocationId: delta < 0 ? location.id : undefined,
          toLocationId: delta > 0 ? location.id : undefined,
          orderId: input.orderId,
          notes,
        },
      });
    }
  });

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
  const shownProduct = pulmaoProduct ?? updated!.product;

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
      product: shownProduct
        ? {
            id: shownProduct.id,
            sku: shownProduct.sku,
            name: shownProduct.name,
            barcode: shownProduct.barcode,
          }
        : null,
      productQuantity: pulmaoProduct ? counted : updated!.currentQuantity,
    },
    previousQuantity,
    adjustmentDelta: delta,
    reconciliation,
  };
}
