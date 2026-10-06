import { LocationType, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type Db = Prisma.TransactionClient | PrismaClient;

export type PulmaoStockKey = {
  tenantId: string;
  locationId: string;
  productId: string;
};

export const pulmaoStockProductSelect = {
  id: true,
  sku: true,
  name: true,
  barcode: true,
  imageUrl: true,
} satisfies Prisma.ProductSelect;

/** SKUs com saldo no pulmão, maior saldo primeiro. */
export const pulmaoStocksInclude = {
  where: { quantity: { gt: 0 } },
  orderBy: [{ quantity: "desc" }, { createdAt: "asc" }],
  include: { product: { select: pulmaoStockProductSelect } },
} satisfies Prisma.Location$stocksArgs;

export async function getPulmaoStockQuantity(
  db: Db,
  locationId: string,
  productId: string,
): Promise<number> {
  const row = await db.locationStock.findUnique({
    where: { locationId_productId: { locationId, productId } },
    select: { quantity: true },
  });
  return row?.quantity ?? 0;
}

/** Soma ao saldo do SKU no pulmão (pulmão não tem limite de unidades). */
export async function addPulmaoStock(
  tx: Prisma.TransactionClient,
  key: PulmaoStockKey,
  quantity: number,
): Promise<number> {
  if (quantity <= 0) return getPulmaoStockQuantity(tx, key.locationId, key.productId);
  const row = await tx.locationStock.upsert({
    where: { locationId_productId: { locationId: key.locationId, productId: key.productId } },
    create: { ...key, quantity },
    update: { quantity: { increment: quantity } },
  });
  await tx.location.update({
    where: { id: key.locationId },
    data: { currentQuantity: { increment: quantity }, productId: null },
  });
  return row.quantity;
}

/**
 * Retira do saldo do SKU no pulmão. Falha (sem alterar nada) se o saldo não cobre a quantidade;
 * `insufficient` monta o erro do chamador com o saldo disponível.
 */
export async function removePulmaoStock(
  tx: Prisma.TransactionClient,
  key: PulmaoStockKey,
  quantity: number,
  insufficient: (available: number) => Error,
): Promise<number> {
  if (quantity <= 0) return getPulmaoStockQuantity(tx, key.locationId, key.productId);
  const { count } = await tx.locationStock.updateMany({
    where: { locationId: key.locationId, productId: key.productId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (count === 0) {
    throw insufficient(await getPulmaoStockQuantity(tx, key.locationId, key.productId));
  }
  await tx.locationStock.deleteMany({
    where: { locationId: key.locationId, productId: key.productId, quantity: { lte: 0 } },
  });
  await tx.location.update({
    where: { id: key.locationId },
    data: { currentQuantity: { decrement: quantity } },
  });
  return getPulmaoStockQuantity(tx, key.locationId, key.productId);
}

/** Define o saldo contado do SKU no pulmão; devolve o saldo anterior. */
export async function setPulmaoStock(
  tx: Prisma.TransactionClient,
  key: PulmaoStockKey,
  quantity: number,
): Promise<number> {
  const previous = await getPulmaoStockQuantity(tx, key.locationId, key.productId);
  const delta = quantity - previous;
  if (delta === 0) return previous;
  if (quantity <= 0) {
    await tx.locationStock.deleteMany({
      where: { locationId: key.locationId, productId: key.productId },
    });
  } else {
    await tx.locationStock.upsert({
      where: { locationId_productId: { locationId: key.locationId, productId: key.productId } },
      create: { ...key, quantity },
      update: { quantity },
    });
  }
  await tx.location.update({
    where: { id: key.locationId },
    data: { currentQuantity: { increment: delta }, productId: null },
  });
  return previous;
}

/**
 * Pulmões de antes do multi-SKU guardavam o SKU em Location.productId: copia esse saldo para
 * LocationStock e libera o pulmão. Idempotente.
 */
export async function migrateLegacyPulmaoStock(db: PrismaClient = prisma) {
  const legacy = await db.location.findMany({
    where: { type: LocationType.PULMAO, productId: { not: null } },
    select: { id: true, tenantId: true, productId: true, currentQuantity: true },
  });
  let migrated = 0;
  for (const loc of legacy) {
    await db.$transaction(async (tx) => {
      const hasStocks = (await tx.locationStock.count({ where: { locationId: loc.id } })) > 0;
      if (!hasStocks && loc.currentQuantity > 0) {
        await tx.locationStock.create({
          data: {
            tenantId: loc.tenantId,
            locationId: loc.id,
            productId: loc.productId!,
            quantity: loc.currentQuantity,
          },
        });
        migrated++;
      }
      await tx.location.update({ where: { id: loc.id }, data: { productId: null } });
    });
  }
  return { released: legacy.length, migrated };
}
