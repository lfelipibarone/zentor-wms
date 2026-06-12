"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { DataState } from "@/components/ops/data-state";
import { UnifiedWarehouseAddModal } from "@/components/warehouse/unified-warehouse-add-modal";
import {
  fetchFullWarehouseTree,
  type WarehouseTree,
} from "@/lib/api/warehouse";

export function WarehouseLayoutEditor() {
  const [trees, setTrees] = useState<WarehouseTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { trees: data } = await fetchFullWarehouseTree();
      setTrees(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar layout");
      setTrees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const filteredTrees = q
    ? trees.filter((b) => matchesTree(b, q))
    : trees;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <input
          type="search"
          placeholder="Buscar em todo o layout (código, nome)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Novo
        </button>
      </div>

      <DataState loading={loading} error={error} empty={trees.length === 0}>
        {trees.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-slate-50 p-8 text-center text-slate-600">
            <p className="font-medium">Layout vazio</p>
            <p className="mt-1 text-sm">
              Clique em <strong>Novo</strong>, escolha o tipo (Barracão, Setor, Corredor…) e
              cadastre.
            </p>
          </div>
        ) : filteredTrees.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
            Nenhum resultado para &quot;{search}&quot;.
          </p>
        ) : (
          <div className="space-y-6">
            {filteredTrees.map((barracao) => (
              <BarracaoCard key={barracao.id} barracao={barracao} />
            ))}
          </div>
        )}
      </DataState>

      {addOpen ? (
        <UnifiedWarehouseAddModal
          trees={trees}
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function matchesTree(b: WarehouseTree, q: string): boolean {
  if (b.code.toLowerCase().includes(q)) return true;
  if (b.name?.toLowerCase().includes(q)) return true;
  return b.setores.some(
    (s) =>
      s.code.toLowerCase().includes(q) ||
      s.name?.toLowerCase().includes(q) ||
      s.corredores.some(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.fileiras.some((f) => f.code.toLowerCase().includes(q)),
      ) ||
      s.estantes.some(
        (e) =>
          e.code.toLowerCase().includes(q) ||
          e.prateleiras.some(
            (p) =>
              p.code.toLowerCase().includes(q) ||
              p.colunas.some((col) => col.code.toLowerCase().includes(q)),
          ),
      ),
  );
}

function BarracaoCard({ barracao }: { barracao: WarehouseTree }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b bg-[#0d9488]/10 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[#0d9488]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[#0d9488]" />
        )}
        <span className="font-semibold text-slate-800">
          Barracão <span className="font-mono text-[#0d9488]">{barracao.code}</span>
        </span>
        {barracao.name ? (
          <span className="text-sm text-slate-500">— {barracao.name}</span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          ordem {barracao.pickOrder} · {barracao.setores.length} setor(es)
        </span>
      </button>

      {open ? (
        <div className="space-y-3 p-4">
          {barracao.setores.length === 0 ? (
            <p className="text-sm text-slate-400">
              Sem setores — use <strong>Novo</strong> → Setor.
            </p>
          ) : (
            barracao.setores.map((setor) => (
              <SetorCard key={setor.id} setor={setor} />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function SetorCard({ setor }: { setor: WarehouseTree["setores"][number] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left text-sm"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        )}
        <span className="font-medium">
          Setor <span className="font-mono">{setor.code}</span>
        </span>
        {setor.name ? <span className="text-slate-500">— {setor.name}</span> : null}
        <span className="ml-auto text-xs text-slate-400">#{setor.pickOrder}</span>
      </button>

      {open ? (
        <div className="grid gap-3 p-3 lg:grid-cols-2">
          <LayoutSection
            title="Circulação"
            subtitle="corredor → fileira"
            empty="Sem corredores"
            items={setor.corredores.map((c) => ({
              id: c.id,
              code: c.code,
              order: c.pickOrder,
              children: c.fileiras.map((f) => ({
                id: f.id,
                code: f.code,
                order: f.pickOrder,
              })),
            }))}
          />
          <LayoutSection
            title="Posição"
            subtitle="estante → prateleira → coluna"
            empty="Sem estantes"
            items={setor.estantes.map((e) => ({
              id: e.id,
              code: e.code,
              order: e.pickOrder,
              children: e.prateleiras.map((p) => ({
                id: p.id,
                code: p.code,
                order: p.pickOrder,
                children: p.colunas.map((col) => ({
                  id: col.id,
                  code: col.code,
                  order: col.pickOrder,
                })),
              })),
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

function LayoutSection({
  title,
  subtitle,
  empty,
  items,
}: {
  title: string;
  subtitle: string;
  empty: string;
  items: Array<{
    id: string;
    code: string;
    order: number;
    children?: Array<{
      id: string;
      code: string;
      order: number;
      children?: Array<{ id: string; code: string; order: number }>;
    }>;
  }>;
}) {
  if (items.length === 0) {
    return (
      <section>
        <h4 className="text-xs font-semibold text-slate-600">
          {title} · {subtitle}
        </h4>
        <p className="mt-1 text-xs text-slate-400">{empty}</p>
      </section>
    );
  }

  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold text-slate-600">
        {title} · {subtitle}
      </h4>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border bg-slate-50/80 p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium">{item.code}</span>
              <span className="text-[10px] text-slate-400">#{item.order}</span>
            </div>
            {item.children && item.children.length > 0 ? (
              <ul className="mt-1.5 space-y-1 border-l-2 border-teal-100 pl-2">
                {item.children.map((child) => (
                  <li key={child.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{child.code}</span>
                      <span className="text-[10px] text-slate-400">#{child.order}</span>
                    </div>
                    {child.children && child.children.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {child.children.map((gc) => (
                          <Chip key={gc.id} code={gc.code} order={gc.order} small />
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-slate-400">—</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chip({
  code,
  order,
  small,
}: {
  code: string;
  order: number;
  small?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 font-mono text-slate-700 ring-1 ring-slate-200 ${
        small ? "text-[10px]" : "text-xs"
      }`}
    >
      {code}
      <span className="text-[9px] text-slate-400">#{order}</span>
    </span>
  );
}
