"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Printer,
  RefreshCw,
  ScanBarcode,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
import { matchesMarketplaceFilter } from "@/lib/marketplace-filter-client";
import { DataState } from "@/components/ops/data-state";
import { WaveLineIssueModal } from "@/components/ops/wave-line-issue-modal";
import { PackingOrderInline } from "@/components/ops/packing-order-inline";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  ensureWaveShippingLabels,
  fetchLabelBatchOrders,
  fetchUnifiedPackingQueue,
  scanPackingBasket,
  type PackingIssueType,
  type PackingOrder,
  type PackingQueueItem,
  type PackingWaveQueueSummary,
} from "@/lib/api/operations";
import { fetchTenantApproachWaves, type ApproachWaveSummary } from "@/lib/api/approach-waves";
import { fetchShippingLabelText } from "@/lib/shipping-label-file";
import { printZplWithQz } from "@/lib/shipping-label-qz";
import { ensureAndPrintOrderShippingLabel } from "@/lib/print-order-shipping-label";

type QueueFilter = "all" | "wave" | "order";

const ZONE_STORAGE_KEY = "packing.approachWaveId";
/** SKU | Local | Qtd | Ações — pedido fica no cabeçalho do grupo */
const WAVE_ITEM_COLS = "minmax(140px,1.3fr) minmax(100px,0.9fr) 88px 188px";

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

/** Pedido de onda localizado pela cesta (código da allocation). */
function findWaveOrderByBasket(
  items: PackingQueueItem[],
  code: string,
): { waveId: string; orderId: string; erpOrderId: string } | null {
  const normalized = normalizeBasketCode(code);
  if (!normalized) return null;
  for (const entry of items) {
    if (entry.kind !== "wave") continue;
    for (const line of entry.wave.readyLines) {
      for (const a of line.allocations ?? []) {
        if (a.basketCode?.toLowerCase() === normalized) {
          return {
            waveId: entry.wave.id,
            orderId: a.orderId,
            erpOrderId: a.erpOrderId,
          };
        }
      }
    }
  }
  return null;
}

function findWaveContainingOrder(
  items: PackingQueueItem[],
  orderId: string,
): string | null {
  for (const entry of items) {
    if (entry.kind !== "wave") continue;
    for (const line of entry.wave.readyLines) {
      if ((line.allocations ?? []).some((a) => a.orderId === orderId)) {
        return entry.wave.id;
      }
    }
  }
  return null;
}

function filterItems(items: PackingQueueItem[], filter: QueueFilter) {
  if (filter === "all") return items;
  if (filter === "wave") return items.filter((i) => i.kind === "wave");
  return items.filter((i) => i.kind === "order");
}

