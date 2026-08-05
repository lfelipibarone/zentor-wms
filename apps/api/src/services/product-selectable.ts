import type { Prisma } from "@prisma/client";
import {
  loadKitProductIds,
  productWhereExcludingKitIds,
} from "./product-kit-filter.js";

/** Produtos elegíveis para estoque de giro, cadastro e buscas operacionais. */
export async function selectableProductWhere(
  tenantId: string,
  extra?: Prisma.ProductWhereInput,
): Promise<Prisma.ProductWhereInput> {
  const kitIds = await loadKitProductIds(tenantId);
  return productWhereExcludingKitIds(kitIds, extra);
}
