"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Printer, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
import { matchesMarketplaceFilter } from "@/lib/marketplace-filter-client";
import { DataState } from "@/components/ops/data-state";
import { PackingWaveConferencePanel } from "@/components/ops/packing-wave-conference-panel";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  ensureWaveShippingLabels,
  fetchLabelBatchOrders,
  fetchUnifiedPackingQueue,
  scanPackingBasket,
  type PackingOrder,
  type PackingQueueItem,
  type PackingWaveQueueSummary,
} from "@/lib/api/operations";
import { fetchTenantApproachWaves, type ApproachWaveSummary } from "@/lib/api/approach-waves";
import { fetchShippingLabelText } from "@/lib/shipping-label-file";
import { printZplWithQz } from "@/lib/shipping-label-qz";

type QueueFilter = "all" | "wave" | "order";

const ZONE_STORAGE_KEY = "packing.approachWaveId";

function normalizeBasketCode(code: string) {
  return code.trim().toLowerCase();
}

function findOrderByBasketInput(
  orders: PackingOrder[],
  code: string,
): PackingOrder | undefined {
  const normalized = normalizeBasketCode(code);
  if (!normalized) return undefined;
  return orders.find(
    (o) =>
      o.basket?.barcode?.toLowerCase() === normalized ||
      o.basket?.code?.toLowerCase() === normalized,
  );
}

function ordersFromItems(items: PackingQueueItem[]): PackingOrder[] {
  return items
    .filter((i): i is Extract<PackingQueueItem, { kind: "order" }> => i.kind === "order")
    .map((i) => i.order);
}

function filterItems(items: PackingQueueItem[], filter: QueueFilter) {
  if (filter === "all") return items;
  if (filter === "wave") return items.filter((i) => i.kind === "wave");
  return items.filter((i) => i.kind === "order");
}

export default function PackingPage() {
  return (
    <Suspense fallback={null}>
      <PackingHub />
    </Suspense>
  );
}

function PackingHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lineFromUrl = searchParams.get("line");

  const [items, setItems] = useState<PackingQueueItem[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [marketplace, setMarketplace] = useState("");
  const [basketScan, setBasketScan] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(lineFromUrl);
  const [labelBusyWaveId, setLabelBusyWaveId] = useState<string | null>(null);
  const openingRef = useRef(false);
  const basketInputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef("");
  const [zones, setZones] = useState<ApproachWaveSummary[]>([]);
  const [zone, setZone] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem(ZONE_STORAGE_KEY) ?? ""),
  );

  useEffect(() => {
    if (lineFromUrl) setActiveLineId(lineFromUrl);
  }, [lineFromUrl]);

  useEffect(() => {
    fetchTenantApproachWaves("PACKING")
      .then((d) => setZones(d.waves))
      .catch(() => setZones([]));
  }, []);

  const changeZone = (value: string) => {
    setZone(value);
    if (value) window.localStorage.setItem(ZONE_STORAGE_KEY, value);
    else window.localStorage.removeItem(ZONE_STORAGE_KEY);
  };

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUnifiedPackingQueue(zone || undefined);
      setItems(data.items);
    } catch (e) {
      if (zone && e instanceof Error && e.message.includes("não encontrada")) {
        changeZone("");
        return;
      }
      setError(e instanceof Error ? e.message : "Erro ao carregar fila");
    } finally {
      setLoading(false);
    }
  }, [zone]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Poll leve enquanto painel aberto ou etiquetas incompletas
  useEffect(() => {
    const needsPoll = items.some(
      (i) =>
        i.kind === "wave" &&
        i.wave.labelsTotal > 0 &&
        i.wave.labelsOk < i.wave.labelsTotal,
    );
    if (!needsPoll && !activeLineId) return;
    const t = setInterval(() => {
      void loadQueue();
    }, 8_000);
    return () => clearInterval(t);
  }, [items, activeLineId, loadQueue]);

  const goToOrder = useCallback(
    async (orderId: string) => {
      try {
        await apiFetch(`/api/packing/orders/${orderId}/start`, {
          method: "POST",
          body: "{}",
        });
        router.push(`/packing/${orderId}`);
      } catch (e) {
        setMessage(
          e instanceof Error ? e.message : "Não foi possível abrir o pedido",
        );
        lastScanRef.current = "";
      }
    },
    [router],
  );

  const openOrderByBasketCode = useCallback(
    async (rawCode: string) => {
      if (openingRef.current) return;
      const trimmed = rawCode.trim();
      if (!trimmed) return;
      if (lastScanRef.current === trimmed) return;
      lastScanRef.current = trimmed;

      openingRef.current = true;
      setSaving(true);
      setMessage(null);

      try {
        const local = findOrderByBasketInput(ordersFromItems(items), trimmed);
        if (local) {
          await goToOrder(local.id);
          return;
        }

        const { order } = await scanPackingBasket(trimmed);
        await goToOrder(order.id);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Cesta não encontrada");
        lastScanRef.current = "";
      } finally {
        setSaving(false);
        openingRef.current = false;
      }
    },
    [items, goToOrder],
  );

  const handleBasketScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = basketInputRef.current?.value ?? basketScan;
    await openOrderByBasketCode(code);
  };

  const handleBasketKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = (e.currentTarget.value || basketScan).trim();
    if (code) void openOrderByBasketCode(code);
  };

  const openLine = (lineId: string) => {
    setActiveLineId(lineId);
    router.replace(`/packing?line=${encodeURIComponent(lineId)}`, { scroll: false });
  };

  const closePanel = () => {
    setActiveLineId(null);
    router.replace("/packing", { scroll: false });
  };

  const retryWaveLabels = async (waveId: string) => {
    setLabelBusyWaveId(waveId);
    setMessage(null);
    try {
      const result = await ensureWaveShippingLabels(waveId);
      setMessage(
        result.failed.length === 0
          ? `Etiquetas OK: ${result.ok}/${result.total}`
          : `Etiquetas ${result.ok}/${result.total} · ${result.failed.length} com erro`,
      );
      await loadQueue();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao gerar etiquetas");
    } finally {
      setLabelBusyWaveId(null);
    }
  };

  const printWaveLabels = async (waveId: string, waveName: string) => {
    setLabelBusyWaveId(waveId);
    setMessage(null);
    try {
      const batch = await fetchLabelBatchOrders(waveId);
      const withLabel = batch.orders.filter((o) => o.hasLabel);
      if (withLabel.length === 0) {
        setMessage("Nenhuma etiqueta pronta para imprimir nesta onda");
        return;
      }
      const zpls: string[] = [];
      let fail = 0;
      for (const o of withLabel) {
        try {
          zpls.push((await fetchShippingLabelText(o.id)).trim());
        } catch {
          fail++;
        }
      }
      if (zpls.length === 0) {
        setMessage("Não foi possível baixar as etiquetas ZPL");
        return;
      }
      try {
        const { printer } = await printZplWithQz(zpls.join("\n"));
        setMessage(
          `${zpls.length} etiqueta(s) → ${printer}${fail ? ` · ${fail} falharam` : ""}`,
        );
      } catch (e) {
        const blob = new Blob([zpls.join("\n")], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `etiquetas-${waveName.replace(/[^\w.-]+/g, "_")}.zpl`;
        a.click();
        const raw = e instanceof Error ? e.message : "";
        setMessage(
          /connection|websocket/i.test(raw) || !raw
            ? `QZ Tray indisponível — baixei ${zpls.length} etiqueta(s)`
            : raw,
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao imprimir");
    } finally {
      setLabelBusyWaveId(null);
    }
  };

  const visible = filterItems(items, filter).filter((entry) => {
    if (!marketplace) return true;
    if (entry.kind !== "order") return true;
    return matchesMarketplaceFilter(entry.order.marketplace, marketplace);
  });
  const isEmpty = !loading && visible.length === 0;

  const filters: { id: QueueFilter; label: string }[] = [
    { id: "all", label: "Todos" },
    { id: "wave", label: "Ondas" },
    { id: "order", label: "Pedidos" },
  ];

  const basketForm = (
    <form
      onSubmit={handleBasketScan}
      className="rounded-xl border bg-white p-6 shadow-sm lg:sticky lg:top-4"
    >
      <label className="text-sm font-semibold text-slate-800">
        Bipar cesta de separação
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Leitor: bip + Enter abre o pedido automaticamente.
      </p>
      <input
        ref={basketInputRef}
        autoFocus={!activeLineId}
        className="mt-3 w-full rounded-lg border px-3 py-3 text-lg font-mono"
        placeholder="Código de barras da cesta"
        value={basketScan}
        onChange={(e) => {
          setBasketScan(e.target.value);
          if (message) setMessage(null);
          lastScanRef.current = "";
        }}
        onKeyDown={handleBasketKeyDown}
      />
      <button
        type="submit"
        disabled={saving || !basketScan.trim()}
        className="mt-3 w-full rounded-lg bg-[#0d9488] py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Abrindo…" : "Abrir pedido"}
      </button>
    </form>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Packing"
        description="Fila, conferência e etiquetas na mesma tela."
      />

      {message ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_min(380px,100%)] lg:items-start">
        <div className="order-2 space-y-4 lg:order-1">
          <div className="flex flex-wrap items-center gap-2">
            <MarketplaceFilter value={marketplace} onChange={setMarketplace} />
            {zones.length > 0 ? (
              <select
                value={zone}
                onChange={(e) => changeZone(e.target.value)}
                className="rounded-lg border bg-white px-3 py-2 text-sm"
                title="Onda de aproximação desta mesa"
              >
                <option value="">Todas as áreas</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
                <option value="none">Sem área</option>
              </select>
            ) : null}
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium",
                  filter === f.id
                    ? "border-[#0d9488] bg-[#0d9488] text-white"
                    : "bg-white text-slate-700",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <DataState
            loading={loading}
            error={error}
            empty={isEmpty}
            emptyMessage="Nenhum item neste filtro."
          >
            <div className="space-y-2">
              {visible.map((entry) =>
                entry.kind === "wave" ? (
                  <WaveQueueCard
                    key={`wave-${entry.wave.id}`}
                    wave={entry.wave}
                    busy={labelBusyWaveId === entry.wave.id}
                    activeLineId={activeLineId}
                    onOpenLine={openLine}
                    onRetryLabels={() => void retryWaveLabels(entry.wave.id)}
                    onPrintLabels={() =>
                      void printWaveLabels(entry.wave.id, entry.wave.name)
                    }
                  />
                ) : (
                  <button
                    key={entry.order.id}
                    type="button"
                    onClick={() => goToOrder(entry.order.id)}
                    className={cn(
                      "w-full rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-[#0d9488]",
                      entry.order.packingInProgress && "border-blue-300 bg-blue-50/50",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">
                        Pedido
                      </span>
                      <CollectionDeadlineIndicator
                        deadline={entry.order.collectionDeadline}
                        className="max-w-[55%] justify-end text-xs"
                      />
                    </div>
                    {entry.order.packingInProgress ? (
                      <p className="mt-1 text-xs font-semibold text-blue-800">
                        Em conferência
                        {entry.order.packingOperatorName
                          ? ` · ${entry.order.packingOperatorName}`
                          : ""}
                      </p>
                    ) : null}
                    {entry.order.shippingLabelError ? (
                      <p className="mt-1 text-xs font-medium text-red-700">
                        Etiqueta: {entry.order.shippingLabelError}
                      </p>
                    ) : entry.order.shippingLabel ? (
                      <p className="mt-1 text-xs font-medium text-emerald-700">
                        Etiqueta pronta
                      </p>
                    ) : null}
                    <p className="mt-2 font-mono font-bold">{entry.order.erpOrderId}</p>
                    <div className="mt-1">
                      <MarketplaceBadge value={entry.order.marketplace} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {entry.order.routeLabel ? `${entry.order.routeLabel} · ` : ""}
                      Cesta {entry.order.basket?.code ?? "—"} · {entry.order.items.length}{" "}
                      itens
                    </p>
                  </button>
                ),
              )}
            </div>
          </DataState>
        </div>

        <div className="order-1 lg:order-2">
          {activeLineId ? (
            <PackingWaveConferencePanel
              lineId={activeLineId}
              onClose={closePanel}
              onChanged={() => void loadQueue()}
            />
          ) : (
            basketForm
          )}
        </div>
      </div>
    </div>
  );
}

const WAVE_CARD_ROW_LIMIT = 8;

type UnifiedReadyRow = {
  key: string;
  lineId: string;
  erpOrderId: string;
  basketCode: string | null;
  sku: string;
  routeLabel: string;
  qtyDone: number;
  qtyTotal: number;
};

function WaveQueueCard({
  wave,
  busy,
  activeLineId,
  onOpenLine,
  onRetryLabels,
  onPrintLabels,
}: {
  wave: PackingWaveQueueSummary;
  busy: boolean;
  activeLineId: string | null;
  onOpenLine: (lineId: string) => void;
  onRetryLabels: () => void;
  onPrintLabels: () => void;
}) {
  const pickedPct =
    wave.unitsTotal > 0 ? Math.round((wave.unitsPicked / wave.unitsTotal) * 100) : 0;
  const ready = wave.readyLines.filter((l) => l.quantityPicked >= l.quantityTotal);
  const collecting = wave.readyLines.length - ready.length;
  const labelsTotal = wave.labelsTotal ?? wave.orderCount;
  const labelsOk = wave.labelsOk ?? 0;
  const labelsFailed = wave.labelsFailed ?? 0;
  const pendingLabels = Math.max(0, labelsTotal - labelsOk);

  const unifiedRows: UnifiedReadyRow[] = ready.flatMap((line) => {
    const allocs = (line.allocations ?? []).filter((a) => a.remaining > 0);
    if (allocs.length === 0) {
      return [
        {
          key: line.id,
          lineId: line.id,
          erpOrderId: "—",
          basketCode: null,
          sku: line.sku,
          routeLabel: line.routeLabel ?? line.locationBarcode,
          qtyDone: 0,
          qtyTotal: line.quantityTotal,
        },
      ];
    }
    return allocs.map((a) => ({
      key: `${line.id}-${a.id}`,
      lineId: line.id,
      erpOrderId: a.erpOrderId,
      basketCode: a.basketCode,
      sku: line.sku,
      routeLabel: line.routeLabel ?? line.locationBarcode,
      qtyDone: a.quantitySorted,
      qtyTotal: a.quantity,
    }));
  });

  const shown = unifiedRows.slice(0, WAVE_CARD_ROW_LIMIT);
  const hidden = unifiedRows.length - shown.length;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="rounded-md bg-amber-200/80 px-2 py-0.5 text-xs font-bold uppercase text-amber-900">
          Onda
        </span>
        <CollectionDeadlineIndicator
          deadline={wave.collectionDeadline}
          className="max-w-[55%] justify-end text-xs"
        />
      </div>
      <p className="mt-2 font-semibold">{wave.name}</p>
      <p className="text-sm text-muted-foreground">
        {wave.orderCount} pedido(s) · coleta {wave.linesPicked}/{wave.linesTotal} · packing{" "}
        {wave.linesSorted}/{wave.linesTotal}
        {wave.pickerName ? ` · ${wave.pickerName}` : ""}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100">
        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pickedPct}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-1 text-xs font-semibold",
            labelsOk >= labelsTotal && labelsTotal > 0
              ? "bg-emerald-100 text-emerald-800"
              : labelsFailed > 0
                ? "bg-red-100 text-red-800"
                : "bg-white text-amber-900",
          )}
        >
          Etiquetas {labelsOk}/{labelsTotal}
          {labelsFailed > 0 ? ` · ${labelsFailed} erro` : pendingLabels > 0 ? " · gerando…" : ""}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onRetryLabels}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Gerar / retry
        </button>
        <button
          type="button"
          disabled={busy || labelsOk === 0}
          onClick={onPrintLabels}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 disabled:opacity-50"
        >
          <Printer className="h-3 w-3" />
          Imprimir
        </button>
      </div>
      {(wave.labelErrors ?? []).slice(0, 2).map((err) => (
        <p key={err.orderId} className="mt-1 text-xs text-red-700">
          {err.erpOrderId}: {err.message}
        </p>
      ))}

      <p className="mt-3 text-xs font-semibold uppercase text-amber-900">
        Pedidos × itens ({unifiedRows.length})
        {collecting > 0 ? (
          <span className="ml-1 font-normal normal-case text-amber-800">
            · {collecting} SKU aguardando recoleta
          </span>
        ) : null}
      </p>
      <div className="mt-1 space-y-1">
        {shown.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onOpenLine(row.lineId)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm transition hover:border-amber-400",
              activeLineId === row.lineId && "border-[#0d9488] ring-1 ring-[#0d9488]",
            )}
          >
            <span className="min-w-0">
              <span className="font-mono font-semibold">{row.erpOrderId}</span>
              {row.basketCode ? (
                <span className="ml-2 text-muted-foreground">cesta {row.basketCode}</span>
              ) : null}
              <span className="mt-0.5 block truncate">
                <span className="font-mono font-medium">{row.sku}</span>
                <span className="ml-2 text-muted-foreground">{row.routeLabel}</span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block tabular-nums text-muted-foreground">
                {row.qtyDone}/{row.qtyTotal} un.
              </span>
              <span className="text-xs font-semibold text-[#0d9488]">Conferir</span>
            </span>
          </button>
        ))}
        {hidden > 0 ? (
          <p className="px-1 text-xs text-muted-foreground">+{hidden} itens nesta onda</p>
        ) : null}
      </div>
    </div>
  );
}