function syncOrderInUrl(orderId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("line");
  if (orderId) url.searchParams.set("order", orderId);
  else url.searchParams.delete("order");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function PackingPage() {
  const [items, setItems] = useState<PackingQueueItem[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [marketplace, setMarketplace] = useState("");
  const [basketScan, setBasketScan] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [labelBusyWaveId, setLabelBusyWaveId] = useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  /** Onda expandida na fila (fechada por padrão). */
  const [expandedWaveId, setExpandedWaveId] = useState<string | null>(null);
  /** Pedido a destacar dentro da onda (ex.: após bipar cesta). */
  const [focusWaveOrderId, setFocusWaveOrderId] = useState<string | null>(null);
  const openingRef = useRef(false);
  const basketInputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef("");
  const hasItemsRef = useRef(false);
  const [zones, setZones] = useState<ApproachWaveSummary[]>([]);
  const [zone, setZone] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem(ZONE_STORAGE_KEY) ?? ""),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("order");
    if (fromUrl) setActiveOrderId(fromUrl);
    if (url.searchParams.has("line")) {
      url.searchParams.delete("line");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

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

  const loadQueue = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent && hasItemsRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await fetchUnifiedPackingQueue(zone || undefined);
      setItems(data.items);
      hasItemsRef.current = data.items.length > 0;
    } catch (e) {
      if (zone && e instanceof Error && e.message.includes("não encontrada")) {
        changeZone("");
        return;
      }
      if (!silent) {
        setError(e instanceof Error ? e.message : "Erro ao carregar fila");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [zone]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const needsPoll = items.some(
      (i) =>
        i.kind === "wave" &&
        i.wave.labelsTotal > 0 &&
        i.wave.labelsOk < i.wave.labelsTotal,
    );
    if (!needsPoll) return;
    const t = setInterval(() => {
      void loadQueue({ silent: true });
    }, 8_000);
    return () => clearInterval(t);
  }, [items, loadQueue]);

  const openOrderInline = useCallback((orderId: string) => {
    setActiveOrderId(orderId);
    syncOrderInUrl(orderId);
    setMessage(null);
  }, []);

  const closeOrderInline = useCallback(() => {
    setActiveOrderId(null);
    syncOrderInUrl(null);
    void loadQueue({ silent: true });
  }, [loadQueue]);

  const openWaveOrder = useCallback((waveId: string, orderId: string, erpOrderId: string) => {
    setActiveOrderId(null);
    syncOrderInUrl(null);
    setExpandedWaveId(waveId);
    setFocusWaveOrderId(orderId);
    setMessage(`Onda aberta · pedido ${erpOrderId}`);
  }, []);

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
        const inWave = findWaveOrderByBasket(items, trimmed);
        if (inWave) {
          openWaveOrder(inWave.waveId, inWave.orderId, inWave.erpOrderId);
          setBasketScan("");
          return;
        }

        const local = findOrderByBasketInput(ordersFromItems(items), trimmed);
        if (local) {
          openOrderInline(local.id);
          setBasketScan("");
          return;
        }

        const { order } = await scanPackingBasket(trimmed);
        const waveId = findWaveContainingOrder(items, order.id);
        if (waveId) {
          openWaveOrder(waveId, order.id, order.erpOrderId);
          setBasketScan("");
          return;
        }
        openOrderInline(order.id);
        setBasketScan("");
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Cesta não encontrada");
        lastScanRef.current = "";
      } finally {
        setSaving(false);
        openingRef.current = false;
      }
    },
    [items, openOrderInline, openWaveOrder],
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
      await loadQueue({ silent: true });
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

  /** Pedidos avulsos: esconde o que está sendo conferido inline */
  const queueVisible = visible.filter(
    (e) => !(e.kind === "order" && e.order.id === activeOrderId),
  );
  const isEmpty = !loading && queueVisible.length === 0 && !activeOrderId;

  const filters: { id: QueueFilter; label: string }[] = [
    { id: "all", label: "Todos" },
    { id: "wave", label: "Ondas" },
    { id: "order", label: "Pedidos" },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Packing"
        description="Onda fechada como o pedido; clique para abrir. Bipar a cesta abre direto no pedido."
      />

      {message ? (
        <p
          className={cn(
            "rounded-xl border px-4 py-2.5 text-sm font-medium",
            /falha|erro|indispon/i.test(message)
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-emerald-200 bg-emerald-50 text-emerald-900",
          )}
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <MarketplaceFilter value={marketplace} onChange={setMarketplace} />
        {zones.length > 0 ? (
          <select
            value={zone}
            onChange={(e) => changeZone(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            title="Área desta mesa"
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
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                filter === f.id
                  ? "bg-[#0d9488] text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void loadQueue()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {activeOrderId ? (
        <PackingOrderInline
          orderId={activeOrderId}
          onClose={closeOrderInline}
          onFinished={closeOrderInline}
          onMessage={setMessage}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <DataState
            loading={loading}
            error={error}
            empty={isEmpty}
            emptyMessage="Nada na fila deste filtro."
          >
            <div className="space-y-4">
              {queueVisible.map((entry) =>
                entry.kind === "wave" ? (
                  <WaveStationBlock
                    key={`wave-${entry.wave.id}`}
                    wave={entry.wave}
                    busy={labelBusyWaveId === entry.wave.id}
                    expanded={expandedWaveId === entry.wave.id}
                    focusOrderId={
                      expandedWaveId === entry.wave.id ? focusWaveOrderId : null
                    }
                    onToggle={() =>
                      setExpandedWaveId((prev) =>
                        prev === entry.wave.id ? null : entry.wave.id,
                      )
                    }
                    onRetryLabels={() => void retryWaveLabels(entry.wave.id)}
                    onPrintLabels={() =>
                      void printWaveLabels(entry.wave.id, entry.wave.name)
                    }
                    onChanged={() => void loadQueue({ silent: true })}
                    onMessage={setMessage}
                  />
                ) : (
                  <OrderRow
                    key={entry.order.id}
                    order={entry.order}
                    onOpen={() => openOrderInline(entry.order.id)}
                  />
                ),
              )}
            </div>
          </DataState>
        </div>

        {!activeOrderId ? (
          <form
            onSubmit={handleBasketScan}
            className="rounded-2xl border border-dashed border-slate-300 bg-gradient-to-b from-slate-50 to-white px-5 py-6 lg:sticky lg:top-3"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0d9488]/10 text-[#0d9488]">
              <ScanBarcode className="h-6 w-6" />
            </div>
            <label className="mt-4 block text-center text-base font-semibold text-slate-900">
              Bipar cesta
            </label>
            <p className="mt-1 text-center text-xs text-slate-500">
              Abre a onda no pedido da cesta (ou o avulso).
            </p>
            <input
              ref={basketInputRef}
              autoFocus
              className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 font-mono text-base outline-none ring-[#0d9488] focus:border-[#0d9488] focus:ring-2"
              placeholder="Código da cesta"
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
              className="mt-3 w-full rounded-xl bg-[#0d9488] py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-40"
            >
              {saving ? "Abrindo…" : "Conferir pedido"}
            </button>
          </form>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500 lg:sticky lg:top-3">
            Conferência do pedido aberta acima. Feche-a para bipar outra cesta.
          </div>
        )}
      </div>
    </div>
  );
}

type UnifiedReadyRow = {
  key: string;
  lineId: string;
  allocationId: string;
  orderId: string;
  erpOrderId: string;
  basketCode: string | null;
  sku: string;
  productName: string;
  routeLabel: string;
  remaining: number;
  qtyDone: number;
  qtyTotal: number;
};

type OrderGroup = {
  orderId: string;
  erpOrderId: string;
  basketCode: string | null;
  rows: UnifiedReadyRow[];
  pendingCount: number;
};

type JustDoneOrder = {
  orderId: string;
  erpOrderId: string;
  basketCode: string | null;
  labelOk: boolean;
  labelDetail: string;
};

type ReportState = {
  lineId: string;
  sku: string;
  location: string;
  allocationId: string;
  erpOrderId: string;
  units: number;
  initialType: PackingIssueType;
  initialDescription: string;
};

function WaveStationBlock({
  wave,
  busy,
  expanded,
  focusOrderId,
  onToggle,
  onRetryLabels,
  onPrintLabels,
  onChanged,
  onMessage,
}: {
  wave: PackingWaveQueueSummary;
  busy: boolean;
  expanded: boolean;
  focusOrderId: string | null;
  onToggle: () => void;
  onRetryLabels: () => void;
  onPrintLabels: () => void;
  onChanged: () => void;
  onMessage: (msg: string | null) => void;
}) {
  const pickedPct =
    wave.unitsTotal > 0 ? Math.round((wave.unitsPicked / wave.unitsTotal) * 100) : 0;
  const ready = wave.readyLines.filter((l) => l.quantityPicked >= l.quantityTotal);
  const collecting = wave.readyLines.length - ready.length;
  const labelsTotal = wave.labelsTotal ?? wave.orderCount;
  const labelsOk = wave.labelsOk ?? 0;
  const labelsFailed = wave.labelsFailed ?? 0;
  const pendingLabels = Math.max(0, labelsTotal - labelsOk);
  const pendingItems = ready.reduce(
    (n, l) => n + (l.allocations ?? []).filter((a) => a.remaining > 0).length,
    0,
  );

  useEffect(() => {
    if (!expanded || !focusOrderId) return;
    const t = window.setTimeout(() => {
      document
        .getElementById(`wave-order-${focusOrderId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [expanded, focusOrderId]);


  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [printBusyOrderId, setPrintBusyOrderId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportState | null>(null);
  const [justDone, setJustDone] = useState<JustDoneOrder[]>([]);
  /** Itens conferidos nesta sessão — a API tira a linha da fila após o sort. */
  const [sessionDone, setSessionDone] = useState<UnifiedReadyRow[]>([]);

  const pendingOrderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of ready) {
      for (const a of line.allocations ?? []) {
        if (a.remaining > 0) ids.add(a.orderId);
      }
    }
    return ids;
  }, [ready]);

  const unifiedRows: UnifiedReadyRow[] = useMemo(() => {
    const fromApi = ready.flatMap((line) => {
      const allocs = (line.allocations ?? []).filter(
        (a) => a.remaining > 0 || pendingOrderIds.has(a.orderId),
      );
      return allocs.map((a) => ({
        key: `${line.id}-${a.id}`,
        lineId: line.id,
        allocationId: a.id,
        orderId: a.orderId,
        erpOrderId: a.erpOrderId,
        basketCode: a.basketCode,
        sku: line.sku,
        productName: line.productName,
        routeLabel: line.routeLabel ?? line.locationBarcode,
        remaining: a.remaining,
        qtyDone: a.quantitySorted,
        qtyTotal: a.quantity,
      }));
    });
    const keys = new Set(fromApi.map((r) => r.key));
    const allocIds = new Set(fromApi.map((r) => r.allocationId));
    const extras = sessionDone.filter(
      (r) =>
        pendingOrderIds.has(r.orderId) &&
        !keys.has(r.key) &&
        !allocIds.has(r.allocationId),
    );
    return [...fromApi, ...extras];
  }, [ready, pendingOrderIds, sessionDone]);

  const orderGroups: OrderGroup[] = useMemo(() => {
    const map = new Map<string, OrderGroup>();
    for (const row of unifiedRows) {
      const existing = map.get(row.orderId);
      if (existing) {
        existing.rows.push(row);
        if (row.remaining > 0) existing.pendingCount += 1;
        if (!existing.basketCode && row.basketCode) existing.basketCode = row.basketCode;
      } else {
        map.set(row.orderId, {
          orderId: row.orderId,
          erpOrderId: row.erpOrderId,
          basketCode: row.basketCode,
          rows: [row],
          pendingCount: row.remaining > 0 ? 1 : 0,
        });
      }
    }
    for (const g of map.values()) {
      g.rows.sort((a, b) => {
        if (a.remaining === 0 && b.remaining > 0) return 1;
        if (a.remaining > 0 && b.remaining === 0) return -1;
        return a.sku.localeCompare(b.sku, "pt-BR");
      });
    }
    return [...map.values()].sort((a, b) =>
      a.erpOrderId.localeCompare(b.erpOrderId, "pt-BR"),
    );
  }, [unifiedRows]);

  useEffect(() => {
    setQtyByKey((prev) => {
      const next: Record<string, string> = {};
      for (const row of unifiedRows) {
        if (row.remaining <= 0) continue;
        next[row.key] =
          prev[row.key] !== undefined && prev[row.key] !== ""
            ? prev[row.key]
            : String(row.remaining);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedRows.map((r) => `${r.key}:${r.remaining}`).join("|")]);

  const printOrderLabel = async (orderId: string, erpOrderId: string) => {
    setPrintBusyOrderId(orderId);
    onMessage(null);
    try {
      const { printer } = await ensureAndPrintOrderShippingLabel(orderId);
      onMessage(`Pedido ${erpOrderId} · etiqueta → ${printer}`);
      setJustDone((prev) =>
        prev.map((o) =>
          o.orderId === orderId
            ? { ...o, labelOk: true, labelDetail: `impressa · ${printer}` }
            : o,
        ),
      );
      onChanged();
    } catch (e) {
      const detail =
        e instanceof Error ? e.message : "falha ao imprimir etiqueta";
      onMessage(`Pedido ${erpOrderId}: ${detail}`);
      setJustDone((prev) =>
        prev.map((o) =>
          o.orderId === orderId
            ? { ...o, labelOk: false, labelDetail: detail }
            : o,
        ),
      );
    } finally {
      setPrintBusyOrderId(null);
    }
  };

  const confirmRow = async (row: UnifiedReadyRow, quantity: number) => {
    setRowBusy(row.key);
    onMessage(null);
    try {
      const result = await apiFetch<{
        orderCompleted?: boolean;
        orderId?: string;
        erpOrderId?: string;
      }>(`/api/packing/waves/lines/${row.lineId}/sort`, {
        method: "POST",
        body: JSON.stringify({
          allocationId: row.allocationId,
          quantity,
        }),
      });
      onChanged();
      if (result.orderCompleted && result.orderId) {
        const erp = result.erpOrderId ?? row.erpOrderId;
        setSessionDone((prev) => prev.filter((r) => r.orderId !== result.orderId));
        let labelOk = false;
        let labelDetail = "aguardando impressão";
        try {
          const { printer } = await ensureAndPrintOrderShippingLabel(result.orderId);
          labelOk = true;
          labelDetail = `etiqueta → ${printer}`;
          onMessage(`Pedido ${erp} conferido · ${labelDetail}`);
        } catch (e) {
          labelDetail =
            e instanceof Error ? e.message : "falha ao imprimir etiqueta";
          onMessage(`Pedido ${erp} conferido · etiqueta: ${labelDetail}`);
        }
        setJustDone((prev) => [
          {
            orderId: result.orderId!,
            erpOrderId: erp,
            basketCode: row.basketCode,
            labelOk,
            labelDetail,
          },
          ...prev.filter((o) => o.orderId !== result.orderId),
        ]);
      } else {
        setSessionDone((prev) => [
          ...prev.filter((r) => r.key !== row.key && r.allocationId !== row.allocationId),
          {
            ...row,
            remaining: 0,
            qtyDone: row.qtyTotal,
          },
        ]);
        onMessage(`✓ Conferido ${row.erpOrderId} · ${row.sku} · ${quantity} un.`);
      }
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Erro na conferência");
    } finally {
      setRowBusy(null);
    }
  };

  const handleConfirm = (row: UnifiedReadyRow) => {
    const parsed = parseInt(qtyByKey[row.key] ?? String(row.remaining), 10);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > row.remaining) {
      onMessage(`Informe uma quantidade entre 1 e ${row.remaining}`);
      return;
    }
    if (parsed < row.remaining) {
      setReporting({
        lineId: row.lineId,
        sku: row.sku,
        location: row.routeLabel,
        allocationId: row.allocationId,
        erpOrderId: row.erpOrderId,
        units: row.remaining,
        initialType: "WRONG_QUANTITY",
        initialDescription: `Conferiu ${parsed} de ${row.remaining} un. esperadas.`,
      });
      return;
    }
    void confirmRow(row, parsed);
  };

  const openReport = (row: UnifiedReadyRow) => {
    setReporting({
      lineId: row.lineId,
      sku: row.sku,
      location: row.routeLabel,
      allocationId: row.allocationId,
      erpOrderId: row.erpOrderId,
      units: row.remaining,
      initialType: "WRONG_ITEM",
      initialDescription: "",
    });
  };

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm transition",
        expanded
          ? "border-[#0d9488] ring-1 ring-[#0d9488]/25"
          : "border-slate-200 hover:border-[#0d9488]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
              Onda
            </span>
            <CollectionDeadlineIndicator
              deadline={wave.collectionDeadline}
              className="text-xs"
            />
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                labelsOk >= labelsTotal && labelsTotal > 0
                  ? "bg-emerald-100 text-emerald-800"
                  : labelsFailed > 0
                    ? "bg-red-100 text-red-800"
                    : "bg-slate-100 text-slate-600",
              )}
            >
              Etiquetas {labelsOk}/{labelsTotal}
            </span>
          </div>
          <p className="mt-1.5 truncate text-base font-bold text-slate-900">{wave.name}</p>
          <p className="text-sm text-slate-500">
            {wave.orderCount} pedidos · packing {wave.linesSorted}/{wave.linesTotal}
            {pendingItems > 0 ? ` · ${pendingItems} item(ns) pendente(s)` : ""}
            {wave.pickerName ? ` · ${wave.pickerName}` : ""}
            {collecting > 0 ? ` · ${collecting} SKU em recoleta` : ""}
          </p>
          <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#0d9488]"
              style={{ width: `${pickedPct}%` }}
            />
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0d9488] px-3 py-1.5 text-xs font-semibold text-white">
          {expanded ? (
            <>
              Fechar
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Abrir
              <ChevronRight className="h-3.5 w-3.5" />
            </>
          )}
        </span>
      </button>

      {!expanded ? null : (
        <>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={onRetryLabels}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Gerar etiquetas
        </button>
        <button
          type="button"
          disabled={busy || labelsOk === 0}
          onClick={onPrintLabels}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Printer className="h-3 w-3" />
          Imprimir lote
        </button>
        {pendingLabels > 0 ? (
          <span className="text-xs text-slate-500">{pendingLabels} etiqueta(s) pendente(s)</span>
        ) : null}
      </div>

      {(wave.labelErrors ?? []).slice(0, 2).map((err) => (
        <p
          key={err.orderId}
          className="border-b border-red-100 bg-red-50 px-4 py-1.5 text-xs text-red-700"
        >
          {err.erpOrderId}: {err.message}
        </p>
      ))}

      {justDone.length > 0 ? (
        <div className="space-y-2 border-b border-emerald-100 bg-emerald-50/80 px-4 py-3">
          {justDone.map((done) => (
            <div
              key={done.orderId}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2.5"
            >
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold text-slate-900">
                  {done.erpOrderId}
                  <span className="ml-2 font-sans text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Conferido
                  </span>
                </p>
                <p
                  className={cn(
                    "text-xs",
                    done.labelOk ? "text-emerald-700" : "text-amber-800",
                  )}
                >
                  {done.basketCode ? `cesta ${done.basketCode} · ` : ""}
                  {done.labelOk
                    ? done.labelDetail
                    : `Etiqueta: ${done.labelDetail}`}
                </p>
              </div>
              <button
                type="button"
                disabled={busy || printBusyOrderId === done.orderId}
                onClick={() => void printOrderLabel(done.orderId, done.erpOrderId)}
                className="inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {printBusyOrderId === done.orderId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Printer className="h-3 w-3" />
                )}
                Imprimir
              </button>
              <button
                type="button"
                aria-label="Dispensar"
                onClick={() =>
                  setJustDone((prev) => prev.filter((o) => o.orderId !== done.orderId))
                }
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {orderGroups.length === 0 && justDone.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nenhum item pendente nesta onda.</p>
      ) : orderGroups.length === 0 ? null : (
        <div className="divide-y divide-slate-200">
          {orderGroups.map((group) => (
            <div
              key={group.orderId}
              id={`wave-order-${group.orderId}`}
              className={cn(
                "bg-white scroll-mt-4",
                focusOrderId === group.orderId &&
                  "ring-2 ring-inset ring-[#0d9488] bg-[#0d9488]/5",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                  Pedido
                </span>
                <span className="font-mono text-sm font-bold text-slate-900">
                  {group.erpOrderId}
                </span>
                <span className="min-w-0 flex-1 text-sm text-slate-500">
                  {group.basketCode ? `cesta ${group.basketCode}` : "sem cesta"}
                  {" · "}
                  {group.pendingCount}/{group.rows.length} pendente(s)
                </span>
                <button
                  type="button"
                  disabled={busy || printBusyOrderId === group.orderId || rowBusy !== null}
                  onClick={() => void printOrderLabel(group.orderId, group.erpOrderId)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  title="Gera a etiqueta se faltar e imprime"
                >
                  {printBusyOrderId === group.orderId ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Printer className="h-3 w-3" />
                  )}
                  Imprimir
                </button>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div
                    className="grid items-center gap-x-3 border-b border-slate-100 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    style={{ gridTemplateColumns: WAVE_ITEM_COLS }}
                  >
                    <span>SKU</span>
                    <span>Local</span>
                    <span>Qtd</span>
                    <span>Ações</span>
                  </div>
                  {group.rows.map((row) => {
                    const done = row.remaining <= 0;
                    const qtyStr = qtyByKey[row.key] ?? String(row.remaining);
                    const parsed = parseInt(qtyStr, 10);
                    const qtyValid =
                      !Number.isNaN(parsed) && parsed > 0 && parsed <= row.remaining;
                    const busyRow = rowBusy === row.key;

                    return (
                      <div
                        key={row.key}
                        className={cn(
                          "grid items-center gap-x-3 border-b border-slate-50 px-3 py-2 last:border-0",
                          done ? "bg-emerald-50/70" : "hover:bg-slate-50/80",
                        )}
                        style={{ gridTemplateColumns: WAVE_ITEM_COLS }}
                      >
                        <span
                          className="truncate font-mono text-sm font-semibold text-slate-800"
                          title={row.sku}
                        >
                          {row.sku}
                        </span>
                        <span
                          className="truncate text-sm text-slate-500"
                          title={row.routeLabel}
                        >
                          {row.routeLabel}
                        </span>
                        {done ? (
                          <span className="text-xs font-semibold tabular-nums text-emerald-700">
                            {row.qtyDone}/{row.qtyTotal}
                          </span>
                        ) : (
                          <div className="flex h-8 items-center gap-1">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={row.remaining}
                              value={qtyStr}
                              disabled={busyRow}
                              onChange={(e) =>
                                setQtyByKey((prev) => ({
                                  ...prev,
                                  [row.key]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleConfirm(row);
                                }
                              }}
                              aria-label={`Quantidade ${group.erpOrderId} ${row.sku}`}
                              className="h-8 w-12 rounded-md border border-slate-300 bg-white px-1 text-center text-sm font-semibold tabular-nums outline-none focus:border-[#0d9488] focus:ring-1 focus:ring-[#0d9488]"
                            />
                            <span className="text-xs tabular-nums text-slate-400">
                              /{row.remaining}
                            </span>
                          </div>
                        )}
                        <div className="flex h-8 items-center gap-1.5">
                          {done ? (
                            <span className="inline-flex h-8 items-center gap-1 text-xs font-semibold text-emerald-700">
                              <Check className="h-3.5 w-3.5" />
                              Conferido
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={busyRow || !qtyValid}
                                onClick={() => handleConfirm(row)}
                                className="inline-flex h-8 w-[88px] items-center justify-center gap-1 rounded-md bg-[#0d9488] text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
                              >
                                {busyRow ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : null}
                                Conferir
                              </button>
                              <button
                                type="button"
                                disabled={busyRow}
                                onClick={() => openReport(row)}
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
          ))}
        </div>
      )}

      {reporting ? (
        <WaveLineIssueModal
          lineId={reporting.lineId}
          sku={reporting.sku}
          location={reporting.location}
          order={{
            allocationId: reporting.allocationId,
            erpOrderId: reporting.erpOrderId,
            units: reporting.units,
          }}
          initialType={reporting.initialType}
          initialDescription={reporting.initialDescription}
          onClose={() => setReporting(null)}
          onSubmitted={() => {
            setReporting(null);
            onChanged();
          }}
        />
      ) : null}
        </>
      )}
    </section>
  );
}

function OrderRow({ order, onOpen }: { order: PackingOrder; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-[#0d9488]",
        order.packingInProgress && "border-blue-200 bg-blue-50/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Pedido avulso
          </span>
          <MarketplaceBadge value={order.marketplace} />
          <CollectionDeadlineIndicator
            deadline={order.collectionDeadline}
            className="text-xs"
          />
        </div>
        <p className="mt-1.5 font-mono text-base font-bold text-slate-900">
          {order.erpOrderId}
        </p>
        <p className="text-sm text-slate-500">
          Cesta {order.basket?.code ?? "—"} · {order.items.length} itens
        </p>
      </div>
      <span className="shrink-0 rounded-lg bg-[#0d9488] px-3 py-1.5 text-xs font-semibold text-white">
        Conferir
      </span>
    </button>
  );
}
