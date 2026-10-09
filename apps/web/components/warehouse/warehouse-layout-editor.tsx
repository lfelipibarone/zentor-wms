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
  Search,
  Warehouse,
  X,
} from "lucide-react";
import { DataState } from "@/components/ops/data-state";
import { PageHeader } from "@/components/ops/page-header";
import {
  EstantePicker,
  MenuDropdown,
  Segmented,
  SelectDropdown,
} from "@/components/warehouse/layout-filter-controls";
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

  const colunaOptions = useMemo(
    () => (selectedEstante?.colunas ?? []).map((c) => ({ id: c.id, label: c.code })),
    [selectedEstante],
  );

  const withBarracao = (path: string) =>
    barracaoFilter ? `${path}?barracaoId=${encodeURIComponent(barracaoFilter)}` : path;

  return (
    <div className="space-y-4">
      <PageHeader title="Layout do galpão">
        <div className="flex flex-wrap items-center gap-2">
          <MenuDropdown
            label="Mais"
            items={[
              {
                id: "importar",
                label: "Importar planilha",
                icon: <FileUp className="h-4 w-4" />,
                href: "/gestao-barracao/importar",
              },
              {
                id: "inventario",
                label: "Planilha de inventário",
                icon: <FileSpreadsheet className="h-4 w-4" />,
                href: "/gestao-barracao/inventario",
              },
              {
                id: "lote",
                label: "Gerar estante",
                icon: <LayoutGrid className="h-4 w-4" />,
                href: withBarracao("/gestao-barracao/lote"),
              },
              {
                id: "barracao",
                label: "Novo barracão",
                icon: <Warehouse className="h-4 w-4" />,
                onClick: () => setShowNewBarracao(true),
              },
            ]}
          />
          <Link
            href={withBarracao("/gestao-barracao/mapa")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
          >
            <MapIcon className="h-4 w-4" /> Mapa do galpão
          </Link>
          <Link
            href={withBarracao("/gestao-barracao/novo")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0d9488] px-3 text-sm font-semibold text-white hover:bg-[#0f766e]"
          >
            <Plus className="h-4 w-4" /> Nova localização
          </Link>
        </div>
      </PageHeader>

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

      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {barracaoOptions.length > 0 ? (
            <SelectDropdown
              label="Barracão"
              value={barracaoFilter}
              options={barracaoOptions}
              onChange={setBarracaoFilter}
              allowEmpty={false}
            />
          ) : null}
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar código, SKU, produto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d9488]"
            />
          </div>
          <Segmented<ViewMode>
            value={viewMode}
            onChange={setViewMode}
            options={[
              {
                id: "lista",
                label: (
                  <>
                    <List className="h-4 w-4" /> Lista
                  </>
                ),
              },
              {
                id: "estante",
                label: (
                  <>
                    <Columns3 className="h-4 w-4" /> Por estante
                  </>
                ),
              },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 p-3">
          {estantes.length > 0 ? (
            <EstantePicker
              estantes={estantes}
              value={estanteFilter}
              onChange={setEstanteFilter}
              allowAll={viewMode === "lista"}
            />
          ) : null}
          {selectedEstante ? (
            <SelectDropdown
              label="Coluna"
              value={colunaFilter}
              options={colunaOptions}
              onChange={setColunaFilter}
            />
          ) : null}
          {availableFaces.length > 1 ? (
            <Segmented<LocationFace | "">
              value={faceFilter}
              onChange={setFaceFilter}
              options={[
                { id: "", label: "Ambos os lados" },
                { id: "A", label: FACE_LABEL.A, title: "Lado direito" },
                { id: "B", label: FACE_LABEL.B, title: "Lado esquerdo" },
              ]}
            />
          ) : null}
          <Segmented<TipoFilter>
            value={tipoFilter}
            onChange={setTipoFilter}
            options={[
              { id: "", label: "Todos os tipos" },
              { id: "pulmao", label: "Pulmão" },
              { id: "pick_face", label: "Giro" },
            ]}
          />
          {hasExtraFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-slate-500 hover:text-slate-900"
            >
              <X className="h-4 w-4" /> Limpar
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-b-xl border-t bg-slate-50/70 px-3 py-2.5">
          {SITUACOES.map((opt) => {
            const count = situacaoCount(opt.id, situacaoTotals);
            const active = situacaoFilter === opt.id;
            const warn = opt.id === "abaixo_min" && count > 0;
            return (
              <button
                key={opt.id || "all"}
                type="button"
                onClick={() => setSituacaoFilter(opt.id)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition ${
                  active
                    ? "border-[#0d9488] bg-[#0d9488] text-white"
                    : warn
                      ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {opt.label}
                <span
                  className={`tabular-nums text-xs ${active ? "text-white/80" : "text-slate-400"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
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
