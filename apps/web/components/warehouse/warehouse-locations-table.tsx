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
import { PercentBar } from "@/components/ops/percent-bar";

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
            <TableHead>Estante</TableHead>
            <TableHead>Coluna</TableHead>
            <TableHead>Linha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Cód. barras</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Ocupação</TableHead>
            <TableHead className="text-right">Mín.</TableHead>
            <TableHead className="text-center">Ativo</TableHead>
            <TableHead className="text-center">Ação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            return (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-sm">{row.barracao}</TableCell>
                <TableCell className="font-mono text-sm">
                  {cellCode(row.estante !== EMPTY ? row.estante : row.corredor)}
                </TableCell>
                <TableCell className="font-mono text-sm">{cellCode(row.coluna)}</TableCell>
                <TableCell className="font-mono text-sm">
                  {cellCode(row.linha)}
                  <span
                    className={`ml-1 rounded px-1 text-[10px] font-semibold ${
                      row.face === "B" ? "bg-violet-100 text-violet-800" : "bg-cyan-100 text-cyan-800"
                    }`}
                  >
                    {row.face === "B" ? "LE" : "LD"}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{tipoBadgeForRow(row)}</TableCell>
                <TableCell className="font-mono text-sm">
                  {row.barcode ?? <span className="text-slate-400">{EMPTY}</span>}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {row.sku !== EMPTY ? (
                    row.sku
                  ) : (
                    <button
                      type="button"
                      onClick={() => onEdit(row)}
                      className="font-sans text-xs font-medium text-[#0d9488] underline"
                    >
                      Associar SKU
                    </button>
                  )}
                </TableCell>
                <TableCell>
                  {row.fillPercent != null ? (
                    <PercentBar
                      percent={row.fillPercent}
                      minPercent={row.location?.type === "PULMAO" ? null : row.minPercent}
                    />
                  ) : (
                    <span className="text-slate-400">{EMPTY}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.location?.type === "PULMAO" || row.minPercent == null
                    ? EMPTY
                    : `${row.minPercent}%`}
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
