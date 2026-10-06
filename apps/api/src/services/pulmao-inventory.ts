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

/** SKUs guardados no pulmão, maior % primeiro. */
export const pulmaoStocksInclude = {
  where: { percent: { gt: 0 } },
  orderBy: [{ percent: "desc" }, { createdAt: "asc" }],
  include: { product: { select: pulmaoStockProductSelect } },
} satisfies Prisma.Location$stocksArgs;

/** % do SKU no pulmão; 0 quando o SKU não está nele. */
export async function getPulmaoSkuPercent(
  db: Db,
  locationId: string,
  productId: string,
): Promise<number> {
  const row = await db.locationStock.findUnique({
    where: { locationId_productId: { locationId, productId } },
    select: { percent: true },
  });
  return row?.percent ?? 0;
}

/** Ocupação do pulmão = soma das % dos SKUs. */
export async function recomputePulmaoFill(tx: Db, locationId: string): Promise<number> {
  const agg = await tx.locationStock.aggregate({
    where: { locationId },
    _sum: { percent: true },
  });
  const fillPercent = agg._sum.percent ?? 0;
  await tx.location.update({
    where: { id: locationId },
    data: { fillPercent, productId: null },
  });
  return fillPercent;
}

/**
 * Define a % do SKU no pulmão; 0 tira o SKU da lista do pulmão.
 * Devolve a % anterior e a nova ocupação do pulmão.
 */
export async function setPulmaoSkuPercent(
  tx: Prisma.TransactionClient,
  key: PulmaoStockKey,
  percent: number,
): Promise<{ previous: number; fillPercent: number }> {
  const previous = await getPulmaoSkuPercent(tx, key.locationId, key.productId);
  if (percent <= 0) {
    await tx.locationStock.deleteMany({
      where: { locationId: key.locationId, productId: key.productId },
    });
  } else {
    await tx.locationStock.upsert({
      where: { locationId_productId: { locationId: key.locationId, productId: key.productId } },
      create: { ...key, percent },
      update: { percent },
    });
  }
  const fillPercent = await recomputePulmaoFill(tx, key.locationId);
  return { previous, fillPercent };
}

/**
 * Pulmões de antes do multi-SKU guardavam o SKU em Location.productId: copia esse saldo para
 * LocationStock e libera o pulmão. Idempotente.
 */
export async function migrateLegacyPulmaoStock(db: PrismaClient = prisma) {
  const legacy = await db.location.findMany({
    where: { type: LocationType.PULMAO, productId: { not: null } },
    select: { id: true, tenantId: true, productId: true, fillPercent: true },
  });
  let migrated = 0;
  for (const loc of legacy) {
    await db.$transaction(async (tx) => {
      const hasStocks = (await tx.locationStock.count({ where: { locationId: loc.id } })) > 0;
      if (!hasStocks && loc.fillPercent > 0) {
        await tx.locationStock.create({
          data: {
            tenantId: loc.tenantId,
            locationId: loc.id,
            productId: loc.productId!,
            percent: loc.fillPercent,
          },
        });
        migrated++;
      }
      await tx.location.update({ where: { id: loc.id }, data: { productId: null } });
    });
  }
  return { released: legacy.length, migrated };
}
