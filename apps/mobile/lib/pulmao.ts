import type { LocationLookup } from "@/lib/api";

/** Saldo do SKU no pulmão (o pulmão guarda vários SKUs). */
export function pulmaoQuantityOf(loc: LocationLookup, productId: string): number {
  return loc.stocks.find((s) => s.product.id === productId)?.quantity ?? 0;
}

/** Resumo curto dos SKUs do pulmão, ex.: "PUXA-1 (10) · PUXA-2 (4)". */
export function pulmaoStocksSummary(loc: LocationLookup, max = 3): string {
  if (loc.stocks.length === 0) return "Pulmão vazio";
  const shown = loc.stocks
    .slice(0, max)
    .map((s) => `${s.product.sku} (${s.quantity})`)
    .join(" · ");
  const rest = loc.stocks.length - max;
  return rest > 0 ? `${shown} · +${rest} SKU` : shown;
}
