"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LOCATION_TYPE_LABEL } from "@/lib/labels";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import { fetchStockLocations } from "@/lib/api/operations";
import { cn } from "@/lib/utils";

type TypeFilter = "" | "PULMAO" | "PICK_FACE";

export default function EstoquePage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [lowOnly, setLowOnly] = useState(false);
  const [q, setQ] = useState("");
  const [locations, setLocations] = useState<
    Awaited<ReturnType<typeof fetchStockLocations>>["locations"]
  >([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, lowOnly, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStockLocations(
        q || undefined,
        lowOnly,
        page,
        undefined,
        typeFilter || undefined,
      );
      setLocations(data.locations);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, lowOnly, page, q]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Gôndolas de pulmão e estoque de giro — saldos e capacidade."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            { key: "" as const, label: "Todos" },
            { key: "PULMAO" as const, label: "Pulmão" },
            { key: "PICK_FACE" as const, label: "Estoque de giro" },
          ] as const
        ).map((t) => (
          <button
            key={t.key || "all"}
            type="button"
            onClick={() => setTypeFilter(t.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              typeFilter === t.key
                ? "bg-[#0d9488] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            {t.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
          />
          Somente abaixo do mínimo
        </label>
      </div>

      <div className="mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por SKU ou código de barras…"
          className="min-w-[240px] max-w-md rounded-lg border bg-white px-3 py-2 text-sm"
        />
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={!loading && locations.length === 0}
        emptyMessage="Nenhuma localização cadastrada."
      >
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead className="text-right">Capacidade</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead>Alerta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((l) => {
                const available = l.capacity - l.currentQuantity;
                const alert = l.currentQuantity <= l.minThreshold;
                return (
                  <TableRow key={l.id} className={alert ? "bg-amber-50" : ""}>
                    <TableCell>
                      {l.product ? (
                        <>
                          <span className="font-mono text-sm font-medium">
                            {l.product.sku}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {l.product.name}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {LOCATION_TYPE_LABEL[l.type] ?? l.type}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {l.corridor}-{l.row}
                      <span className="block text-xs text-muted-foreground">
                        {l.barcode}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.currentQuantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {available}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.capacity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.minThreshold}
                    </TableCell>
                    <TableCell>{alert ? "Repor" : "OK"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {pagination && pagination.total > 0 ? (
            <Pagination pagination={pagination} onPageChange={setPage} />
          ) : null}
        </div>
      </DataState>
    </div>
  );
}
