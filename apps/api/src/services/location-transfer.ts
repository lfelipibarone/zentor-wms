import { InventoryMovementType, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode } from "./location-stock.js";

export class LocationTransferError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "LocationTransferError";
  }
}

export interface TransferLocationInput {
  fromLocationBarcode: string;
  toLocationBarcode: string;
  productBarcode: string;
  quantity: number;
  userId: string;
}

export interface TransferLocationResult {
  fromLocation: {
    id: string;
    barcode: string;
    currentQuantity: number;
  };
  toLocation: {
    id: string;
    barcode: string;
    currentQuantity: number;
    productId: string | null;
  };
  transferred: number;
}

export async function transferPulmaoToPickFace(
  input: TransferLocationInput,
): Promise<TransferLocationResult> {
  const quantity = Math.floor(Number(input.quantity));
  if (quantity <= 0) {
    throw new LocationTransferError("Quantidade inválida");
  }

  const fromBarcode = input.fromLocationBarcode.trim().toUpperCase();
  const toBarcode = input.toLocationBarcode.trim().toUpperCase();

  const [fromLoc, toLoc] = await Promise.all([
    prisma.location.findFirst({
      where: { barcode: fromBarcode, active: true },
      include: { product: true },
    }),
    prisma.location.findFirst({
      where: { barcode: toBarcode, active: true },
      include: { product: true },
    }),
  ]);

  if (!fromLoc) {
    throw new LocationTransferError("Pulmão de origem não encontrado", 404);
  }
  if (fromLoc.type !== LocationType.PULMAO) {
    throw new LocationTransferError("Origem deve ser um pulmão");
  }
  if (!toLoc) {
    throw new LocationTransferError("Gôndola de destino não encontrada", 404);
  }
  if (toLoc.type !== LocationType.PICK_FACE) {
    throw new LocationTransferError("Destino deve ser uma gôndola (pick face)");
  }

  const product = await findProductByBarcode(input.productBarcode);
  if (!product) {
    throw new LocationTransferError("Produto não cadastrado");
  }

  if (fromLoc.productId && fromLoc.productId !== product.id) {
    throw new LocationTransferError("Produto não corresponde ao pulmão de origem");
  }
  if (toLoc.productId && toLoc.productId !== product.id) {
    throw new LocationTransferError(
      "Gôndola já alocada para outro produto",
    );
  }

  if (fromLoc.currentQuantity < quantity) {
    throw new LocationTransferError(
      `Estoque insuficiente no pulmão (disponível: ${fromLoc.currentQuantity})`,
    );
  }

  const newToQty = Math.min(toLoc.currentQuantity + quantity, toLoc.capacity);
  const transferred = newToQty - toLoc.currentQuantity;
  if (transferred <= 0) {
    throw new LocationTransferError("Gôndola já está na capacidade máxima");
  }

  const newFromQty = fromLoc.currentQuantity - transferred;

  const [fromUpdated, toUpdated] = await prisma.$transaction(async (tx) => {
    const from = await tx.location.update({
      where: { id: fromLoc.id },
      data: {
        productId: product.id,
        currentQuantity: newFromQty,
      },
    });
    const to = await tx.location.update({
      where: { id: toLoc.id },
      data: {
        productId: product.id,
        currentQuantity: newToQty,
      },
    });
    await tx.inventoryMovement.create({
      data: {
        tenantId: fromLoc.tenantId,
        type: InventoryMovementType.TRANSFER,
        quantity: transferred,
        userId: input.userId,
        productId: product.id,
        fromLocationId: fromLoc.id,
        toLocationId: toLoc.id,
        notes: "Transferência pulmão → gôndola via mobile",
      },
    });
    return [from, to] as const;
  });

  return {
    fromLocation: {
      id: fromUpdated.id,
      barcode: fromUpdated.barcode,
      currentQuantity: fromUpdated.currentQuantity,
    },
    toLocation: {
      id: toUpdated.id,
      barcode: toUpdated.barcode,
      currentQuantity: toUpdated.currentQuantity,
      productId: toUpdated.productId,
    },
    transferred,
  };
}
