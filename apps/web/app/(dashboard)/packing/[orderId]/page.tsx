"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { DataState } from "@/components/ops/data-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api/client";
import {
  confirmPackingItem,
  fetchPackingSession,
  type PackingOrder,
} from "@/lib/api/operations";

export default function PackingOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;

  const [order, setOrder] = useState<PackingOrder | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const packedProgressRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/packing/orders/${orderId}/start`, {
        method: "POST",
        body: "{}",
      });
      const session = await fetchPackingSession(orderId);
      setOrder(session);
      packedProgressRef.current = session.items.some((i) => i.quantityPacked > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar pedido");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (!packedProgressRef.current) {
        void apiFetch(`/api/packing/orders/${orderId}/cancel`, {
          method: "POST",
          body: "{}",
        }).catch(() => {});
      }
    };
  }, [orderId]);

  const handleBack = async () => {
    if (!packedProgressRef.current) {
      try {
        await apiFetch(`/api/packing/orders/${orderId}/cancel`, {
          method: "POST",
          body: "{}",
        });
      } catch {
        /* ignore */
      }
    }
    router.push("/packing");
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !scanCode.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiFetch<PackingOrder>(
        `/api/packing/orders/${order.id}/scan`,
        {
          method: "POST",
          body: JSON.stringify({
            barcode: scanCode.trim(),
            quantity: Number(scanQty) || 1,
          }),
        },
      );
      setOrder(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setScanCode("");
      setScanQty("1");
      setMessage("Produto conferido");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro no bip — use o código de barras do produto");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmLine = async (itemId: string, max: number) => {
    if (!order) return;
    const qty = Math.min(
      max,
      Math.max(1, Math.floor(Number(lineQty[itemId] ?? max))),
    );
    setSaving(true);
    setMessage(null);
    try {
      const updated = await confirmPackingItem(order.id, itemId, qty);
      setOrder(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setLineQty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setMessage(`${qty} un. conferida(s)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao confirmar");
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!order) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/packing/orders/${order.id}/complete`, {
        method: "POST",
        body: "{}",
      });
      router.push("/packing");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao finalizar");
    } finally {
      setSaving(false);
    }
  };

  const pickedItems = order?.items.filter((i) => i.quantityPicked > 0) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={order?.erpOrderId ?? "Packing"}
          description="Conferência por código de barras do produto."
        />
        <button
          type="button"
          onClick={() => void handleBack()}
          className="rounded-lg border px-3 py-2 text-sm font-medium"
        >
          Voltar
        </button>
      </div>

      <DataState loading={loading} error={error} empty={false}>
        {order ? (
          <>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-2xl font-bold">{order.erpOrderId}</p>
                  <p className="text-sm text-muted-foreground">
                    Cesta {order.basket?.code ?? "—"}
                    {order.assignedPicker?.name
                      ? ` · Separador ${order.assignedPicker.name}`
                      : ""}
                    {order.routeLabel ? ` · ${order.routeLabel}` : ""}
                  </p>
                  {order.customerName ? (
                    <p className="text-sm">{order.customerName}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {order.packingInProgress ? (
                    <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-900">
                      Em conferência
                      {order.packingOperatorName
                        ? ` · ${order.packingOperatorName}`
                        : ""}
                    </span>
                  ) : null}
                  <CollectionDeadlineIndicator
                    deadline={order.collectionDeadline}
                    variant="detail"
                  />
                </div>
                {order.allPacked ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleComplete}
                    className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Finalizar packing
                  </button>
                ) : null}
              </div>
            </div>

            {message ? (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
            ) : null}

            <form
              onSubmit={handleScan}
              className="flex flex-wrap gap-2 rounded-xl border bg-white p-4 shadow-sm"
            >
              <input
                autoFocus
                className="min-w-[200px] flex-1 rounded-lg border px-3 py-2 text-sm font-mono"
                placeholder="Bipar código de barras do produto"
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
              />
              <input
                type="number"
                min={1}
                className="w-20 rounded-lg border px-2 py-2 text-sm"
                value={scanQty}
                onChange={(e) => setScanQty(e.target.value)}
                title="Quantidade"
              />
              <button
                type="submit"
                disabled={saving || !scanCode.trim()}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Bipar produto
              </button>
            </form>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pickedItems.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border bg-white p-3 shadow-sm ${
                    item.remaining === 0 ? "border-emerald-300 bg-emerald-50" : ""
                  }`}
                >
                  <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-lg bg-slate-100">
                    {item.product.imageUrl ? (
                      <Image
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        fill
                        className="object-contain"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        {item.product.sku}
                      </div>
                    )}
                  </div>
                  <p className="font-mono text-sm font-bold">{item.product.sku}</p>
                  <p className="text-sm">{item.product.name}</p>
                  {item.multiGondolaHint ? (
                    <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                      {item.multiGondolaHint}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm">
                    Conferido {item.quantityPacked}/{item.quantityPicked}
                  </p>
                  {item.remaining > 0 ? (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        min={1}
                        max={item.remaining}
                        className="w-16 rounded border px-2 py-1 text-sm"
                        value={lineQty[item.id] ?? String(item.remaining)}
                        onChange={(e) =>
                          setLineQty((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleConfirmLine(item.id, item.remaining)}
                        className="rounded-lg bg-[#0d9488] px-2 py-1 text-xs font-semibold text-white"
                      >
                        OK
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Conferido</TableHead>
                    <TableHead>Qtd</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pickedItems.map((item) => (
                    <TableRow
                      key={item.id}
                      className={
                        item.remaining === 0 ? "bg-emerald-50" : undefined
                      }
                    >
                      <TableCell className="font-mono">{item.product.sku}</TableCell>
                      <TableCell>{item.product.name}</TableCell>
                      <TableCell>
                        {item.quantityPacked}/{item.quantityPicked}
                      </TableCell>
                      <TableCell>
                        {item.remaining > 0 ? (
                          <input
                            type="number"
                            min={1}
                            max={item.remaining}
                            className="w-16 rounded border px-2 py-1 text-sm"
                            value={lineQty[item.id] ?? String(item.remaining)}
                            onChange={(e) =>
                              setLineQty((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {item.remaining > 0 ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              handleConfirmLine(item.id, item.remaining)
                            }
                            className="rounded-lg bg-[#0d9488] px-2 py-1 text-xs font-semibold text-white"
                          >
                            Confirmar
                          </button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
