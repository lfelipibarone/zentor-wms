"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileUp, Plus } from "lucide-react";
import { DataState } from "@/components/ops/data-state";
import { Pagination } from "@/components/ui/pagination";
import { WarehouseLocationEditModal } from "@/components/warehouse/warehouse-location-edit-modal";
import { WarehouseLocationsTable } from "@/components/warehouse/warehouse-locations-table";
import { WarehouseBarracaoCreateForm } from "@/components/warehouse/warehouse-barracao-create-form";
import {
  fetchBarracoesList,
  fetchWarehouseLayoutRows,
  type WarehouseBarracaoOption,
  type WarehouseLayoutListRow,
} from "@/lib/api/warehouse";
import type { LayoutRow } from "@/lib/warehouse-layout-rows";
import type { PaginationMeta } from "@/lib/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

type TipoFilter = "" | "pulmao" | "pick_face";

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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [barracaoFilter, debouncedSearch, tipoFilter]);

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
  }, [barracaoFilter, debouncedSearch, tipoFilter, page]);

  useEffect(() => {
    void loadBarracoes();
  }, [loadBarracoes]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const reload = useCallback(async () => {
    await loadRows();
  }, [loadRows]);

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

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "" as TipoFilter, label: "Todos" },
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
