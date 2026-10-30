"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { DataState } from "@/components/ops/data-state";
import { PackingIssueModal } from "@/components/ops/packing-issue-modal";
import {
  ShippingLabelPanel,
  type ShippingLabelPanelHandle,
} from "@/components/ops/shipping-label-panel";
import { apiFetch } from "@/lib/api/client";
import {
  confirmPackingItem,
  fetchPackingSession,
  type PackingOrder,
} from "@/lib/api/operations";
import { cn } from "@/lib/utils";

/** Mesmo alinhamento da lista de onda: SKU | Nome | Local | Qtd | Ações */
const ITEM_GRID_COLS =
  "minmax(110px,0.9fr) minmax(140px,1.4fr) minmax(88px,0.7fr) 88px 188px";

export default function PackingOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;

  const [order, setOrder] = useState<PackingOrder | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [qtyByItem, setQtyByItem] = useState<Record<string, string>>({});
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueItemId, setIssueItemId] = useState<string | undefined>(undefined);
  const packedProgressRef = useRef(false);
  const reportedRef = useRef(false);
  const labelPanelRef = useRef<ShippingLabelPanelHandle>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const syncQty = useCallback((session: PackingOrder) => {
    setQtyByItem((prev) => {
      const next: Record<string, string> = {};
      for (const item of session.items) {
        if (item.remaining <= 0) continue;
        next[item.id] =
          prev[item.id] !== undefined && prev[item.id] !== ""
            ? prev[item.id]
            : String(item.remaining);
      }
      return next;
    });
  }, []);

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
      syncQty(session);
      packedProgressRef.current = session.items.some((i) => i.quantityPacked > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar pedido");
    } finally {
      setLoading(false);
    }
  }, [orderId, syncQty]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (!packedProgressRef.current && !reportedRef.current) {
        void apiFetch(`/api/packing/orders/${orderId}/cancel`, {
          method: "POST",
          body: "{}",
        }).catch(() => {});
      }
    };
  }, [orderId]);

  const handleBack = async () => {
    if (!packedProgressRef.current && !reportedRef.current) {
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
            quantity: 1,
          }),
        },
      );
      setOrder(updated);
      syncQty(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setScanCode("");
      setMessage("Produto conferido");
      scanRef.current?.focus();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Erro no bip — use o código de barras do produto",
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmLine = async (itemId: string, quantity: number) => {
    if (!order) return;
    setRowBusy(itemId);
    setMessage(null);
    try {
      const updated = await confirmPackingItem(order.id, itemId, quantity);
      setOrder(updated);
      syncQty(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setMessage(`${quantity} un. conferida(s)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao confirmar");
    } finally {
      setRowBusy(null);
    }
  };

  const handleConfirm = (item: PackingOrder["items"][number]) => {
    const remaining = item.remaining;
    const parsed = parseInt(qtyByItem[item.id] ?? String(remaining), 10);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > remaining) {
      setMessage(`Informe uma quantidade entre 1 e ${remaining}`);
      return;
    }
    if (parsed < remaining) {
      setIssueItemId(item.id);
      setIssueModalOpen(true);
      setMessage(
        `Qtd ${parsed} < ${remaining}: use Reportar para registrar a divergência.`,
      );
      return;
    }
    void confirmLine(item.id, parsed);
  };

  const handleComplete = async () => {
    if (!order) return;
    setSaving(true);
    setMessage(null);
    try {
      await labelPanelRef.current?.ensureAndPrint();
      await apiFetch(`/api/packing/orders/${order.id}/complete`, {
        method: "POST",
        body: "{}",
      });
      router.push("/packing");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Erro ao imprimir/finalizar — verifique QZ Tray e tente novamente",
      );
    } finally {
      setSaving(false);
    }
  };

  const pickedItems = order?.items.filter((i) => i.quantityPicked > 0) ?? [];
  const pendingCount = pickedItems.filter((i) => i.remaining > 0).length;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={order?.erpOrderId ?? "Packing"}
          description="Conferência do pedido — lista de itens (qualquer ordem)."
        />
        <div className="flex gap-2">
          {order ? (
            <button
              type="button"
              onClick={() => {
                setIssueItemId(undefined);
                setIssueModalOpen(true);
              }}
              disabled={saving}
              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reportar erro
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleBack()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium"
          >
            Voltar à fila
          </button>
        </div>
      </div>

      {order && issueModalOpen ? (
        <PackingIssueModal
          order={order}
          initialItemId={issueItemId}
          onClose={() => setIssueModalOpen(false)}
          onSubmitted={() => {
            reportedRef.current = true;
            setIssueModalOpen(false);
            router.push("/packing");
          }}
        />
      ) : null}

      <DataState loading={loading} error={error} empty={false}>
        {order ? (
          <>
            {message ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
                {message}
              </p>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] lg:items-start">
              <div className="min-w-0 space-y-4">
                <form
                  onSubmit={handleScan}
                  className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="min-w-[200px] flex-1">
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      Bipar produto (opcional — ou use a lista)
                    </label>
                    <input
                      ref={scanRef}
                      autoFocus
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-[#0d9488] focus:ring-1 focus:ring-[#0d9488]"
                      placeholder="Código de barras"
                      value={scanCode}
                      onChange={(e) => setScanCode(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving || !scanCode.trim()}
                    className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Bipar
                  </button>
                </form>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Pedido
                      </p>
                      <p className="font-mono text-base font-bold text-slate-900">
                        {order.erpOrderId}
                      </p>
                      <p className="text-sm text-slate-500">
                        {pendingCount} item(ns) pendente(s) · conferir em qualquer ordem
                      </p>
                    </div>
                    <CollectionDeadlineIndicator
                      deadline={order.collectionDeadline}
                      className="text-xs"
                    />
                  </header>

                  <div className="overflow-x-auto">
                    <div className="min-w-[780px]">
                      <div
                        className="grid items-center gap-x-3 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                        style={{ gridTemplateColumns: ITEM_GRID_COLS }}
                      >
                        <span>SKU</span>
                        <span>Produto</span>
                        <span>Local</span>
                        <span>Qtd</span>
                        <span>Ações</span>
                      </div>

                      {pickedItems.map((item) => {
                        const done = item.remaining <= 0;
                        const qtyStr = qtyByItem[item.id] ?? String(item.remaining);
                        const parsed = parseInt(qtyStr, 10);
                        const qtyValid =
                          !Number.isNaN(parsed) &&
                          parsed > 0 &&
                          parsed <= item.remaining;
                        const busy = rowBusy === item.id;
                        const loc =
                          item.pickSegments?.[0]?.label ??
                          item.pickSegments?.[0]?.barcode ??
                          "—";

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "grid items-center gap-x-3 border-b border-slate-100 px-3 py-2 last:border-0",
                              done ? "bg-emerald-50/60" : "hover:bg-slate-50/80",
                            )}
                            style={{ gridTemplateColumns: ITEM_GRID_COLS }}
                          >
                            <span
                              className="truncate font-mono text-sm font-semibold text-slate-900"
                              title={item.product.sku}
                            >
                              {item.product.sku}
                            </span>
                            <span
                              className="truncate text-sm text-slate-700"
                              title={item.product.name}
                            >
                              {item.product.name}
                            </span>
                            <span
                              className="truncate text-sm text-slate-500"
                              title={loc}
                            >
                              {loc}
                            </span>
                            {done ? (
                              <span className="text-xs font-semibold tabular-nums text-emerald-700">
                                {item.quantityPacked}/{item.quantityPicked}
                              </span>
                            ) : (
                              <div className="flex h-8 items-center gap-1">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  max={item.remaining}
                                  value={qtyStr}
                                  disabled={busy || saving}
                                  onChange={(e) =>
                                    setQtyByItem((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      handleConfirm(item);
                                    }
                                  }}
                                  aria-label={`Quantidade ${item.product.sku}`}
                                  className="h-8 w-12 rounded-md border border-slate-300 bg-white px-1 text-center text-sm font-semibold tabular-nums outline-none focus:border-[#0d9488] focus:ring-1 focus:ring-[#0d9488]"
                                />
                                <span className="text-xs tabular-nums text-slate-400">
                                  /{item.remaining}
                                </span>
                              </div>
                            )}
                            <div className="flex h-8 items-center gap-1.5">
                              {done ? (
                                <span className="text-xs font-semibold text-emerald-700">
                                  Conferido
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy || saving || !qtyValid}
                                    onClick={() => handleConfirm(item)}
                                    className="inline-flex h-8 w-[88px] items-center justify-center gap-1 rounded-md bg-[#0d9488] text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
                                  >
                                    {busy ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : null}
                                    Conferir
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy || saving}
                                    onClick={() => {
                                      setIssueItemId(item.id);
                                      setIssueModalOpen(true);
                                    }}
                                    className="inline-flex h-8 w-[88px] items-center justify-center rounded-md border border-red-300 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
                                  >
                                    Reportar
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>

              <aside className="space-y-3 lg:sticky lg:top-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="font-mono text-xl font-bold text-slate-900">
                    {order.erpOrderId}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Cesta {order.basket?.code ?? "—"}
                  </p>
                  {order.assignedPicker?.name ? (
                    <p className="text-sm text-slate-500">
                      Separador {order.assignedPicker.name}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {order.customerName ? (
                      <p className="text-sm text-slate-700">{order.customerName}</p>
                    ) : null}
                    <MarketplaceBadge value={order.marketplace} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {order.packingInProgress ? (
                      <span className="inline-block rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-900">
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
                    {order.allPacked ? (
                      <>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleComplete()}
                          className="mt-1 w-full rounded-xl bg-[#0d9488] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {saving
                            ? "Imprimindo e finalizando…"
                            : "Finalizar packing"}
                        </button>
                        <p className="text-[11px] text-slate-500">
                          Ao finalizar, a etiqueta é impressa (QZ Tray).
                        </p>
                      </>
                    ) : null}
                  </div>
                </div>

                <ShippingLabelPanel
                  ref={labelPanelRef}
                  orderId={order.id}
                  erpOrderId={order.erpOrderId}
                  initialUrl={order.shippingLabel}
                  disabled={saving}
                  onLabelCached={(url) =>
                    setOrder((prev) =>
                      prev ? { ...prev, shippingLabel: url } : prev,
                    )
                  }
                />
              </aside>
            </div>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
