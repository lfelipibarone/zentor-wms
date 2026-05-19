"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { OrderStatusBadge } from "@/components/ops/order-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  fetchOrderDetail,
  type BoardEntry,
  type BoardOrderEntry,
} from "@/lib/api/operations";
import { fetchWaveDetail } from "@/lib/api/waves";

const ACTIVE_STATUSES = new Set([
  "PENDING",
  "PICKING",
  "PAUSED_ISSUE",
  "PICKED_AWAITING_CONFERENCE",
]);

export function WorkboardEntryCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: BoardEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isOrder = entry.kind === "order";
  const isActive = isOrder && ACTIVE_STATUSES.has(entry.status);

  return (
    <div
      className={cn(
        "rounded-xl border bg-white shadow-sm",
        isActive && "border-teal-200 bg-teal-50/30",
      )}
    >
      <div className="flex items-start gap-2 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          {isOrder ? (
            <OrderCardHeader order={entry} />
          ) : (
            <WaveCardHeader wave={entry} />
          )}
        </div>
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {expanded ? (
            isOrder ? (
              <OrderCardDetail orderId={entry.id} />
            ) : (
              <WaveCardDetail waveId={entry.id} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: "order" | "wave" }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        kind === "order"
          ? "bg-slate-100 text-slate-700"
          : "bg-violet-100 text-violet-800",
      )}
    >
      {kind === "order" ? "ERP" : "Onda"}
    </span>
  );
}

function OrderCardHeader({ order }: { order: BoardOrderEntry }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind="order" />
          <p className="font-mono text-lg font-bold">{order.erpOrderId}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {order.customerName ?? "—"} · Cesta {order.basketCode ?? "—"} ·{" "}
          {order.pickerName ?? "Sem separador"}
        </p>
        <p className="text-xs text-muted-foreground">
          {order.marketplace ?? "—"} · Prioridade {order.priority}
          {order.collectionDeadline
            ? ` · Coleta ${new Date(order.collectionDeadline).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}`
            : ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <OrderStatusBadge status={order.status} />
        <span className="text-sm text-muted-foreground">
          {order.qtyPicked}/{order.qtyOrdered} un.
        </span>
      </div>
    </div>
  );
}

function WaveCardHeader({
  wave,
}: {
  wave: Extract<BoardEntry, { kind: "wave" }>;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind="wave" />
          <p className="text-lg font-bold">{wave.name}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {wave.orderCount} pedido(s) · {wave.lineCount} linha(s) na gôndola
        </p>
        {wave.releasedAt ? (
          <p className="text-xs text-muted-foreground">
            Liberada{" "}
            {new Date(wave.releasedAt).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-800">
          {wave.status}
        </span>
        <span className="text-sm text-muted-foreground">
          {wave.qtyPicked}/{wave.qtyTotal} un.
        </span>
      </div>
    </div>
  );
}

function OrderCardDetail({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<
    Array<{
      lineNumber: number;
      quantityOrdered: number;
      quantityPicked: number;
      product: { sku: string; name: string };
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOrderDetail(orderId)
      .then((d) => {
        if (!cancelled) setItems(d.items);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar itens");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading) {
    return (
      <p className="border-t px-4 py-3 text-sm text-muted-foreground">
        Carregando itens…
      </p>
    );
  }
  if (error) {
    return <p className="border-t px-4 py-3 text-sm text-red-600">{error}</p>;
  }

  return (
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
        {items.map((item) => (
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
  );
}

function WaveCardDetail({ waveId }: { waveId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<
    Array<{
      id: string;
      sku: string;
      productName: string;
      locationBarcode: string;
      quantityPicked: number;
      quantityTotal: number;
      sortStatus: string;
    }>
  >([]);
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      erpOrderId: string;
      customerName: string | null;
      status: string;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWaveDetail(waveId)
      .then((d) => {
        if (!cancelled) {
          setLines(d.lines);
          setOrders(d.orders);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar onda");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [waveId]);

  if (loading) {
    return (
      <p className="border-t px-4 py-3 text-sm text-muted-foreground">
        Carregando onda…
      </p>
    );
  }
  if (error) {
    return <p className="border-t px-4 py-3 text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-4 border-t p-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Linhas na gôndola</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Separado</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-mono">{line.sku}</TableCell>
                <TableCell>{line.productName}</TableCell>
                <TableCell className="font-mono">{line.locationBarcode}</TableCell>
                <TableCell>
                  {line.quantityPicked}/{line.quantityTotal}
                </TableCell>
                <TableCell>{line.sortStatus}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {orders.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Pedidos na onda</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido ERP</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono">{o.erpOrderId}</TableCell>
                  <TableCell>{o.customerName ?? "—"}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={o.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
