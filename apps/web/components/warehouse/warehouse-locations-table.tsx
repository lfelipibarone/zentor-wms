"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMPTY, type LayoutRow } from "@/lib/warehouse-layout-rows";

function tipoBadge(label: string, variant: "pulmao" | "pick") {
  const styles =
    variant === "pulmao"
      ? "bg-violet-100 text-violet-800"
      : "bg-teal-100 text-teal-800";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

function tipoBadgeForRow(row: LayoutRow) {
  if (row.locationType === "PULMAO") {
    return tipoBadge("Pulmão", "pulmao");
  }
  return tipoBadge("Estoque de giro", "pick");
}

function cellCode(value: string) {
  return value === EMPTY ? (
    <span className="text-slate-400">{EMPTY}</span>
  ) : (
    value
  );
}

function StockCell({
  currentQuantity,
  capacity,
  fillPct,
  lowStock,
}: {
  currentQuantity: number | null;
  capacity: number | null;
  fillPct: number | null;
  lowStock: boolean;
}) {
  if (capacity == null || currentQuantity == null) {
    return <span className="text-slate-400">{EMPTY}</span>;
  }

  return (
    <div className="flex min-w-[7rem] flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
        <div className="flex items-baseline gap-0.5">
          <span
            className={`text-sm ${
              lowStock ? "font-semibold text-amber-700" : "font-medium text-slate-900"
            }`}
          >
            {currentQuantity}
          </span>
          <span className="text-xs text-slate-400">/</span>
          <span className="text-xs text-slate-500">{capacity}</span>
        </div>
        {fillPct != null ? (
          <span
            className={`text-xs font-medium tabular-nums ${
              lowStock ? "text-amber-700" : "text-slate-500"
            }`}
          >
            {fillPct}%
          </span>
        ) : null}
      </div>
      {fillPct != null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full ${lowStock ? "bg-amber-500" : "bg-teal-600"}`}
            style={{ width: `${Math.min(100, fillPct)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function WarehouseLocationsTable({
  rows,
  onEdit,
}: {
  rows: LayoutRow[];
  onEdit: (row: LayoutRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
        Nenhuma localização encontrada.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Barracão</TableHead>
            <TableHead>Setor</TableHead>
            <TableHead>Corredor</TableHead>
            <TableHead>Estante</TableHead>
            <TableHead>Coluna</TableHead>
            <TableHead>Linha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Cód. barras</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Estoque</TableHead>
            <TableHead className="text-right">Mín.</TableHead>
            <TableHead className="text-center">Ativo</TableHead>
            <TableHead className="text-center">Ação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const lowStock =
              row.capacity != null &&
              row.minThreshold != null &&
              row.currentQuantity != null &&
              row.currentQuantity <= row.minThreshold;

            return (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-sm">{row.barracao}</TableCell>
                <TableCell className="font-mono text-sm">{cellCode(row.setor)}</TableCell>
                <TableCell className="font-mono text-sm">{cellCode(row.corredor)}</TableCell>
                <TableCell className="font-mono text-sm">{cellCode(row.estante)}</TableCell>
                <TableCell className="font-mono text-sm">{cellCode(row.coluna)}</TableCell>
                <TableCell className="font-mono text-sm">{cellCode(row.linha)}</TableCell>
                <TableCell className="text-sm">{tipoBadgeForRow(row)}</TableCell>
                <TableCell className="font-mono text-sm">
                  {row.barcode ?? <span className="text-slate-400">{EMPTY}</span>}
                </TableCell>
                <TableCell className="font-mono text-sm">{row.sku}</TableCell>
                <TableCell>
                  <StockCell
                    currentQuantity={row.currentQuantity}
                    capacity={row.capacity}
                    fillPct={row.fillPct}
                    lowStock={lowStock}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.minThreshold ?? EMPTY}
                </TableCell>
                <TableCell className="text-center text-sm">
                  {row.active ? "Sim" : "Não"}
                </TableCell>
                <TableCell className="text-center">
                  <button
                    type="button"
                    onClick={() => onEdit(row)}
                    className="text-sm font-semibold text-[#0d9488] underline"
                  >
                    Editar
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
