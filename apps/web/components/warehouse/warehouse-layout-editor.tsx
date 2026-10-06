"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Columns3,
  FileSpreadsheet,
  FileUp,
  LayoutGrid,
  List,
  Map as MapIcon,
  Plus,
} from "lucide-react";
import { DataState } from "@/components/ops/data-state";
import { Pagination } from "@/components/ui/pagination";
import { WarehouseLocationEditModal } from "@/components/warehouse/warehouse-location-edit-modal";
import { WarehouseLocationsTable } from "@/components/warehouse/warehouse-locations-table";
import { WarehouseBarracaoCreateForm } from "@/components/warehouse/warehouse-barracao-create-form";
import {
  FACE_LABEL,
  WarehouseEstanteGrid,
} from "@/components/warehouse/warehouse-estante-grid";
import {
  fetchBarracoesList,
  fetchWarehouseEstanteRows,
  fetchWarehouseLayoutEstantes,
  fetchWarehouseLayoutRows,
  type LayoutSituacao,
  type LocationFace,
  type WarehouseBarracaoOption,
  type WarehouseLayoutEstante,
  type WarehouseLayoutListRow,
} from "@/lib/api/warehouse";
import type { LayoutRow } from "@/lib/warehouse-layout-rows";
import type { PaginationMeta } from "@/lib/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

type TipoFilter = "" | "pulmao" | "pick_face";
type ViewMode = "lista" | "estante";

const SITUACOES: Array<{ id: LayoutSituacao | ""; label: string }> = [
  { id: "", label: "Todas" },
  { id: "com_sku", label: "Com SKU" },
  { id: "sem_sku", label: "Sem SKU" },
  { id: "vazia", label: "Vazias (0%)" },
  { id: "abaixo_min", label: "Abaixo do mínimo" },
  { id: "inativa", label: "Inativas" },
];

function situacaoCount(
  id: LayoutSituacao | "",
  totals: Pick<WarehouseLayoutEstante, "total" | "semSku" | "vazia" | "abaixoMin" | "inativa">,
) {
  switch (id) {
    case "":
      return totals.total;
    case "com_sku":
      return totals.total - totals.semSku;
    case "sem_sku":
      return totals.semSku;
    case "vazia":
      return totals.vazia;
    case "abaixo_min":
      return totals.abaixoMin;
    case "inativa":
      return totals.inativa;
  }
}

const selectClass = "rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50";

function toLayoutRow(row: WarehouseLayoutListRow): LayoutRow {
  return {
    ...row,
    siblingGroupKey: `coluna:${row.colunaId ?? row.id}`,
    segment: "linhas",
  };
}

