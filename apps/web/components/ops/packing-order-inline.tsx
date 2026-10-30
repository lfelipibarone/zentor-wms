"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
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

const ITEM_GRID_COLS =
  "minmax(110px,0.9fr) minmax(140px,1.4fr) minmax(88px,0.7fr) 88px 188px";

type Props = {
  orderId: string;
  onClose: () => void;
  onFinished: () => void;
  onMessage: (msg: string | null) => void;
};

export function PackingOrderInline({
  orderId,
  onClose,
  onFinished,
  onMessage,
}: Props) {
  const [order, setOrder] = useState<PackingOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanCode, setScanCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [qtyByItem, setQtyByItem] = useState<Record<string, string>>({});
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueItemId, setIssueItemId] = useState<string | undefined>();
  const packedProgressRef = useRef(false);
  const reportedRef = useRef(false);
  const labelPanelRef = useRef<ShippingLabelPanelHandle>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    packedProgressRef.current = false;
    reportedRef.current = false;
    startedRef.current = false;
    setLoading(true);
    setOrder(null);
    (async () => {
      try {
        await apiFetch(`/api/packing/orders/${orderId}/start`, {
          method: "POST",
          body: "{}",
        });
        if (cancelled) return;
        startedRef.current = true;
        const session = await fetchPackingSession(orderId);
        if (cancelled) return;
        setOrder(session);
        syncQty(session);
        packedProgressRef.current = session.items.some((i) => i.quantityPacked > 0);
      } catch (e) {
        if (!cancelled) {
          onMessage(e instanceof Error ? e.message : "Erro ao abrir pedido");
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (startedRef.current && !packedProgressRef.current && !reportedRef.current) {
        void apiFetch(`/api/packing/orders/${orderId}/cancel`, {
          method: "POST",
          body: "{}",
        }).catch(() => {});
      }
    };
  }, [orderId, onClose, onMessage, syncQty]);

  const handleClose = async () => {
    if (!packedProgressRef.current && !reportedRef.current && startedRef.current) {
      try {
        await apiFetch(`/api/packing/orders/${orderId}/cancel`, {
          method: "POST",
          body: "{}",
        });
      } catch {
        /* ignore */
      }
      startedRef.current = false;
    }
    onClose();
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !scanCode.trim()) return;
    setSaving(true);
    onMessage(null);
    try {
      const updated = await apiFetch<PackingOrder>(
        `/api/packing/orders/${order.id}/scan`,
        {
          method: "POST",
          body: JSON.stringify({ barcode: scanCode.trim(), quantity: 1 }),
        },
      );
      setOrder(updated);
      syncQty(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setScanCode("");
      onMessage("Produto conferido");
      scanRef.current?.focus();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Erro no bip");
    } finally {
      setSaving(false);
    }
  };

  const confirmLine = async (itemId: string, quantity: number) => {
    if (!order) return;
    setRowBusy(itemId);
    onMessage(null);
    try {
      const updated = await confirmPackingItem(order.id, itemId, quantity);
      setOrder(updated);
      syncQty(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      onMessage(`${quantity} un. conferida(s)`);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Erro ao confirmar");
    } finally {
      setRowBusy(null);
    }
  };

  const handleConfirm = (item: PackingOrder["items"][number]) => {
    const remaining = item.remaining;
    const parsed = parseInt(qtyByItem[item.id] ?? String(remaining), 10);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > remaining) {
      onMessage(`Informe uma quantidade entre 1 e ${remaining}`);
      return;
    }
    if (parsed < remaining) {
      setIssueItemId(item.id);
      setIssueOpen(true);
      onMessage(`Qtd ${parsed} < ${remaining}: reporte a divergência.`);
      return;
    }
    void confirmLine(item.id, parsed);
  };

  const handleComplete = async () => {
    if (!order) return;
    setSaving(true);
    onMessage(null);
    try {
      await labelPanelRef.current?.ensureAndPrint();
      await apiFetch(`/api/packing/orders/${order.id}/complete`, {
        method: "POST",
        body: "{}",
      });
      packedProgressRef.current = true;
      onFinished();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Erro ao finalizar");
    } finally {
      setSaving(false);
    }
  };

  const pickedItems = order?.items.filter((i) => i.quantityPicked > 0) ?? [];

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
      </div>
    );
  }

  if (!order) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#0d9488]/40 bg-white shadow-sm ring-1 ring-[#0d9488]/20">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
              Conferindo pedido
            </span>
            <MarketplaceBadge value={order.marketplace} />
            <CollectionDeadlineIndicator
              deadline={order.collectionDeadline}
              className="text-xs"
            />
          </div>
          <h2 className="font-mono text-lg font-bold text-slate-900">
            {order.erpOrderId}
          </h2>
          <p className="text-sm text-slate-500">
            Cesta {order.basket?.code ?? "—"}
            {order.assignedPicker?.name ? ` · ${order.assignedPicker.name}` : ""}
            {" · "}itens em qualquer ordem
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Fechar conferência"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,280px)]">
        <div className="min-w-0 space-y-3">
          <form
            onSubmit={handleScan}
            className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5"
          >
            <div className="min-w-[160px] flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Bipar produto (opcional)
              </label>
              <input
                ref={scanRef}
                autoFocus
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-[#0d9488] focus:ring-1 focus:ring-[#0d9488]"
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

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <div className="min-w-[720px]">
              <div
                className="grid items-center gap-x-3 border-b border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
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
                  !Number.isNaN(parsed) && parsed > 0 && parsed <= item.remaining;
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
                    <span className="truncate font-mono text-sm font-semibold">
                      {item.product.sku}
                    </span>
                    <span className="truncate text-sm text-slate-700" title={item.product.name}>
                      {item.product.name}
                    </span>
                    <span className="truncate text-sm text-slate-500">{loc}</span>
                    {done ? (
                      <span className="text-xs font-semibold text-emerald-700">
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
                          className="h-8 w-12 rounded-md border border-slate-300 bg-white px-1 text-center text-sm font-semibold tabular-nums outline-none focus:border-[#0d9488] focus:ring-1 focus:ring-[#0d9488]"
                        />
                        <span className="text-xs text-slate-400">/{item.remaining}</span>
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
                            className="inline-flex h-8 w-[88px] items-center justify-center gap-1 rounded-md bg-[#0d9488] text-xs font-semibold text-white disabled:opacity-40"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            Conferir
                          </button>
                          <button
                            type="button"
                            disabled={busy || saving}
                            onClick={() => {
                              setIssueItemId(item.id);
                              setIssueOpen(true);
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
        </div>

        <div className="space-y-3">
          {order.allPacked ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleComplete()}
              className="w-full rounded-xl bg-[#0d9488] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Finalizando…" : "Finalizar packing"}
            </button>
          ) : null}
          <ShippingLabelPanel
            ref={labelPanelRef}
            orderId={order.id}
            erpOrderId={order.erpOrderId}
            initialUrl={order.shippingLabel}
            disabled={saving}
            onLabelCached={(url) =>
              setOrder((prev) => (prev ? { ...prev, shippingLabel: url } : prev))
            }
          />
        </div>
      </div>

      {issueOpen ? (
        <PackingIssueModal
          order={order}
          initialItemId={issueItemId}
          onClose={() => setIssueOpen(false)}
          onSubmitted={() => {
            reportedRef.current = true;
            setIssueOpen(false);
            onFinished();
          }}
        />
      ) : null}
    </section>
  );
}
