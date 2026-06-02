import { InventoryMovementType, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode, LocationStockError } from "./location-stock.js";

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

  const product = await findProductByBarcode(input.productBarcode);
  if (!product) {
    throw new LocationStockError("Produto não cadastrado", 404);
  }

  const barcode = input.locationBarcode.trim().toUpperCase();
  const location = await prisma.location.findFirst({
    where: { tenantId: input.tenantId, barcode, active: true },
    include: { product: true },
  });

  if (!location) {
    throw new LocationStockError("Posição não encontrada", 404);
  }
  if (location.type !== LocationType.PULMAO) {
    throw new LocationStockError("Informe uma posição de pulmão");
  }
  if (location.productId && location.productId !== product.id) {
    throw new LocationStockError(
      `Pulmão alocado para ${location.product?.sku ?? "outro produto"}`,
    );
  }

  const newQty = Math.min(location.currentQuantity + quantity, location.capacity);
  const added = newQty - location.currentQuantity;
  if (added <= 0) {
    throw new LocationStockError("Pulmão já está na capacidade máxima");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const loc = await tx.location.update({
      where: { id: location.id },
      data: {
        productId: product.id,
        currentQuantity: newQty,
      },
      include: { product: true },
    });

    await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        type: InventoryMovementType.ENTRY,
        quantity: added,
        userId: input.userId,
        productId: product.id,
        toLocationId: location.id,
        notes: "Entrada avulsa no pulmão via mobile",
      },
    });

    return loc;
  });

  return {
    location: {
      id: updated.id,
      barcode: updated.barcode,
      currentQuantity: updated.currentQuantity,
      capacity: updated.capacity,
      product: updated.product,
    },
    added,
  };
}
