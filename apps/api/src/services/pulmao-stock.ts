import { InventoryMovementType, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode, LocationStockError } from "./location-stock.js";
import { addPulmaoStock, pulmaoStocksInclude } from "./pulmao-inventory.js";

export async function stockPulmaoLocation(input: {
  tenantId: string;
  userId: string;
  locationBarcode: string;
  productBarcode: string;
  quantity: number;
}) {
  const quantity = Math.floor(Number(input.quantity));
  if (quantity <= 0) {
    throw new LocationStockError("Quantidade inválida");
  }

  const product = await findProductByBarcode(input.tenantId, input.productBarcode);
  if (!product) {
    throw new LocationStockError("Produto não cadastrado", 404);
  }

  const barcode = input.locationBarcode.trim().toUpperCase();
  const location = await prisma.location.findFirst({
    where: { tenantId: input.tenantId, barcode, active: true },
  });

  if (!location) {
    throw new LocationStockError("Posição não encontrada", 404);
  }
  if (location.type !== LocationType.PULMAO) {
    throw new LocationStockError("Informe uma posição de pulmão");
  }

  const result = await prisma.$transaction(async (tx) => {
    const productQuantity = await addPulmaoStock(
      tx,
      { tenantId: input.tenantId, locationId: location.id, productId: product.id },
      quantity,
    );

    await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        type: InventoryMovementType.ENTRY,
        quantity,
        userId: input.userId,
        productId: product.id,
        toLocationId: location.id,
        notes: "Entrada avulsa no pulmão via mobile",
      },
    });

    const loc = await tx.location.findUniqueOrThrow({
      where: { id: location.id },
      include: { stocks: pulmaoStocksInclude },
    });
    return { loc, productQuantity };
  });

  return {
    location: {
      id: result.loc.id,
      barcode: result.loc.barcode,
      currentQuantity: result.loc.currentQuantity,
      capacity: result.loc.capacity,
      product,
      productQuantity: result.productQuantity,
      stocks: result.loc.stocks.map((s) => ({ product: s.product, quantity: s.quantity })),
    },
    added: quantity,
  };
}
