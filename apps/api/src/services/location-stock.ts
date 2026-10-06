import {
  InventoryMovementType,
  LocationType,
  type Product,
} from "@prisma/client";
import { productMatchesCode } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { parsePercent, StockPercentError } from "./stock-percent.js";

export class LocationStockError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "LocationStockError";
  }
}

/** Produto bipado: aceita EAN, SKU ou QR cadastrado, sem diferenciar maiúsculas. */
export async function findProductByBarcode(
  tenantId: string,
  barcode: string,
): Promise<Product | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;

  return prisma.product.findFirst({
    where: {
      tenantId,
      active: true,
      OR: [
        { barcode: { equals: trimmed, mode: "insensitive" } },
        { sku: { equals: trimmed, mode: "insensitive" } },
        { qrCode: { equals: trimmed, mode: "insensitive" } },
      ],
    },
  });
}

/** Item da NF bipado: compara com o código/EAN da nota e, se não bater, com o cadastro (QR trocado). */
export async function findNfItemByScannedCode<
  T extends { productCode: string | null; barcode: string | null },
>(tenantId: string, items: T[], code: string): Promise<T | undefined> {
  const direct = items.find((it) =>
    productMatchesCode({ sku: it.productCode ?? "", barcode: it.barcode }, code),
  );
  if (direct) return direct;
  const product = await findProductByBarcode(tenantId, code);
  if (!product) return undefined;
  return items.find(
    (it) => productMatchesCode(product, it.productCode) || productMatchesCode(product, it.barcode),
  );
}

export interface StockLocationInput {
  locationId: string;
  productBarcode: string;
  /** % que a gôndola ficou depois de abastecer */
  percent: unknown;
  userId: string;
}

export interface StockLocationResult {
  location: {
    id: string;
    fillPercent: number;
    minPercent: number;
    product: Product | null;
  };
  previousPercent: number;
  movementType: "ENTRY" | "REPLENISHMENT";
}

/** Abastecimento direto da gôndola: grava a % que ela ficou (e associa o SKU se estava livre). */
export async function stockLocation(
  input: StockLocationInput,
): Promise<StockLocationResult> {
  let percent: number;
  try {
    percent = parsePercent(input.percent, "% que a gôndola ficou");
  } catch (e) {
    if (e instanceof StockPercentError) throw new LocationStockError(e.message);
    throw e;
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

  const product = await findProductByBarcode(location.tenantId, productBarcode);
  if (!product) {
    throw new LocationStockError("Produto não cadastrado");
  }

  if (location.productId && location.productId !== product.id) {
    const allocated = location.product?.sku ?? "outro produto";
    throw new LocationStockError(
      `Gôndola alocada para ${allocated}. Não é possível bipar este SKU.`,
    );
  }

  const movementType = !location.productId
    ? InventoryMovementType.ENTRY
    : InventoryMovementType.REPLENISHMENT;

  const updated = await prisma.$transaction(async (tx) => {
    const loc = await tx.location.update({
      where: { id: input.locationId },
      data: {
        productId: product.id,
        fillPercent: percent,
      },
      include: { product: true },
    });

    await tx.inventoryMovement.create({
      data: {
        tenantId: location.tenantId,
        type: movementType,
        quantity: 0,
        percentBefore: location.fillPercent,
        percentAfter: percent,
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
      fillPercent: updated.fillPercent,
      minPercent: updated.minPercent,
      product: updated.product,
    },
    previousPercent: location.fillPercent,
    movementType:
      movementType === InventoryMovementType.ENTRY ? "ENTRY" : "REPLENISHMENT",
  };
}
