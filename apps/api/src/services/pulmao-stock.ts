import { InventoryMovementType, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode, LocationStockError } from "./location-stock.js";
import { pulmaoStocksInclude, setPulmaoSkuPercent } from "./pulmao-inventory.js";
import { parsePercent, StockPercentError } from "./stock-percent.js";

/** Entrada avulsa: guarda um SKU no pulmão informando a % que ele passa a ocupar. */
export async function stockPulmaoLocation(input: {
  tenantId: string;
  userId: string;
  locationBarcode: string;
  productBarcode: string;
  percent: unknown;
}) {
  let percent: number;
  try {
    percent = parsePercent(input.percent, "% do SKU no pulmão");
  } catch (e) {
    if (e instanceof StockPercentError) throw new LocationStockError(e.message);
    throw e;
  }
  if (percent <= 0) {
    throw new LocationStockError("Informe quanto o SKU ocupa no pulmão (mínimo 1%)");
  }

  const product = await findProductByBarcode(input.tenantId, input.productBarcode);
  if (!product) {
    throw new LocationStockError("Produto não cadastrado", 404);
  }

  const location = await prisma.location.findFirst({
    where: {
      tenantId: input.tenantId,
      barcode: { equals: input.locationBarcode.trim(), mode: "insensitive" },
      active: true,
    },
  });

  if (!location) {
    throw new LocationStockError("Posição não encontrada", 404);
  }
  if (location.type !== LocationType.PULMAO) {
    throw new LocationStockError("Informe uma posição de pulmão");
  }

  const loc = await prisma.$transaction(async (tx) => {
    const { previous } = await setPulmaoSkuPercent(
      tx,
      { tenantId: input.tenantId, locationId: location.id, productId: product.id },
      percent,
    );

    await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        type: InventoryMovementType.ENTRY,
        quantity: 0,
        percentBefore: previous,
        percentAfter: percent,
        userId: input.userId,
        productId: product.id,
        toLocationId: location.id,
        notes: "Entrada avulsa no pulmão via mobile",
      },
    });

    return tx.location.findUniqueOrThrow({
      where: { id: location.id },
      include: { stocks: pulmaoStocksInclude },
    });
  });

  return {
    location: {
      id: loc.id,
      barcode: loc.barcode,
      fillPercent: loc.fillPercent,
      product,
      productPercent: percent,
      stocks: loc.stocks.map((s) => ({ product: s.product, percent: s.percent })),
    },
  };
}
