"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
import { WaveMapBuilder } from "@/components/waves/wave-map-builder";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { useAuth } from "@/components/auth/auth-provider";
import { Permission } from "@wms/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addOrdersToWave,
  closeWave,
  fetchOpenWave,
  fetchWavePreview,
  fetchWaves,
  releaseWave,
  type OpenWaveSummary,
  type WavePartitionStrategy,
  type WavePreview,
  type WaveRow,
} from "@/lib/api/waves";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import {
  fetchPendingOrdersForWave,
  fetchWavePendingSummary,
  type OrderRow,
} from "@/lib/api/operations";

const PARTITION_STRATEGIES: Array<{
  value: WavePartitionStrategy;
  label: string;
}> = [
  { value: "BY_APPROACH", label: "Por onda de aproximação" },
  { value: "SINGLE_WAVE", label: "Onda única (personalizada)" },
  { value: "SINGLE_ITEM", label: "Item único" },
  { value: "PROXIMITY", label: "Proximidade" },
  { value: "BY_PRODUCT", label: "SKU compartilhado" },
];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  RELEASED: "Ativa",
  CLOSED: "Encerrada",
};

const PENDING_PAGE_SIZES = [50, 100, 200];

type TabKey = "active" | "build";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "active", label: "Ondas ativas" },
  { key: "build", label: "Montar onda" },
];

type BuildMode = "map" | "list";
const BUILD_MODES: Array<{ key: BuildMode; label: string }> = [
  { key: "map", label: "Pelo mapa (colunas e linhas)" },
  { key: "list", label: "Pela lista de pedidos" },
];

