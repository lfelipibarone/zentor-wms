"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
import { matchesMarketplaceFilter } from "@/lib/marketplace-filter-client";
import { fetchLabelBatchOrders, type LabelBatchOrder } from "@/lib/api/operations";
import { fetchShippingLabelPreviewBlob } from "@/lib/shipping-label-file";

const PREVIEW_CONCURRENCY = 3;

type Preview =
  | { state: "loading" }
  | { state: "ok"; url: string; kind: "image" | "pdf" }
  | { state: "error"; message: string };

export default function LabelBatchPage() {
  return (
    <Suspense fallback={null}>
      <LabelBatch />
    </Suspense>
  );
}

function LabelBatch() {
  const waveId = useSearchParams().get("onda") ?? undefined;
  const [orders, setOrders] = useState<LabelBatchOrder[]>([]);
  const [waveName, setWaveName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketplace, setMarketplace] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const objectUrls = useRef<string[]>([]);
  const previewRun = useRef(0);
  const previewSection = useRef<HTMLDivElement>(null);

  const revokeAll = useCallback(() => {
    objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.current = [];
  }, []);

  useEffect(() => revokeAll, [revokeAll]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchLabelBatchOrders(waveId)
      .then((d) => {
        setOrders(d.orders);
        setWaveName(d.wave?.name ?? null);
        setSelected(new Set(d.orders.filter((o) => o.hasLabel).map((o) => o.id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar pedidos"))
      .finally(() => setLoading(false));
  }, [waveId]);

  const visible = useMemo(
    () => orders.filter((o) => !marketplace || matchesMarketplaceFilter(o.marketplace, marketplace)),
    [orders, marketplace],
  );
  const selectable = visible.filter((o) => o.hasLabel);
  const selectedVisible = selectable.filter((o) => selected.has(o.id));
  const allSelected = selectable.length > 0 && selectedVisible.length === selectable.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const o of selectable) {
        if (allSelected) next.delete(o.id);
        else next.add(o.id);
      }
      return next;
    });

  const showBatch = async () => {
    const ids = selectedVisible.map((o) => o.id);
    const run = ++previewRun.current;
    revokeAll();
    setPreviewIds(ids);
    setPreviews(Object.fromEntries(ids.map((id) => [id, { state: "loading" } as Preview])));
    requestAnimationFrame(() => previewSection.current?.scrollIntoView({ behavior: "smooth" }));

    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        let preview: Preview;
        try {
          const { blob, contentType } = await fetchShippingLabelPreviewBlob(id);
          const url = URL.createObjectURL(blob);
          objectUrls.current.push(url);
          preview = { state: "ok", url, kind: contentType.includes("pdf") ? "pdf" : "image" };
        } catch (e) {
          preview = { state: "error", message: e instanceof Error ? e.message : "Erro ao carregar" };
        }
        if (run !== previewRun.current) return;
        setPreviews((prev) => ({ ...prev, [id]: preview }));
      }
    };
    await Promise.all(Array.from({ length: PREVIEW_CONCURRENCY }, worker));
  };

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const loadedCount = previewIds.filter((id) => previews[id]?.state !== "loading").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader
          title="Etiquetas em lote"
          description="Visualize de uma vez as etiquetas de envio dos pedidos já conferidos."
        />
        <Link href="/packing" className="rounded-lg border bg-white px-3 py-2 text-sm font-medium">
          Voltar
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MarketplaceFilter value={marketplace} onChange={setMarketplace} />
        {waveId ? (
          <span className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Onda: {waveName ?? "…"}
            <Link href="/packing/etiquetas" className="text-xs font-medium underline">
              ver todas
            </Link>
          </span>
        ) : null}
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={!loading && visible.length === 0}
        emptyMessage="Nenhum pedido conferido aguardando expedição."
      >
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={toggleAll}
                    aria-label="Selecionar todos"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Pedido</th>
                <th className="px-3 py-2 font-medium">Marketplace</th>
                <th className="px-3 py-2 font-medium">Onda</th>
                <th className="px-3 py-2 font-medium">Cesta</th>
                <th className="px-3 py-2 font-medium">Etiqueta</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      disabled={!o.hasLabel}
                      onChange={() => toggle(o.id)}
                      aria-label={`Selecionar ${o.erpOrderId}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono font-medium">{o.erpOrderId}</span>
                    {o.customerName ? (
                      <span className="block text-xs text-muted-foreground">{o.customerName}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <MarketplaceBadge value={o.marketplace} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{o.waveName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono">{o.basketCode ?? "—"}</td>
                  <td className="px-3 py-2">
                    {o.hasLabel ? (
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Gerada
                      </span>
                    ) : (
                      <span
                        className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                        title="Gere a etiqueta na conferência do pedido"
                      >
                        Ainda não gerada
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-md">
          <p className="text-sm">
            <strong>{selectedVisible.length}</strong> etiqueta(s) selecionada(s)
          </p>
          <button
            type="button"
            disabled={selectedVisible.length === 0}
            onClick={showBatch}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Visualizar lote
          </button>
        </div>
      </DataState>

      {previewIds.length > 0 ? (
        <section ref={previewSection} className="scroll-mt-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Lote com {previewIds.length} etiqueta(s)
            {loadedCount < previewIds.length ? (
              <span className="ml-2 font-normal text-muted-foreground">
                carregando {loadedCount}/{previewIds.length}…
              </span>
            ) : null}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {previewIds.map((id) => {
              const order = orderById.get(id);
              const preview = previews[id];
              return (
                <div key={id} className="overflow-hidden rounded-xl border bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <span className="font-mono text-sm font-semibold">{order?.erpOrderId ?? id}</span>
                    <MarketplaceBadge value={order?.marketplace ?? null} />
                  </div>
                  <div className="flex h-80 items-center justify-center bg-slate-50 p-2">
                    {!preview || preview.state === "loading" ? (
                      <Loader2 className="h-6 w-6 animate-spin text-[#0d9488]" />
                    ) : preview.state === "error" ? (
                      <p className="px-4 text-center text-sm text-destructive">{preview.message}</p>
                    ) : preview.kind === "pdf" ? (
                      <iframe src={preview.url} title={`Etiqueta ${order?.erpOrderId ?? id}`} className="h-full w-full" />
                    ) : (
                      <img
                        src={preview.url}
                        alt={`Etiqueta ${order?.erpOrderId ?? id}`}
                        className="h-full w-full object-contain"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
