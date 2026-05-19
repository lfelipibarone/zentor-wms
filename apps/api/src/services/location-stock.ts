import {
  InventoryMovementType,
  LocationType,
  type Product,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export class LocationStockError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "LocationStockError";
  }
}

export async function findProductByBarcode(
  barcode: string,
): Promise<Product | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;

  return prisma.product.findFirst({
    where: {
      active: true,
      OR: [
        { barcode: { equals: trimmed, mode: "insensitive" } },
        { sku: { equals: trimmed, mode: "insensitive" } },
      ],
    },
  });
}

export interface StockLocationInput {
  locationId: string;
  productBarcode: string;
  quantity?: number;
  userId: string;
}

export interface StockLocationResult {
  location: {
    id: string;
    currentQuantity: number;
    capacity: number;
    minThreshold: number;
    product: Product | null;
  };
  added: number;
  movementType: "ENTRY" | "REPLENISHMENT";
}

export async function stockLocation(
  input: StockLocationInput,
): Promise<StockLocationResult> {
  const quantity = Math.floor(Number(input.quantity ?? 1));
  if (quantity <= 0) {
    throw new LocationStockError("Quantidade inválida");
  }

  const productBarcode = input.productBarcode.trim();
  if (!productBarcode) {
    throw new LocationStockError("Código do produto obrigatório");
  }

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
    include: { product: true },
  });

  if (!location || !location.active) {
    throw new LocationStockError("Gôndola não encontrada", 404);
  }

  if (location.type !== LocationType.PICK_FACE) {
    throw new LocationStockError("Abastecimento apenas em gôndolas (pick face)");
  }

  const product = await findProductByBarcode(productBarcode);
  if (!product) {
    throw new LocationStockError("Produto não cadastrado");
  }

  if (location.productId && location.productId !== product.id) {
    const allocated = location.product?.sku ?? "outro produto";
    throw new LocationStockError(
      `Gôndola alocada para ${allocated}. Não é possível bipar este SKU.`,
    );
  }

  const newQty = Math.min(location.currentQuantity + quantity, location.capacity);
  const added = newQty - location.currentQuantity;

  if (added <= 0) {
    throw new LocationStockError("Gôndola já está na capacidade máxima");
  }

  const movementType = !location.productId
    ? InventoryMovementType.ENTRY
    : InventoryMovementType.REPLENISHMENT;

  const updated = await prisma.$transaction(async (tx) => {
    const loc = await tx.location.update({
      where: { id: input.locationId },
      data: {
        productId: product.id,
        currentQuantity: newQty,
      },
      include: { product: true },
    });

    await tx.inventoryMovement.create({
      data: {
        tenantId: location.tenantId,
        type: movementType,
        quantity: added,
        userId: input.userId,
        productId: product.id,
        toLocationId: input.locationId,
        notes:
          movementType === InventoryMovementType.ENTRY
            ? "Abastecimento inicial via mobile"
            : "Abastecimento via mobile",
      },
    });

    return loc;
  });

  return {
    location: {
      id: updated.id,
      currentQuantity: updated.currentQuantity,
      capacity: updated.capacity,
      minThreshold: updated.minThreshold,
      product: updated.product,
    },
    added,
    movementType:
      movementType === InventoryMovementType.ENTRY ? "ENTRY" : "REPLENISHMENT",
  };
}