export default function OndasPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<TabKey>("active");
  const [buildMode, setBuildMode] = useState<BuildMode>("map");
  /** Pedidos vindos do grupo ou do mapa: ficam no topo da lista até limpar a seleção */
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const [waves, setWaves] = useState<WaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<WavePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [pendingOrders, setPendingOrders] = useState<OrderRow[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingPagination, setPendingPagination] = useState<PaginationMeta | null>(null);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(PENDING_PAGE_SIZES[0]!);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const pendingRequest = useRef(0);
  const [mpSummary, setMpSummary] = useState<{
    total: number;
    marketplaces: Array<{ value: string; label: string; count: number }>;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] = useState("");
  const [partitionStrategy, setPartitionStrategy] =
    useState<WavePartitionStrategy>("BY_PRODUCT");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualPreview, setManualPreview] = useState<WavePreview | null>(null);
  const [manualPreviewLoading, setManualPreviewLoading] = useState(false);
  const [manualReleasing, setManualReleasing] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [appendModal, setAppendModal] = useState<{
    openWave: OpenWaveSummary;
    orderIds: string[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWaves();
      setWaves(data.waves);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar ondas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPendingPage(1);
  }, [marketplaceFilter, debouncedSearch, pendingPageSize]);

  const loadPending = useCallback(async () => {
    const requestId = ++pendingRequest.current;
    setPendingLoading(true);
    setPendingError(null);
    try {
      const data = await fetchPendingOrdersForWave({
        page: pendingPage,
        pageSize: pendingPageSize,
        q: debouncedSearch || undefined,
        marketplace: marketplaceFilter || undefined,
      });
      if (requestId !== pendingRequest.current) return;
      setPendingOrders(data.orders);
      setPendingPagination(data.pagination);
    } catch (e) {
      if (requestId !== pendingRequest.current) return;
      setPendingError(
        e instanceof Error ? e.message : "Erro ao carregar pedidos",
      );
    } finally {
      if (requestId === pendingRequest.current) setPendingLoading(false);
    }
  }, [marketplaceFilter, pendingPage, pendingPageSize, debouncedSearch]);

  const loadMpSummary = useCallback(async () => {
    try {
      setMpSummary(await fetchWavePendingSummary());
    } catch {
      setMpSummary(null);
    }
  }, []);

  useEffect(() => {
    if (tab === "build" && buildMode === "list") {
      void loadPending();
    }
  }, [tab, buildMode, loadPending]);

  useEffect(() => {
    if (tab === "build" && buildMode === "list") void loadMpSummary();
  }, [tab, buildMode, loadMpSummary]);

  const waveParams = () => ({
    marketplace: marketplaceFilter || undefined,
    partitionStrategy,
  });

  const requireMarketplace = (): boolean => {
    if (marketplaceFilter) return true;
    setMessage("Selecione um marketplace antes de pré-visualizar ou liberar a onda.");
    setManualMessage(
      "Selecione um marketplace antes de pré-visualizar ou liberar a onda.",
    );
    return false;
  };

  const loadPreview = async () => {
    if (!requireMarketplace()) return;
    setPreviewLoading(true);
    setMessage(null);
    try {
      const data = await fetchWavePreview(waveParams());
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setMessage(e instanceof Error ? e.message : "Falha ao gerar prévia");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!requireMarketplace()) return;
    setReleasing(true);
    setMessage(null);
    try {
      const result = await releaseWave({ auto: true, ...waveParams() });
      setMessage(
        `Onda liberada: ${result.orderCount} pedidos → ${result.lineCount} passagens na gôndola (mesmo SKU agrupado).`,
      );
      setPreview(null);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao liberar onda");
    } finally {
      setReleasing(false);
    }
  };

  const handleClose = async (id: string) => {
    try {
      await closeWave(id);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao encerrar");
    }
  };

  const filteredPending = useMemo(() => {
    if (pinned.size === 0) return pendingOrders;
    return [...pendingOrders].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
  }, [pendingOrders, pinned]);

  const selectedOffPage = useMemo(() => {
    const onPage = new Set(pendingOrders.map((o) => o.id));
    let n = 0;
    for (const id of selected) if (!onPage.has(id)) n++;
    return n;
  }, [pendingOrders, selected]);

  const allFilteredSelected = useMemo(() => {
    if (filteredPending.length === 0) return false;
    return filteredPending.every((o) => selected.has(o.id));
  }, [filteredPending, selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const o of filteredPending) next.delete(o.id);
      } else {
        for (const o of filteredPending) next.add(o.id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setPinned(new Set());
  };

  const toggleOrder = toggle;

  const handleManualPreview = async () => {
    if (selected.size === 0) return;
    if (!requireMarketplace()) return;
    setManualPreviewLoading(true);
    setManualMessage(null);
    try {
      const data = await fetchWavePreview({
        orderIds: Array.from(selected),
        ...waveParams(),
      });
      setManualPreview(data);
    } catch (e) {
      setManualPreview(null);
      setManualMessage(
        e instanceof Error ? e.message : "Falha ao gerar prévia",
      );
    } finally {
      setManualPreviewLoading(false);
    }
  };

  const finishManualWaveAction = async (messageText: string) => {
    setManualMessage(null);
    setMessage(messageText);
    setPinned(new Set());
    setSelected(new Set());
    setManualPreview(null);
    setAppendModal(null);
    await Promise.all([load(), loadPending()]);
    setTab("active");
  };

  const handleManualRelease = async () => {
    if (selected.size === 0) return;
    const orderIds = Array.from(selected);
    setManualMessage(null);
    try {
      const { wave: openWave } = await fetchOpenWave();
      if (openWave) {
        setAppendModal({ openWave, orderIds });
        return;
      }
    } catch {
      /* segue para criar nova onda */
    }
    await createNewWaveFromSelection(orderIds);
  };

  const createNewWaveFromSelection = async (orderIds: string[]) => {
    if (!requireMarketplace()) return;
    setManualReleasing(true);
    setManualMessage(null);
    try {
      const result = await releaseWave({
        orderIds,
        auto: false,
        ...waveParams(),
      });
      await finishManualWaveAction(
        `Onda criada com ${result.orderCount} pedido(s) → ${result.lineCount} linha(s).`,
      );
    } catch (e) {
      setManualMessage(
        e instanceof Error ? e.message : "Falha ao criar onda",
      );
    } finally {
      setManualReleasing(false);
    }
  };

  const appendToOpenWave = async () => {
    if (!appendModal) return;
    setManualReleasing(true);
    setManualMessage(null);
    try {
      const result = await addOrdersToWave(
        appendModal.openWave.id,
        appendModal.orderIds,
      );
      await finishManualWaveAction(
        `${result.added} pedido(s) anexados à onda "${appendModal.openWave.name}".`,
      );
    } catch (e) {
      setManualMessage(
        e instanceof Error ? e.message : "Falha ao anexar à onda",
      );
    } finally {
      setManualReleasing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ondas de separação"
        description="Agrupa pedidos com o mesmo SKU na mesma gôndola. O operador aceita a onda no app antes de separar."
      >
        {can(Permission.SETTINGS_MANAGE) ? (
          <Link
            href="/ondas/configuracoes"
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Configurações
          </Link>
        ) : null}
      </PageHeader>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-[#0d9488] text-[#0d9488]"
                : "border-transparent text-muted-foreground hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="flex flex-wrap items-end gap-4 rounded-xl border bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Marketplace (obrigatório para liberar)
          </label>
          <MarketplaceFilter
            value={marketplaceFilter}
            onChange={setMarketplaceFilter}
          />
        </div>
        {tab === "build" && buildMode === "map" ? (
          <p className="pb-2 text-xs text-muted-foreground">
            Pelo mapa a onda sai única, com todos os pedidos das colunas/linhas marcadas.
          </p>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Modo de onda
            </label>
            <select
              value={partitionStrategy}
              onChange={(e) =>
                setPartitionStrategy(e.target.value as WavePartitionStrategy)
              }
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              {PARTITION_STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {tab === "active" ? (
        <ActiveTab
          waves={waves}
          loading={loading}
          error={error}
          previewLoading={previewLoading}
          preview={preview}
          releasing={releasing}
          message={message}
          onPreview={loadPreview}
          onRelease={handleRelease}
          onReload={load}
          onCloseWave={handleClose}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 text-sm sm:w-fit">
            {BUILD_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setBuildMode(m.key)}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  buildMode === m.key ? "bg-white text-[#0d9488] shadow-sm" : "text-slate-600"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {buildMode === "map" ? (
            <WaveMapBuilder
              marketplace={marketplaceFilter}
              onCreated={(text) => {
                setMessage(text);
                void load();
              }}
              onUseInList={(ids) => {
                setSelected(new Set(ids));
                setPinned(new Set(ids));
                setManualPreview(null);
                setManualMessage(`${ids.length} pedido(s) vindos do mapa selecionados — estão no topo da lista.`);
                setBuildMode("list");
              }}
            />
          ) : (
            <BuildTab
              pendingOrders={filteredPending}
              pagination={pendingPagination}
              onPageChange={setPendingPage}
              pageSize={pendingPageSize}
              onPageSize={setPendingPageSize}
              selectedOffPage={selectedOffPage}
              marketplace={marketplaceFilter}
              onMarketplace={setMarketplaceFilter}
              marketplaceSummary={mpSummary}
              loading={pendingLoading}
              error={pendingError}
              search={search}
              onSearch={setSearch}
              partitionStrategy={partitionStrategy}
              selected={selected}
              allFilteredSelected={allFilteredSelected}
              onToggle={toggleOrder}
              onToggleAll={toggleAllFiltered}
              onClearSelection={clearSelection}
              manualPreview={manualPreview}
              manualPreviewLoading={manualPreviewLoading}
              manualReleasing={manualReleasing}
              manualMessage={manualMessage}
              onPreview={handleManualPreview}
              onRelease={handleManualRelease}
              onReload={() => {
                void loadPending();
                void loadMpSummary();
              }}
            />
          )}
        </div>
      )}

      {appendModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Onda em aberto</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Existe a onda <strong>{appendModal.openWave.name}</strong> com{" "}
              {appendModal.openWave.orderCount} pedido(s), ainda sem operador.
              O que deseja fazer com os {appendModal.orderIds.length} pedido(s)
              selecionado(s)?
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={manualReleasing}
                onClick={() => setAppendModal(null)}
                className="rounded-lg border bg-white px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={manualReleasing}
                onClick={() => {
                  const ids = appendModal.orderIds;
                  setAppendModal(null);
                  void createNewWaveFromSelection(ids);
                }}
                className="rounded-lg border bg-white px-4 py-2 text-sm font-medium"
              >
                Criar nova onda
              </button>
              <button
                type="button"
                disabled={manualReleasing}
                onClick={() => void appendToOpenWave()}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {manualReleasing ? "Anexando…" : "Anexar a esta onda"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ActiveTabProps {
  waves: WaveRow[];
  loading: boolean;
  error: string | null;
  previewLoading: boolean;
  preview: WavePreview | null;
  releasing: boolean;
  message: string | null;
  onPreview: () => void;
  onRelease: () => void;
  onReload: () => void;
  onCloseWave: (id: string) => void;
}

function ActiveTab({
  waves,
  loading,
  error,
  previewLoading,
  preview,
  releasing,
  message,
  onPreview,
  onRelease,
  onReload,
  onCloseWave,
}: ActiveTabProps) {
  return (
    <div className="space-y-6">
      <div className="mb-2 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={previewLoading}
          onClick={onPreview}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium"
        >
          {previewLoading ? "Calculando…" : "Pré-visualizar onda"}
        </button>
        <button
          type="button"
          disabled={releasing || !preview || preview.orderCount === 0}
          onClick={onRelease}
          className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {releasing ? "Liberando…" : "Confirmar e liberar onda"}
        </button>
        <button
          type="button"
          onClick={onReload}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium"
        >
          Atualizar
        </button>
      </div>

      {preview ? (
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Prévia da onda</h2>
          {preview.error ? (
            <p className="text-sm text-amber-700">{preview.error}</p>
          ) : (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Modo: {preview.partitionStrategy ?? "—"} · Marketplace:{" "}
                {preview.marketplace ?? "todos"} · {preview.waveCount ?? 1}{" "}
                onda(s)
              </p>
              <p>
                {preview.orderCount} pedido(s) → {preview.gondolaPasses}{" "}
                passagem(ns) na gôndola
              </p>
              {preview.waves?.some((w) => w.parts?.length) ? (
                <p>
                  Partes:{" "}
                  {preview.waves
                    .flatMap((w) => w.parts ?? [])
                    .map((p) => `${p.name} (${p.lineCount})`)
                    .join(" · ")}
                </p>
              ) : null}
              {(preview.excludedOrderIds?.length ?? 0) > 0 ? (
                <p className="text-amber-700">
                  {preview.excludedOrderIds!.length} pedido(s) excluído(s) —
                  sem vínculo de SKU/proximidade, abaixo do mínimo por onda
                  {preview.partitionStrategy === "SINGLE_ITEM"
                    ? " ou multi-SKU (modo item único)"
                    : null}
                  {preview.partitionStrategy === "BY_PRODUCT" &&
                  (preview.excludedOrderDetails?.some(
                    (d) => d.reason === "too_many_skus",
                  ) ??
                    false)
                    ? " ou mais de 5 SKUs (modo SKU compartilhado)"
                    : null}
                </p>
              ) : null}
            </div>
          )}
          {preview.lines.length > 0 ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-sm">
              {preview.lines.map((l, i) => (
                <li key={i} className="font-mono text-slate-700">
                  {l.productSku} · {l.locationLabel} · {l.quantityTotal} un. ·{" "}
                  {l.orderCount} pedido(s)
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      <DataState loading={loading} error={error} empty={waves.length === 0}>
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pedidos</TableHead>
                <TableHead>Linhas</TableHead>
                <TableHead>Liberada</TableHead>
                <TableHead>Aceita por</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {waves.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">
                    {w.name}
                    {w.template ? (
                      <span
                        title={`Gerada da onda fixa "${w.template.name}"`}
                        className="ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-normal text-white"
                        style={{ background: w.template.color }}
                      >
                        Onda fixa
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{STATUS_LABEL[w.status] ?? w.status}</TableCell>
                  <TableCell>{w.orderCount}</TableCell>
                  <TableCell>{w.lineCount}</TableCell>
                  <TableCell>
                    {w.releasedAt
                      ? new Date(w.releasedAt).toLocaleString("pt-BR")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {w.acceptedBy
                      ? `${w.acceptedBy}${w.acceptedAt ? ` · ${new Date(w.acceptedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}`
                      : w.status === "RELEASED"
                        ? "Aguardando aceite"
                        : "—"}
                  </TableCell>
                  <TableCell className="space-x-3 text-right">
                    <Link
                      href={`/ondas/${w.id}`}
                      className="text-sm font-semibold text-[#0d9488] underline"
                    >
                      Editar
                    </Link>
                    {w.status === "RELEASED" ? (
                      <button
                        type="button"
                        onClick={() => onCloseWave(w.id)}
                        className="text-sm font-semibold text-amber-700 underline"
                      >
                        Encerrar
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DataState>
    </div>
  );
}

interface BuildTabProps {
  pendingOrders: OrderRow[];
  pagination: PaginationMeta | null;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSize: (size: number) => void;
  selectedOffPage: number;
  marketplace: string;
  onMarketplace: (v: string) => void;
  marketplaceSummary: {
    total: number;
    marketplaces: Array<{ value: string; label: string; count: number }>;
  } | null;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (v: string) => void;
  partitionStrategy: WavePartitionStrategy;
  selected: Set<string>;
  allFilteredSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onClearSelection: () => void;
  manualPreview: WavePreview | null;
  manualPreviewLoading: boolean;
  manualReleasing: boolean;
  manualMessage: string | null;
  onPreview: () => void;
  onRelease: () => void;
  onReload: () => void;
}

function BuildTab({
  pendingOrders,
  pagination,
  onPageChange,
  pageSize,
  onPageSize,
  selectedOffPage,
  marketplace,
  onMarketplace,
  marketplaceSummary,
  loading,
  error,
  search,
  onSearch,
  partitionStrategy,
  selected,
  allFilteredSelected,
  onToggle,
  onToggleAll,
  onClearSelection,
  manualPreview,
  manualPreviewLoading,
  manualReleasing,
  manualMessage,
  onPreview,
  onRelease,
  onReload,
}: BuildTabProps) {
  const selectedCount = selected.size;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Buscar por pedido, cliente ou marketplace"
          className="w-full max-w-md rounded-lg border bg-white px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={onReload}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium"
        >
          Atualizar
        </button>
        <span className="text-sm text-muted-foreground">
          {pagination ? `${pagination.total} pedido(s) sem onda` : ""}
        </span>
      </div>

      {marketplaceSummary && marketplaceSummary.marketplaces.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: "", label: "Todos", count: marketplaceSummary.total },
            ...marketplaceSummary.marketplaces,
          ].map((m) => {
            const active = marketplace === m.value;
            return (
              <button
                key={m.value || "all"}
                type="button"
                onClick={() => onMarketplace(m.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition ${
                  active
                    ? "border-[#0d9488] bg-[#0d9488] text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {m.label}
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {m.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {manualMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {manualMessage}
        </p>
      ) : null}

      <DataState
        loading={loading}
        error={error}
        empty={pendingOrders.length === 0}
      >
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos visíveis"
                    checked={allFilteredSelected}
                    onChange={onToggleAll}
                  />
                </TableHead>
                <TableHead>Pedido ERP</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Marketplace</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Prioridade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingOrders.map((o) => {
                const isSelected = selected.has(o.id);
                return (
                  <TableRow
                    key={o.id}
                    className={isSelected ? "bg-teal-50/60" : undefined}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(o.id)}
                        aria-label={`Selecionar pedido ${o.erpOrderId}`}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {o.erpOrderId}
                    </TableCell>
                    <TableCell>{o.customerName ?? "—"}</TableCell>
                    <TableCell>
                      <MarketplaceBadge value={o.marketplace} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {o.collectionDeadline
                        ? new Date(o.collectionDeadline).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">{o.itemCount}</TableCell>
                    <TableCell className="text-right">{o.qtyOrdered}</TableCell>
                    <TableCell className="text-right">{o.priority}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {pagination && pagination.total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t">
              <label className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
                Por página
                <select
                  value={pageSize}
                  onChange={(e) => onPageSize(Number(e.target.value))}
                  className="rounded-md border bg-white px-2 py-1 text-sm"
                >
                  {PENDING_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex-1 [&>div]:border-t-0">
                <Pagination pagination={pagination} onPageChange={onPageChange} />
              </div>
            </div>
          ) : null}
        </div>
      </DataState>

      {manualPreview ? (
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Prévia da onda manual</h2>
          {manualPreview.error ? (
            <p className="text-sm text-amber-700">{manualPreview.error}</p>
          ) : (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Modo: {manualPreview.partitionStrategy ?? partitionStrategy} ·{" "}
                {manualPreview.waveCount ?? 1} onda(s)
              </p>
              <p>
                {manualPreview.orderCount} pedido(s) →{" "}
                {manualPreview.gondolaPasses} passagem(ns) na gôndola
              </p>
              {manualPreview.waves?.some((w) => w.parts?.length) ? (
                <p>
                  Partes:{" "}
                  {manualPreview.waves
                    .flatMap((w) => w.parts ?? [])
                    .map((p) => `${p.name} (${p.lineCount})`)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
          )}
          {manualPreview.lines.length > 0 ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-sm">
              {manualPreview.lines.map((l, i) => (
                <li key={i} className="font-mono text-slate-700">
                  {l.productSku} · {l.locationLabel} · {l.quantityTotal} un. ·{" "}
                  {l.orderCount} pedido(s)
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-md">
        <div className="text-sm">
          <strong>{selectedCount}</strong> pedido(s) selecionado(s)
          {selectedOffPage > 0 ? (
            <span className="ml-1 text-muted-foreground">
              · {selectedOffPage} em outras páginas
            </span>
          ) : null}
          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-3 text-xs font-medium text-muted-foreground underline"
            >
              Limpar
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={selectedCount === 0 || manualPreviewLoading}
            onClick={onPreview}
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {manualPreviewLoading ? "Calculando…" : "Pré-visualizar"}
          </button>
          <button
            type="button"
            disabled={selectedCount === 0 || manualReleasing}
            onClick={onRelease}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {manualReleasing ? "Criando…" : "Criar onda com selecionados"}
          </button>
        </div>
      </div>
    </div>
  );
}
