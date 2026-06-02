"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
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
import {
  fetchPendingOrdersForWave,
  fetchPickProximityGroups,
  type OrderRow,
  type PickProximityGroup,
} from "@/lib/api/operations";

const PARTITION_STRATEGIES: Array<{
  value: WavePartitionStrategy;
  label: string;
}> = [
  { value: "SINGLE_ITEM", label: "Item único" },
  { value: "PROXIMITY", label: "Proximidade" },
  { value: "BY_PRODUCT", label: "SKU compartilhado" },
];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  RELEASED: "Ativa",
  CLOSED: "Encerrada",
};

type TabKey = "active" | "build";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "active", label: "Ondas ativas" },
  { key: "build", label: "Montar onda" },
];

export default function OndasPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<TabKey>("active");

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
  const [search, setSearch] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] = useState("");
  const [partitionStrategy, setPartitionStrategy] =
    useState<WavePartitionStrategy>("BY_PRODUCT");
  const [proximityGroups, setProximityGroups] = useState<PickProximityGroup[]>(
    [],
  );
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

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    setPendingError(null);
    try {
      const data = await fetchPendingOrdersForWave({
        pageSize: 200,
        marketplace: marketplaceFilter || undefined,
      });
      setPendingOrders(data.orders);
    } catch (e) {
      setPendingError(
        e instanceof Error ? e.message : "Erro ao carregar pedidos",
      );
    } finally {
      setPendingLoading(false);
    }
  }, [marketplaceFilter]);

  const loadProximitySuggestions = useCallback(async () => {
    try {
      const data = await fetchPickProximityGroups({
        marketplace: marketplaceFilter || undefined,
        limit: 10,
      });
      setProximityGroups(data.groups);
    } catch {
      setProximityGroups([]);
    }
  }, [marketplaceFilter]);

  useEffect(() => {
    if (tab === "build") {
      loadPending();
      void loadProximitySuggestions();
    }
  }, [tab, loadPending, loadProximitySuggestions]);

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
    const q = search.trim().toLowerCase();
    if (!q) return pendingOrders;
    return pendingOrders.filter((o) => {
      const erp = (o.erpOrderId ?? "").toLowerCase();
      const cust = (o.customerName ?? "").toLowerCase();
      const mkt = (o.marketplace ?? "").toLowerCase();
      return erp.includes(q) || cust.includes(q) || mkt.includes(q);
    });
  }, [pendingOrders, search]);

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

  const clearSelection = () => setSelected(new Set());

  const selectProximityGroup = (group: PickProximityGroup) => {
    setSelected(new Set(group.orderIds));
  };

  const neighborCountByOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of proximityGroups) {
      for (const id of g.orderIds) {
        map.set(id, Math.max(0, g.orderIds.length - 1));
      }
    }
    return map;
  }, [proximityGroups]);

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
    setManualMessage(messageText);
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
        <BuildTab
          pendingOrders={filteredPending}
          totalOrders={pendingOrders.length}
          loading={pendingLoading}
          error={pendingError}
          search={search}
          onSearch={setSearch}
          partitionStrategy={partitionStrategy}
          proximityGroups={proximityGroups}
          neighborCountByOrder={neighborCountByOrder}
          onSelectProximityGroup={selectProximityGroup}
          selected={selected}
          allFilteredSelected={allFilteredSelected}
          onToggle={toggle}
          onToggleAll={toggleAllFiltered}
          onClearSelection={clearSelection}
          manualPreview={manualPreview}
          manualPreviewLoading={manualPreviewLoading}
          manualReleasing={manualReleasing}
          manualMessage={manualMessage}
          onPreview={handleManualPreview}
          onRelease={handleManualRelease}
          onReload={loadPending}
        />
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
                  <TableCell className="font-medium">{w.name}</TableCell>
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
  totalOrders: number;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (v: string) => void;
  partitionStrategy: WavePartitionStrategy;
  proximityGroups: PickProximityGroup[];
  neighborCountByOrder: Map<string, number>;
  onSelectProximityGroup: (g: PickProximityGroup) => void;
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
  totalOrders,
  loading,
  error,
  search,
  onSearch,
  partitionStrategy,
  proximityGroups,
  neighborCountByOrder,
  onSelectProximityGroup,
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
          {pendingOrders.length} pedido(s) disponível(is) (sem onda)
        </span>
      </div>

      {manualMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {manualMessage}
        </p>
      ) : null}

      {proximityGroups.length > 0 ? (
        <section className="rounded-xl border bg-slate-50 p-4">
          <h2 className="mb-2 text-sm font-semibold">
            Sugestões de proximidade
          </h2>
          <ul className="space-y-2">
            {proximityGroups.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm"
              >
                <span>
                  {g.orders.length} pedido(s) · {g.routeHint}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectProximityGroup(g)}
                  className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-slate-50"
                >
                  Selecionar grupo
                </button>
              </li>
            ))}
          </ul>
        </section>
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
                const neighbors = neighborCountByOrder.get(o.id) ?? 0;
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
                    <TableCell className="font-medium">
                      {o.erpOrderId}
                      {neighbors > 0 ? (
                        <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-normal text-teal-800">
                          Próximo de {neighbors} outro(s)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{o.customerName ?? "—"}</TableCell>
                    <TableCell>
                      <MarketplaceBadge value={o.marketplace} />
                    </TableCell>
                    <TableCell>
                      {o.collectionDeadline
                        ? new Date(o.collectionDeadline).toLocaleString(
                            "pt-BR",
                            {
                              dateStyle: "short",
                              timeStyle: "short",
                            },
                          )
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
