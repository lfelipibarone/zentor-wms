"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Printer, RefreshCw, ScanBarcode } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
import { matchesMarketplaceFilter } from "@/lib/marketplace-filter-client";
import { DataState } from "@/components/ops/data-state";
import { WaveLineIssueModal } from "@/components/ops/wave-line-issue-modal";
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

type QueueFilter = "all" | "wave" | "order";

const ZONE_STORAGE_KEY = "packing.approachWaveId";
const WAVE_ROW_LIMIT = 12;

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
  const router = useRouter();

  const [items, setItems] = useState<PackingQueueItem[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [marketplace, setMarketplace] = useState("");
  const [basketScan, setBasketScan] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [labelBusyWaveId, setLabelBusyWaveId] = useState<string | null>(null);
  const openingRef = useRef(false);
  const basketInputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef("");
  const hasItemsRef = useRef(false);
  const [zones, setZones] = useState<ApproachWaveSummary[]>([]);
  const [zone, setZone] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem(ZONE_STORAGE_KEY) ?? ""),
  );

  useEffect(() => {
    // limpa ?line= antigo (conferência agora é na tabela)
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
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
  const isEmpty = !loading && visible.length === 0;

  const filters: { id: QueueFilter; label: string }[] = [
    { id: "all", label: "Todos" },
    { id: "wave", label: "Ondas" },
    { id: "order", label: "Pedidos" },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Packing"
        description="Conferir na tabela: digite a qtd e confirme ou reporte."
      />

      {message ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <DataState
            loading={loading}
            error={error}
            empty={isEmpty}
            emptyMessage="Nada na fila deste filtro."
          >
            <div className="space-y-4">
              {visible.map((entry) =>
                entry.kind === "wave" ? (
                  <WaveStationBlock
                    key={`wave-${entry.wave.id}`}
                    wave={entry.wave}
                    busy={labelBusyWaveId === entry.wave.id}
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
                    onOpen={() => goToOrder(entry.order.id)}
                  />
                ),
              )}
            </div>
          </DataState>
        </div>

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
            Pedidos avulsos (fora de onda).
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
            {saving ? "Abrindo…" : "Abrir pedido"}
          </button>
        </form>
      </div>
    </div>
  );
}

type UnifiedReadyRow = {
  key: string;
  lineId: string;
  allocationId: string;
  erpOrderId: string;
  basketCode: string | null;
  sku: string;
  productName: string;
  routeLabel: string;
  remaining: number;
  qtyDone: number;
  qtyTotal: number;
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
  onRetryLabels,
  onPrintLabels,
  onChanged,
  onMessage,
}: {
  wave: PackingWaveQueueSummary;
  busy: boolean;
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

  const unifiedRows: UnifiedReadyRow[] = ready.flatMap((line) => {
    const allocs = (line.allocations ?? []).filter((a) => a.remaining > 0);
    return allocs.map((a) => ({
      key: `${line.id}-${a.id}`,
      lineId: line.id,
      allocationId: a.id,
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

  const shown = unifiedRows.slice(0, WAVE_ROW_LIMIT);
  const hidden = unifiedRows.length - shown.length;

  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportState | null>(null);

  useEffect(() => {
    setQtyByKey((prev) => {
      const next: Record<string, string> = {};
      for (const row of unifiedRows) {
        next[row.key] =
          prev[row.key] !== undefined && prev[row.key] !== ""
            ? prev[row.key]
            : String(row.remaining);
      }
      return next;
    });
    // Só quando a lista de keys muda (fila atualizou)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedRows.map((r) => `${r.key}:${r.remaining}`).join("|")]);

  const confirmRow = async (row: UnifiedReadyRow, quantity: number) => {
    setRowBusy(row.key);
    onMessage(null);
    try {
      await apiFetch(`/api/packing/waves/lines/${row.lineId}/sort`, {
        method: "POST",
        body: JSON.stringify({
          allocationId: row.allocationId,
          quantity,
        }),
      });
      onMessage(`Conferido ${row.erpOrderId} · ${row.sku} · ${quantity} un.`);
      onChanged();
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
              Onda
            </span>
            <CollectionDeadlineIndicator
              deadline={wave.collectionDeadline}
              className="text-xs"
            />
          </div>
          <h2 className="truncate text-base font-semibold tracking-tight text-slate-900">
            {wave.name}
          </h2>
          <p className="text-sm text-slate-500">
            {wave.orderCount} pedidos · packing {wave.linesSorted}/{wave.linesTotal}
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

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
              labelsOk >= labelsTotal && labelsTotal > 0
                ? "bg-emerald-100 text-emerald-800"
                : labelsFailed > 0
                  ? "bg-red-100 text-red-800"
                  : "bg-slate-100 text-slate-700",
            )}
          >
            Etiquetas {labelsOk}/{labelsTotal}
            {labelsFailed > 0 ? ` · ${labelsFailed} erro` : pendingLabels > 0 ? " · …" : ""}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onRetryLabels}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Gerar
          </button>
          <button
            type="button"
            disabled={busy || labelsOk === 0}
            onClick={onPrintLabels}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Printer className="h-3 w-3" />
            Imprimir
          </button>
        </div>
      </header>

      {(wave.labelErrors ?? []).slice(0, 2).map((err) => (
        <p
          key={err.orderId}
          className="border-b border-red-100 bg-red-50 px-4 py-1.5 text-xs text-red-700"
        >
          {err.erpOrderId}: {err.message}
        </p>
      ))}

      {shown.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nenhum item pendente nesta onda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-semibold">Pedido</th>
                <th className="px-3 py-2.5 font-semibold">SKU</th>
                <th className="px-3 py-2.5 font-semibold">Cesta</th>
                <th className="px-3 py-2.5 font-semibold">Local</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qtd</th>
                <th className="px-3 py-2.5 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const qtyStr = qtyByKey[row.key] ?? String(row.remaining);
                const parsed = parseInt(qtyStr, 10);
                const qtyValid =
                  !Number.isNaN(parsed) && parsed > 0 && parsed <= row.remaining;
                const busyRow = rowBusy === row.key;

                return (
                  <tr
                    key={row.key}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-2">
                      <span className="font-mono font-semibold text-slate-900">
                        {row.erpOrderId}
                      </span>
                    </td>
                    <td className="max-w-[160px] px-3 py-2">
                      <span className="block truncate font-mono text-slate-700">
                        {row.sku}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {row.basketCode ?? "—"}
                    </td>
                    <td className="max-w-[110px] truncate px-3 py-2 text-slate-500">
                      {row.routeLabel}
                    </td>
                    <td className="px-3 py-2 text-right">
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
                        aria-label={`Quantidade ${row.erpOrderId} ${row.sku}`}
                        className="ml-auto w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right text-sm font-semibold tabular-nums outline-none focus:border-[#0d9488] focus:ring-1 focus:ring-[#0d9488]"
                      />
                      <span className="ml-1 text-xs text-slate-400">/{row.remaining}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyRow || !qtyValid}
                          onClick={() => handleConfirm(row)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
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
                          className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
                        >
                          Reportar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hidden > 0 ? (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          +{hidden} itens nesta onda
        </p>
      ) : null}

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
            Pedido
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
          {order.routeLabel ? `${order.routeLabel} · ` : ""}
          Cesta {order.basket?.code ?? "—"} · {order.items.length} itens
          {order.packingInProgress
            ? ` · em conferência${order.packingOperatorName ? ` (${order.packingOperatorName})` : ""}`
            : ""}
        </p>
        {order.shippingLabelError ? (
          <p className="mt-1 text-xs font-medium text-red-700">
            Etiqueta: {order.shippingLabelError}
          </p>
        ) : order.shippingLabel ? (
          <p className="mt-1 text-xs font-medium text-emerald-700">Etiqueta pronta</p>
        ) : null}
      </div>
      <span className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
        Abrir
      </span>
    </button>
  );
}
