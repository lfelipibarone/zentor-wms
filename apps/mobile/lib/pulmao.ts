import type { LocationLookup } from "@/lib/api";

/** % que o SKU ocupa no pulmão (o pulmão guarda vários SKUs). */
export function pulmaoPercentOf(loc: LocationLookup, productId: string): number {
  return loc.stocks.find((s) => s.product.id === productId)?.percent ?? 0;
}

/** Resumo curto dos SKUs do pulmão, ex.: "PUXA-1 (40%) · PUXA-2 (25%)". */
export function pulmaoStocksSummary(loc: LocationLookup, max = 3): string {
  if (loc.stocks.length === 0) return "Pulmão vazio";
  const shown = loc.stocks
    .slice(0, max)
    .map((s) => `${s.product.sku} (${s.percent}%)`)
    .join(" · ");
  const rest = loc.stocks.length - max;
  return rest > 0 ? `${shown} · +${rest} SKU` : shown;
}
