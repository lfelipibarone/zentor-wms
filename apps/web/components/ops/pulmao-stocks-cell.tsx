import type { PulmaoStockRow } from "@/lib/api/operations";

/** SKUs guardados no pulmão com a % que cada um ocupa. */
export function PulmaoStocksCell({ stocks }: { stocks: PulmaoStockRow[] | undefined }) {
  if (!stocks || stocks.length === 0) {
    return <span className="text-sm text-muted-foreground">Vazio</span>;
  }
  return (
    <ul className="space-y-0.5">
      {stocks.map((s) => (
        <li key={s.product.id} className="flex items-baseline gap-2 text-sm">
          <span className="whitespace-nowrap font-mono font-medium">{s.product.sku}</span>
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {s.percent}%
          </span>
        </li>
      ))}
    </ul>
  );
}
