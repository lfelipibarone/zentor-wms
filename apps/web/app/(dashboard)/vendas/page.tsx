"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { OrderStatusBadge } from "@/components/ops/order-status-badge";
import { Pagination } from "@/components/ui/pagination";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import type { PaginationMeta } from "@/lib/pagination";
import { OrderStatus } from "@wms/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchOrders, type OrderRow } from "@/lib/api/operations";

const STATUS_OPTIONS = ["", ...Object.values(OrderStatus)];

export default function VendasPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOrders({
        status: status || undefined,
        q: q || undefined,
        page,
      });
      setOrders(data.orders);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [status, q, page]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Vendas"
        description="Pedidos integrados do ERP e status no fluxo do armazém."
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s as keyof typeof ORDER_STATUS_LABEL]}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pedido ERP ou cliente…"
          className="min-w-[200px] flex-1 rounded-lg border bg-white px-3 py-2 text-sm"
        />
      </div>

      <DataState loading={loading} error={error} empty={!loading && orders.length === 0}>
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido ERP</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Separador</TableHead>
                <TableHead>Cesta</TableHead>
                <TableHead>Qtd</TableHead>
                <TableHead>Coleta até</TableHead>
                <TableHead>Marketplace</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono font-medium">{o.erpOrderId}</TableCell>
                  <TableCell>{o.customerName ?? "—"}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={o.status} />
                  </TableCell>
                  <TableCell>{o.pickerName ?? "—"}</TableCell>
                  <TableCell>{o.basketCode ?? "—"}</TableCell>
                  <TableCell>
                    {o.qtyPicked}/{o.qtyOrdered}
                  </TableCell>
                  <TableCell className="text-sm">
                    {o.collectionDeadline
                      ? new Date(o.collectionDeadline).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>{o.marketplace ?? "—"}</TableCell>
                  <TableCell>{o.priority}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(o.updatedAt).toLocaleString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
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
