"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api/client";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import { fetchProducts, type ProductRow } from "@/lib/api/operations";

export default function ProdutosPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    sku: string;
    name: string;
    barcode: string;
    requiresItemScan: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProducts(q || undefined, page);
      setProducts(data.products);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await apiFetch("/api/products", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: ProductRow) => {
    await apiFetch(`/api/products/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    });
    await load();
  };

  return (
    <div>
      <PageHeader title="Produtos" description="Cadastro de SKUs e códigos de barras.">
        <button
          type="button"
          onClick={() =>
            setForm({ sku: "", name: "", barcode: "", requiresItemScan: false })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          Novo produto
        </button>
      </PageHeader>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filtrar por SKU ou nome…"
        className="mb-4 w-full max-w-md rounded-lg border bg-white px-3 py-2 text-sm"
      />

      <DataState
        loading={loading}
        error={error}
        empty={!loading && products.length === 0}
      >
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Bipar item</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-medium">{p.sku}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {p.barcode ?? "—"}
                  </TableCell>
                  <TableCell>{p.requiresItemScan ? "Sim" : "Não"}</TableCell>
                  <TableCell>{p.active ? "Ativo" : "Inativo"}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleActive(p)}
                      className="text-sm text-[#0d9488] hover:underline"
                    >
                      {p.active ? "Desativar" : "Ativar"}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pagination && pagination.total > 0 ? (
            <Pagination pagination={pagination} onPageChange={setPage} />
          ) : null}
        </div>
      </DataState>

      {form ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">Novo produto</h2>
            <div className="mt-4 space-y-3">
              <input
                placeholder="SKU"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <input
                placeholder="Nome"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                placeholder="Código de barras (opcional)"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.requiresItemScan}
                  onChange={(e) =>
                    setForm({ ...form, requiresItemScan: e.target.checked })
                  }
                />
                Exige bipagem por unidade
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
