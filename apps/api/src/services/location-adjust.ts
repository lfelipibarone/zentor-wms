import { LocationType, type Product } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode } from "./location-stock.js";
import { getPulmaoSkuPercent, setPulmaoSkuPercent } from "./pulmao-inventory.js";
import {
  reconcilePickTargetsAfterStockChange,
  type ReconcileResult,
} from "./pick-location-reconcile.js";
import { needsReplenishment, parsePercent, recordPercentMovement, StockPercentError } from "./stock-percent.js";

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
  /** Gôndola: % que ela ficou. Pulmão: % que o SKU ocupa (0 = acabou, sai da lista). */
  percent: unknown;
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
    /** Gôndola: % atual. Pulmão: ocupação total (soma dos SKUs). */
    fillPercent: number;
    minPercent: number;
    needsReplenishment: boolean;
    label: string;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
    } | null;
    /** % do produto informado (no pulmão, só a do SKU) */
    productPercent: number;
  };
  previousPercent: number;
  reconciliation: ReconcileResult;
};

export async function adjustLocationPercent(
  input: AdjustLocationInput,
): Promise<AdjustLocationResult> {
  let percent: number;
  try {
    percent = parsePercent(input.percent);
  } catch (e) {
    if (e instanceof StockPercentError) throw new LocationAdjustError(e.message);
    throw e;
  }

  const location = input.locationId
    ? await prisma.location.findFirst({
        where: { id: input.locationId, tenantId: input.tenantId, active: true },
        include: { product: true },
      })
    : await prisma.location.findFirst({
        where: {
          tenantId: input.tenantId,
          barcode: { equals: input.barcode?.trim(), mode: "insensitive" },
          active: true,
        },
        include: { product: true },
      });

  if (!location) {
    throw new LocationAdjustError("Localização não encontrada", 404);
  }

  const isPulmao = location.type === LocationType.PULMAO;

  let pulmaoProduct: Product | null = null;
  if (isPulmao) {
    if (!input.productBarcode?.trim()) {
      throw new LocationAdjustError("Informe o produto deste pulmão");
    }
    pulmaoProduct = await findProductByBarcode(input.tenantId, input.productBarcode);
    if (!pulmaoProduct) {
      throw new LocationAdjustError("Produto não cadastrado", 404);
    }
  } else {
    if (!location.productId) {
      throw new LocationAdjustError("Gôndola sem SKU associado");
    }
    if (input.productBarcode?.trim()) {
      const product = await findProductByBarcode(input.tenantId, input.productBarcode);
      if (!product || product.id !== location.productId) {
        throw new LocationAdjustError("Produto não corresponde a este endereço");
      }
    }
  }

  const productId = (pulmaoProduct?.id ?? location.productId)!;
  const previousPercent = pulmaoProduct
    ? await getPulmaoSkuPercent(prisma, location.id, pulmaoProduct.id)
    : location.fillPercent;

  const noteParts: string[] = [];
  if (input.reason?.trim()) noteParts.push(input.reason.trim());
  if (input.orderId) noteParts.push(`orderId=${input.orderId}`);
  if (input.waveLineId) noteParts.push(`waveLineId=${input.waveLineId}`);

  await prisma.$transaction(async (tx) => {
    if (pulmaoProduct) {
      await setPulmaoSkuPercent(
        tx,
        { tenantId: input.tenantId, locationId: location.id, productId: pulmaoProduct.id },
        percent,
      );
    } else {
      await tx.location.update({
        where: { id: location.id },
        data: { fillPercent: percent },
      });
    }
    await recordPercentMovement(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      productId,
      locationId: location.id,
      before: previousPercent,
      after: percent,
      reference: "Atualização de %",
      notes: noteParts.join("; ") || null,
      orderId: input.orderId ?? null,
      pickWaveLineId: input.waveLineId ?? null,
    });
  });

  const reconciliation =
    !isPulmao && ((percent <= 0) !== (previousPercent <= 0) || input.orderId)
      ? await reconcilePickTargetsAfterStockChange(input.tenantId, productId, {
          adjustedLocationId: location.id,
          orderId: input.orderId,
          itemId: input.itemId,
          waveLineId: input.waveLineId,
        })
      : { pulmaoOnly: isPulmao, orderItems: [], waveLines: [], warnings: [] };

  const updated = await prisma.location.findUniqueOrThrow({
    where: { id: location.id },
    include: { product: true },
  });
  const shownProduct = pulmaoProduct ?? updated.product;

  return {
    location: {
      id: updated.id,
      barcode: updated.barcode,
      type: updated.type,
      corridor: updated.corridor,
      row: updated.row,
      fillPercent: updated.fillPercent,
      minPercent: updated.minPercent,
      needsReplenishment: !isPulmao && needsReplenishment(updated.fillPercent, updated.minPercent),
      label: formatLocation(updated),
      product: shownProduct
        ? {
            id: shownProduct.id,
            sku: shownProduct.sku,
            name: shownProduct.name,
            barcode: shownProduct.barcode,
          }
        : null,
      productPercent: percent,
    },
    previousPercent,
    reconciliation,
  };
}
