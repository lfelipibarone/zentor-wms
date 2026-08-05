"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { DataState } from "@/components/ops/data-state";
import { PackingIssueModal } from "@/components/ops/packing-issue-modal";
import { ProductImageZoom } from "@/components/ops/product-image-zoom";
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
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelMessage, setLabelMessage] = useState<string | null>(null);
  const [labelUrls, setLabelUrls] = useState<string[]>([]);
  const packedProgressRef = useRef(false);
  const reportedRef = useRef(false);

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
      setLabelUrls(session.shippingLabel ? [session.shippingLabel] : []);
      setLabelMessage(null);
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
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setScanCode("");
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

  const handleFetchShippingLabel = async (refresh = false) => {
    if (!order) return;
    setLabelLoading(true);
    setLabelMessage(null);
    try {
      const result = await apiFetch<{
        status: string;
        urls: string[];
        message?: string;
        cached?: boolean;
      }>(
        `/api/packing/orders/${order.id}/shipping-labels${refresh ? "?refresh=1" : ""}`,
        { method: "POST", body: "{}" },
      );
      if (result.status === "OK" && result.urls.length > 0) {
        setLabelUrls(result.urls);
        setOrder((prev) =>
          prev ? { ...prev, shippingLabel: result.urls[0] ?? null } : prev,
        );
        setLabelMessage(
          result.cached ? "Etiqueta em cache" : "Etiqueta obtida do Tiny",
        );
      } else {
        setLabelUrls([]);
        setLabelMessage(result.message ?? "Etiqueta indisponível");
      }
    } catch (e) {
      setLabelMessage(e instanceof Error ? e.message : "Erro ao buscar etiqueta");
    } finally {
      setLabelLoading(false);
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
        <div className="flex gap-2">
          {order ? (
            <button
              type="button"
              onClick={() => setIssueModalOpen(true)}
              disabled={saving}
              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Relatar problema
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleBack()}
            className="rounded-lg border px-3 py-2 text-sm font-medium"
          >
            Voltar
          </button>
        </div>
      </div>

      {order && issueModalOpen ? (
        <PackingIssueModal
          order={order}
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
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
            ) : null}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex min-w-0 flex-1 flex-wrap gap-3">
                {pickedItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex w-full gap-3 rounded-lg border bg-white p-3 shadow-sm sm:w-[min(100%,280px)] ${
                      item.remaining === 0
                        ? "border-emerald-300 bg-emerald-50"
                        : ""
                    }`}
                  >
                    <ProductImageZoom
                      src={item.product.imageUrl}
                      alt={item.product.name}
                      placeholder={item.product.sku}
                      className="relative aspect-square w-40 shrink-0 overflow-visible"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p
                        className="truncate font-mono text-sm font-bold"
                        title={item.product.sku}
                      >
                        {item.product.sku}
                      </p>
                      <p
                        className="line-clamp-2 text-sm leading-tight"
                        title={item.product.name}
                      >
                        {item.product.name}
                      </p>
                      {item.multiGondolaHint ? (
                        <p
                          className="mt-1 truncate rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                          title={item.multiGondolaHint}
                        >
                          {item.multiGondolaHint}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm font-semibold">
                        Conferido {item.quantityPacked}/{item.quantityPicked}
                      </p>
                      {item.remaining > 0 ? (
                        <div className="mt-auto pt-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              handleConfirmLine(item.id, item.remaining)
                            }
                            className="rounded-lg bg-[#0d9488] px-3 py-1 text-sm font-semibold text-white"
                          >
                            OK
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex w-full flex-col gap-3 lg:sticky lg:top-4 lg:w-80 lg:shrink-0">
                <div className="rounded-xl border bg-white p-4 shadow-sm">
                  <p className="font-mono text-2xl font-bold">
                    {order.erpOrderId}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cesta {order.basket?.code ?? "—"}
                  </p>
                  {order.assignedPicker?.name ? (
                    <p className="text-sm text-muted-foreground">
                      Separador {order.assignedPicker.name}
                    </p>
                  ) : null}
                  {order.routeLabel ? (
                    <p className="text-sm text-muted-foreground">
                      {order.routeLabel}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {order.customerName ? (
                      <p className="text-sm">{order.customerName}</p>
                    ) : null}
                    <MarketplaceBadge value={order.marketplace} />
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {order.packingInProgress ? (
                      <span className="self-start rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-900">
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
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleComplete}
                        className="mt-1 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
                      >
                        Finalizar packing
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold">Etiqueta de envio</p>
                  {labelUrls.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-2">
                      {labelUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
                        >
                          Abrir etiqueta
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Nenhuma etiqueta capturada ainda.
                    </p>
                  )}
                  {labelMessage ? (
                    <p
                      className={`mt-2 text-xs ${
                        labelUrls.length > 0 ? "text-emerald-800" : "text-amber-800"
                      }`}
                    >
                      {labelMessage}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={labelLoading || saving}
                      onClick={() => void handleFetchShippingLabel(false)}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {labelLoading ? "Buscando…" : "Buscar etiqueta"}
                    </button>
                    {labelUrls.length > 0 ? (
                      <button
                        type="button"
                        disabled={labelLoading || saving}
                        onClick={() => void handleFetchShippingLabel(true)}
                        className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      >
                        Atualizar
                      </button>
                    ) : null}
                  </div>
                </div>

                <form
                  onSubmit={handleScan}
                  className="flex flex-col gap-2 rounded-xl border bg-white p-3 shadow-sm"
                >
                  <input
                    autoFocus
                    className="rounded-lg border px-2 py-1.5 text-sm font-mono"
                    placeholder="Bipar código de barras"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={saving || !scanCode.trim()}
                    className="w-full rounded-lg bg-[#0d9488] px-2 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Bipar
                  </button>
                </form>
              </div>
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
