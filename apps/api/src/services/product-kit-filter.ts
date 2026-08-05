import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { TINY_PRODUCT_TIPO_KIT } from "./tiny-product-sync.js";

const CACHE_MS = 30_000;
const kitIdsCache = new Map<string, { ids: Set<string>; at: number }>();

export async function loadKitProductIds(tenantId: string): Promise<Set<string>> {
  const cached = kitIdsCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.ids;

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM products
    WHERE "tenantId" = ${tenantId} AND "tinyTipo" = ${TINY_PRODUCT_TIPO_KIT}
  `;
  const ids = new Set(rows.map((row) => row.id));
  kitIdsCache.set(tenantId, { ids, at: now });
  return ids;
}

export function invalidateKitProductIdsCache(tenantId?: string): void {
  if (tenantId) kitIdsCache.delete(tenantId);
  else kitIdsCache.clear();
}

export async function markExistingProductAsKit(
  tenantId: string,
  sku: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE products
    SET "tinyTipo" = ${TINY_PRODUCT_TIPO_KIT},
        active = false,
        "updatedAt" = NOW()
    WHERE "tenantId" = ${tenantId}
      AND UPPER(sku) = UPPER(${sku})
  `;
  invalidateKitProductIdsCache(tenantId);
}

export async function saveProductTinyTipo(
  productId: string,
  tinyTipo: string | null,
  tenantId?: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE products
    SET "tinyTipo" = ${tinyTipo}, "updatedAt" = NOW()
    WHERE id = ${productId}
  `;
  if (tenantId) invalidateKitProductIdsCache(tenantId);
}

export function productWhereExcludingKitIds(
  kitIds: Set<string>,
  extra?: Prisma.ProductWhereInput,
): Prisma.ProductWhereInput {
  const excluded = [...kitIds];
  return {
    ...extra,
    ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
  };
}
