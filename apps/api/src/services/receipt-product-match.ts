import type { Product } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type ReceiptLine = { productCode: string | null; barcode: string | null };
type MatchableProduct = Pick<Product, "sku" | "barcode" | "active">;

export function buildProductLookup<P extends MatchableProduct>(products: P[]) {
  const bySku = new Map<string, P>();
  const byBarcode = new Map<string, P>();
  const ordered = [...products].sort((a, b) => Number(a.active) - Number(b.active));
  for (const p of ordered) {
    bySku.set(p.sku.trim().toLowerCase(), p);
    if (p.barcode) byBarcode.set(p.barcode.trim().toLowerCase(), p);
  }
  return { bySku, byBarcode };
}

/**
 * Produto de uma linha da NF: código do item como SKU, depois como EAN, depois o EAN da linha,
 * por fim o código bipado. Com SKU repetido entre ativo e inativo, vale o ativo.
 */
export function matchReceiptProduct<P extends MatchableProduct>(
  item: ReceiptLine,
  lookup: { bySku: Map<string, P>; byBarcode: Map<string, P> },
  scannedCode?: string | null,
): P | null {
  const candidates = [item.productCode, item.barcode, scannedCode]
    .map((c) => c?.trim().toLowerCase())
    .filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    const hit = lookup.bySku.get(c) ?? lookup.byBarcode.get(c);
    if (hit) return hit;
  }
  return null;
}

/** Busca no banco os produtos que podem casar com a linha (inclui inativos para não duplicar SKU). */
export async function findProductForReceiptLine(
  tenantId: string,
  item: ReceiptLine,
  scannedCode?: string | null,
): Promise<Product | null> {
  const codes = [item.productCode, item.barcode, scannedCode]
    .map((c) => c?.trim())
    .filter((c): c is string => Boolean(c));
  if (codes.length === 0) return null;
  const products = await prisma.product.findMany({
    where: {
      tenantId,
      OR: codes.flatMap((c) => [
        { sku: { equals: c, mode: "insensitive" as const } },
        { barcode: { equals: c, mode: "insensitive" as const } },
      ]),
    },
  });
  return matchReceiptProduct(item, buildProductLookup(products), scannedCode);
}
