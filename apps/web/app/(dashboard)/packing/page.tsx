"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tags } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
import { matchesMarketplaceFilter } from "@/lib/marketplace-filter-client";
import { DataState } from "@/components/ops/data-state";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  fetchUnifiedPackingQueue,
  scanPackingBasket,
  type PackingOrder,
  type PackingQueueItem,
  type PackingWaveQueueSummary,
} from "@/lib/api/operations";
import { fetchTenantApproachWaves, type ApproachWaveSummary } from "@/lib/api/approach-waves";

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
  const router = useRouter();
  const [items, setItems] = useState<PackingQueueItem[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [marketplace, setMarketplace] = useState("");
  const [basketScan, setBasketScan] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const openingRef = useRef(false);
  const basketInputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef("");
  const [zones, setZones] = useState<ApproachWaveSummary[]>([]);
  const [zone, setZone] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem(ZONE_STORAGE_KEY) ?? ""),
  );

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
        autoFocus
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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="Packing" description="Ondas primeiro, depois pedidos." />
        <Link
          href="/packing/etiquetas"
          className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Tags className="h-4 w-4" />
          Etiquetas em lote
        </Link>
      </div>

      {message ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_min(320px,100%)] lg:items-start">
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
                    onOpenWave={() => router.push(`/packing/ondas/${entry.wave.id}`)}
                    onOpenLine={(lineId) => router.push(`/packing/waves/${lineId}`)}
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

        <div className="order-1 lg:order-2">{basketForm}</div>
      </div>
    </div>
  );
}

const WAVE_CARD_LINE_LIMIT = 4;

function WaveQueueCard({
  wave,
  onOpenWave,
  onOpenLine,
}: {
  wave: PackingWaveQueueSummary;
  onOpenWave: () => void;
  onOpenLine: (lineId: string) => void;
}) {
  const pickedPct = wave.unitsTotal > 0 ? Math.round((wave.unitsPicked / wave.unitsTotal) * 100) : 0;
  const ready = wave.readyLines.filter((l) => l.quantityPicked >= l.quantityTotal);
  const collecting = wave.readyLines.length - ready.length;
  const shown = ready.slice(0, WAVE_CARD_LINE_LIMIT);
  const hidden = ready.length - shown.length;

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
        {wave.orderCount} pedido(s) · coleta {wave.linesPicked}/{wave.linesTotal} itens · packing{" "}
        {wave.linesSorted}/{wave.linesTotal}
        {wave.pickerName ? ` · ${wave.pickerName}` : ""}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100">
        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pickedPct}%` }} />
      </div>

      <p className="mt-3 text-xs font-semibold uppercase text-amber-900">
        Prontos para conferir ({ready.length})
        {collecting > 0 ? (
          <span className="ml-1 font-normal normal-case text-amber-800">· {collecting} aguardando recoleta</span>
        ) : null}
      </p>
      <div className="mt-1 space-y-1">
        {shown.map((line) => (
          <button
            key={line.id}
            type="button"
            onClick={() => onOpenLine(line.id)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm transition hover:border-amber-400"
          >
            <span className="min-w-0">
              <span className="font-mono font-semibold">{line.sku}</span>
              <span className="ml-2 text-muted-foreground">
                {line.routeLabel ?? line.locationBarcode}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {line.quantityPicked}/{line.quantityTotal} un.
            </span>
          </button>
        ))}
        {hidden > 0 ? (
          <p className="px-1 text-xs text-muted-foreground">+{hidden} item(ns) na onda completa</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenWave}
        className="mt-3 w-full rounded-lg border border-amber-300 bg-white py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
      >
        Ver onda completa
      </button>
    </div>
  );
}