export function WarehouseLayoutEditor() {
  const [barracoes, setBarracoes] = useState<WarehouseBarracaoOption[]>([]);
  const [rows, setRows] = useState<LayoutRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<LayoutRow | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [barracaoFilter, setBarracaoFilter] = useState("");
  const [tipoFilter, setTipoFilter] = useState<TipoFilter>("");
  const [showNewBarracao, setShowNewBarracao] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("lista");
  const [estantes, setEstantes] = useState<WarehouseLayoutEstante[]>([]);
  const [estanteFilter, setEstanteFilter] = useState("");
  const [colunaFilter, setColunaFilter] = useState("");
  const [faceFilter, setFaceFilter] = useState<LocationFace | "">("");
  const [situacaoFilter, setSituacaoFilter] = useState<LayoutSituacao | "">("");
  const [estanteRows, setEstanteRows] = useState<LayoutRow[]>([]);
  const [estanteLoading, setEstanteLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [
    barracaoFilter,
    debouncedSearch,
    tipoFilter,
    estanteFilter,
    colunaFilter,
    faceFilter,
    situacaoFilter,
  ]);

  useEffect(() => {
    setEstanteFilter("");
    setColunaFilter("");
  }, [barracaoFilter]);

  useEffect(() => {
    setColunaFilter("");
  }, [estanteFilter]);

  const loadEstantes = useCallback(async () => {
    if (!barracaoFilter) {
      setEstantes([]);
      return;
    }
    try {
      const { estantes: data } = await fetchWarehouseLayoutEstantes(barracaoFilter);
      setEstantes(data);
    } catch {
      setEstantes([]);
    }
  }, [barracaoFilter]);

  useEffect(() => {
    void loadEstantes();
  }, [loadEstantes]);

  useEffect(() => {
    if (viewMode === "estante" && !estanteFilter && estantes[0]) {
      setEstanteFilter(estantes[0].id);
    }
  }, [viewMode, estanteFilter, estantes]);

  const loadEstanteRows = useCallback(async () => {
    if (viewMode !== "estante" || !estanteFilter) {
      setEstanteRows([]);
      return;
    }
    setEstanteLoading(true);
    try {
      const { rows: data } = await fetchWarehouseEstanteRows(estanteFilter);
      setEstanteRows(data.map(toLayoutRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar estante");
      setEstanteRows([]);
    } finally {
      setEstanteLoading(false);
    }
  }, [viewMode, estanteFilter]);

  useEffect(() => {
    void loadEstanteRows();
  }, [loadEstanteRows]);

  const loadBarracoes = useCallback(async () => {
    try {
      const { barracoes: data } = await fetchBarracoesList();
      setBarracoes(data);
      setBarracaoFilter((prev) => prev || data[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar barracões");
      setBarracoes([]);
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (viewMode !== "lista") {
      setLoading(false);
      return;
    }
    if (!barracaoFilter) {
      setRows([]);
      setPagination(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWarehouseLayoutRows({
        barracaoId: barracaoFilter,
        q: debouncedSearch,
        tipo: tipoFilter || undefined,
        estanteId: estanteFilter || undefined,
        colunaId: colunaFilter || undefined,
        face: faceFilter || undefined,
        situacao: situacaoFilter || undefined,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      setRows(data.rows.map(toLayoutRow));
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar layout");
      setRows([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [
    viewMode,
    barracaoFilter,
    debouncedSearch,
    tipoFilter,
    estanteFilter,
    colunaFilter,
    faceFilter,
    situacaoFilter,
    page,
  ]);

  useEffect(() => {
    void loadBarracoes();
  }, [loadBarracoes]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const reload = useCallback(async () => {
    await Promise.all([loadRows(), loadEstantes(), loadEstanteRows()]);
  }, [loadRows, loadEstantes, loadEstanteRows]);

  const selectedEstante = estantes.find((e) => e.id === estanteFilter) ?? null;

  const situacaoTotals = useMemo(() => {
    if (selectedEstante) return selectedEstante;
    return estantes.reduce(
      (acc, e) => ({
        total: acc.total + e.total,
        semSku: acc.semSku + e.semSku,
        vazia: acc.vazia + e.vazia,
        abaixoMin: acc.abaixoMin + e.abaixoMin,
        inativa: acc.inativa + e.inativa,
      }),
      { total: 0, semSku: 0, vazia: 0, abaixoMin: 0, inativa: 0 },
    );
  }, [estantes, selectedEstante]);

  const availableFaces = useMemo(() => {
    const source = selectedEstante ? [selectedEstante] : estantes;
    return (["A", "B"] as const).filter((f) => source.some((e) => e.faces.includes(f)));
  }, [estantes, selectedEstante]);

  const gridRows = useMemo(
    () =>
      estanteRows.filter((r) => {
        if (tipoFilter === "pulmao") return r.location?.type === "PULMAO";
        if (tipoFilter === "pick_face") return r.location?.type !== "PULMAO";
        return true;
      }),
    [estanteRows, tipoFilter],
  );

  const hasExtraFilters =
    (viewMode === "lista" && !!estanteFilter) ||
    !!colunaFilter ||
    !!faceFilter ||
    !!situacaoFilter ||
    !!tipoFilter;

  const clearFilters = () => {
    setTipoFilter("");
    setColunaFilter("");
    setFaceFilter("");
    setSituacaoFilter("");
    if (viewMode === "lista") setEstanteFilter("");
  };

  const barracaoOptions = useMemo(
    () =>
      barracoes.map((b) => ({
        id: b.id,
        label: `${b.code}${b.name ? ` — ${b.name}` : ""}`,
      })),
    [barracoes],
  );

  const novoHref = barracaoFilter
    ? `/gestao-barracao/novo?barracaoId=${encodeURIComponent(barracaoFilter)}`
    : "/gestao-barracao/novo";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <input
          type="search"
          placeholder="Buscar código, SKU, barcode, endereço…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <Link
          href="/gestao-barracao/importar"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          <FileUp className="h-4 w-4" /> Importar
        </Link>
        <Link
          href="/gestao-barracao/inventario"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          <FileSpreadsheet className="h-4 w-4" /> Planilha de inventário
        </Link>
        <Link
          href={
            barracaoFilter
              ? `/gestao-barracao/mapa?barracaoId=${encodeURIComponent(barracaoFilter)}`
              : "/gestao-barracao/mapa"
          }
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          <MapIcon className="h-4 w-4" /> Mapa do galpão
        </Link>
        <Link
          href={
            barracaoFilter
              ? `/gestao-barracao/lote?barracaoId=${encodeURIComponent(barracaoFilter)}`
              : "/gestao-barracao/lote"
          }
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          <LayoutGrid className="h-4 w-4" /> Gerar estante
        </Link>
        <Link
          href={novoHref}
          className="inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Nova localização
        </Link>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700">Barracão</p>
          <button
            type="button"
            onClick={() => setShowNewBarracao((v) => !v)}
            className="text-sm font-medium text-[#0d9488] underline"
          >
            {showNewBarracao ? "Fechar cadastro" : "+ Novo barracão"}
          </button>
        </div>
        {showNewBarracao ? (
          <WarehouseBarracaoCreateForm
            compact
            onCancel={() => setShowNewBarracao(false)}
            onCreated={async (b) => {
              await loadBarracoes();
              setBarracaoFilter(b.id);
              setShowNewBarracao(false);
            }}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {barracaoOptions.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBarracaoFilter(b.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                barracaoFilter === b.id
                  ? "bg-slate-700 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: "lista" as ViewMode, label: "Lista", Icon: List },
                { id: "estante" as ViewMode, label: "Por estante", Icon: Columns3 },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                  viewMode === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "" as TipoFilter, label: "Todos os tipos" },
                { id: "pulmao" as TipoFilter, label: "Pulmão" },
                { id: "pick_face" as TipoFilter, label: "Estoque de giro" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id || "all"}
                type="button"
                onClick={() => setTipoFilter(opt.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tipoFilter === opt.id
                    ? "bg-[#0d9488] text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {estantes.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Estante
            </p>
            <div className="flex flex-wrap gap-1.5">
              {viewMode === "lista" ? (
                <button
                  type="button"
                  onClick={() => setEstanteFilter("")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    !estanteFilter ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Todas
                </button>
              ) : null}
              {estantes.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEstanteFilter(e.id)}
                  title={`${e.total} posições · ${e.semSku} sem SKU · ${e.abaixoMin} abaixo do mínimo`}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-sm font-medium ${
                    estanteFilter === e.id
                      ? "bg-slate-700 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {e.label}
                  {e.abaixoMin > 0 ? (
                    <span className="rounded-full bg-amber-400 px-1.5 font-sans text-[11px] font-bold text-amber-950">
                      {e.abaixoMin}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Coluna"
            value={colunaFilter}
            disabled={!selectedEstante}
            onChange={(e) => setColunaFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">
              {selectedEstante ? "Todas as colunas" : "Coluna (escolha a estante)"}
            </option>
            {selectedEstante?.colunas.map((c) => (
              <option key={c.id} value={c.id}>
                Coluna {c.code}
              </option>
            ))}
          </select>
          {availableFaces.length > 1 ? (
            <select
              aria-label="Lado"
              value={faceFilter}
              onChange={(e) => setFaceFilter(e.target.value as LocationFace | "")}
              className={selectClass}
            >
              <option value="">Os dois lados</option>
              {availableFaces.map((f) => (
                <option key={f} value={f}>
                  {f === "A" ? "Lado direito" : "Lado esquerdo"} ({FACE_LABEL[f]})
                </option>
              ))}
            </select>
          ) : null}
          {hasExtraFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-medium text-[#0d9488] underline"
            >
              Limpar filtros
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SITUACOES.map((opt) => {
            const count = situacaoCount(opt.id, situacaoTotals);
            return (
              <button
                key={opt.id || "all"}
                type="button"
                onClick={() => setSituacaoFilter(opt.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${
                  situacaoFilter === opt.id
                    ? "border-[#0d9488] bg-teal-50 text-[#0d9488]"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {opt.label}
                <span className="tabular-nums text-xs text-slate-500">{count}</span>
              </button>
            );
          })}
        </div>
        {viewMode === "estante" && (situacaoFilter || debouncedSearch.trim()) ? (
          <p className="text-xs text-slate-500">
            Na visão por estante, as posições fora do filtro ficam apagadas para manter o
            desenho da estante.
          </p>
        ) : null}
      </div>

      <DataState
        loading={loading && barracoes.length === 0}
        error={error}
        empty={barracoes.length === 0}
      >
        {barracoes.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-slate-50 p-8 text-center text-slate-600">
            <p className="font-medium">Nenhum barracão cadastrado</p>
            <p className="mt-1 text-sm">
              Use <strong>+ Novo barracão</strong> acima e depois cadastre
              localizações.
            </p>
          </div>
        ) : viewMode === "estante" ? (
          estanteLoading && estanteRows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
              Carregando estante…
            </p>
          ) : (
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              {selectedEstante ? (
                <p className="mb-3 text-sm text-slate-600">
                  <span className="font-mono font-semibold text-slate-900">
                    Estante {selectedEstante.label}
                  </span>{" "}
                  · {selectedEstante.colunas.length} colunas · {selectedEstante.total} posições
                  {selectedEstante.semSku > 0 ? ` · ${selectedEstante.semSku} sem SKU` : ""}
                  {selectedEstante.abaixoMin > 0
                    ? ` · ${selectedEstante.abaixoMin} abaixo do mínimo`
                    : ""}
                </p>
              ) : null}
              <WarehouseEstanteGrid
                rows={gridRows}
                face={faceFilter}
                colunaId={colunaFilter}
                situacao={situacaoFilter}
                search={debouncedSearch}
                onEdit={setEditRow}
              />
            </div>
          )
        ) : (
          <div className="space-y-0">
            {loading ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
                Carregando localizações…
              </p>
            ) : rows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
                Nenhum resultado
                {debouncedSearch.trim() ? ` para "${debouncedSearch}"` : ""}.
              </p>
            ) : (
              <WarehouseLocationsTable rows={rows} onEdit={setEditRow} />
            )}
            {pagination && pagination.total > 0 ? (
              <Pagination pagination={pagination} onPageChange={setPage} />
            ) : null}
          </div>
        )}
      </DataState>

      {editRow ? (
        <WarehouseLocationEditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={async () => {
            setEditRow(null);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}
