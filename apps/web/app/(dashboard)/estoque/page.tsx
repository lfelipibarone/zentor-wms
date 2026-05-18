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
import { LOCATION_TYPE_LABEL, MOVEMENT_TYPE_LABEL } from "@/lib/labels";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import { fetchMovements, fetchStockLocations } from "@/lib/api/operations";

type Tab = "balances" | "movements";

export default function EstoquePage() {
  const [tab, setTab] = useState<Tab>("balances");
  const [lowOnly, setLowOnly] = useState(false);
  const [locations, setLocations] = useState<
    Awaited<ReturnType<typeof fetchStockLocations>>["locations"]
  >([]);
  const [movements, setMovements] = useState<
    Awaited<ReturnType<typeof fetchMovements>>["movements"]
  >([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [tab, lowOnly]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "balances") {
        const data = await fetchStockLocations(undefined, lowOnly, page);
        setLocations(data.locations);
        setPagination(data.pagination);
      } else {
        const data = await fetchMovements(page);
        setMovements(data.movements);
        setPagination(data.pagination);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [tab, lowOnly, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Saldos por localização e histórico de movimentações."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("balances")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "balances" ? "bg-[#0d9488] text-white" : "border bg-white"}`}
        >
          Saldos
        </button>
        <button
          type="button"
          onClick={() => setTab("movements")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "movements" ? "bg-[#0d9488] text-white" : "border bg-white"}`}
        >
          Movimentações
        </button>
        {tab === "balances" ? (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
            />
            Somente abaixo do mínimo
          </label>
        ) : null}
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={
          !loading &&
          (tab === "balances" ? locations.length === 0 : movements.length === 0)
        }
      >
        {tab === "balances" ? (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Local</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Mínimo</TableHead>
                  <TableHead>Alerta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((l) => {
                  const alert = l.currentQuantity <= l.minThreshold;
                  return (
                    <TableRow key={l.id} className={alert ? "bg-amber-50" : ""}>
                      <TableCell className="font-mono">{l.barcode}</TableCell>
                      <TableCell>
                        {l.product?.sku ?? "—"}
                        {l.product?.name ? (
                          <span className="block text-xs text-muted-foreground">
                            {l.product.name}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {LOCATION_TYPE_LABEL[l.type] ?? l.type}
                      </TableCell>
                      <TableCell>
                        {l.currentQuantity} / {l.capacity}
                      </TableCell>
                      <TableCell>{l.minThreshold}</TableCell>
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
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Operador</TableHead>
                  <TableHead>Pedido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      {MOVEMENT_TYPE_LABEL[m.type] ?? m.type}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono">{m.product.sku}</span>
                    </TableCell>
                    <TableCell>{m.quantity}</TableCell>
                    <TableCell>{m.fromLocation?.barcode ?? "—"}</TableCell>
                    <TableCell>{m.toLocation?.barcode ?? "—"}</TableCell>
                    <TableCell>{m.user.name}</TableCell>
                    <TableCell>{m.order?.erpOrderId ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pagination && pagination.total > 0 ? (
              <Pagination pagination={pagination} onPageChange={setPage} />
            ) : null}
          </div>
        )}
      </DataState>
    </div>
  );
}
