"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { OrderStatusBadge } from "@/components/ops/order-status-badge";
import { OrderStatus } from "@wms/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api/client";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { fetchShippingQueue } from "@/lib/api/operations";

type ShippingOrder = Awaited<
  ReturnType<typeof fetchShippingQueue>
>["orders"][number];

function ShippingOrderCard({
  order,
  expanded,
  onToggle,
  onAdvance,
}: {
  order: ShippingOrder;
  expanded: boolean;
  onToggle: () => void;
  onAdvance: () => void;
}) {
  const actionLabel =
    order.status === OrderStatus.PICKED_AWAITING_CONFERENCE
      ? "Conferir → Expedir"
      : "Marcar expedido";

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="flex items-start gap-2 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          aria-expanded={expanded}
          aria-label={expanded ? "Recolher itens" : "Expandir itens"}
        >
          {expanded ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-lg font-bold">{order.erpOrderId}</p>
              <p className="text-sm text-muted-foreground">
                {order.customerName ?? "—"} · Cesta {order.basket?.code ?? "—"} ·{" "}
                {order.assignedPicker?.name ?? "Sem separador"}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <OrderStatusBadge status={order.status} />
              <button
                type="button"
                onClick={onAdvance}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b7d73]"
              >
                {actionLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <Table className="border-t">
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Separado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.lineNumber}>
                  <TableCell>{item.lineNumber}</TableCell>
                  <TableCell className="font-mono">{item.product.sku}</TableCell>
                  <TableCell>{item.product.name}</TableCell>
                  <TableCell>
                    {item.quantityPicked}/{item.quantityOrdered}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export default function ExpedicaoPage() {
  const [orders, setOrders] = useState<ShippingOrder[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchShippingQueue(page);
      setOrders(data.orders);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const advance = async (id: string) => {
    await apiFetch(`/api/shipping/${id}/advance`, { method: "POST", body: "{}" });
    await load();
  };

  return (
    <div>
      <PageHeader
        title="Expedição"
        description="Fila de conferência e despacho de pedidos separados."
      />

      <DataState loading={loading} error={error} empty={!loading && orders.length === 0}>
        <div className="space-y-4">
          {orders.map((o) => (
            <ShippingOrderCard
              key={o.id}
              order={o}
              expanded={expandedIds.has(o.id)}
              onToggle={() => toggleExpanded(o.id)}
              onAdvance={() => advance(o.id)}
            />
          ))}
          {pagination && pagination.total > 0 ? (
            <Pagination pagination={pagination} onPageChange={setPage} />
          ) : null}
        </div>
      </DataState>
    </div>
  );
}
