"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  fetchLocations,
  fetchProducts,
  fetchReceipts,
} from "@/lib/api/operations";

export default function RecebimentosPage() {
  const [receipts, setReceipts] = useState<
    Awaited<ReturnType<typeof fetchReceipts>>["receipts"]
  >([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<
    Awaited<ReturnType<typeof fetchProducts>>["products"]
  >([]);
  const [locations, setLocations] = useState<
    Awaited<ReturnType<typeof fetchLocations>>["locations"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, p, l] = await Promise.all([
        fetchReceipts(page),
        fetchProducts(undefined, 1, 100),
        fetchLocations(undefined, 1, 100),
      ]);
      setReceipts(r.receipts);
      setPagination(r.pagination);
      setProducts(p.products);
      setLocations(l.locations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/receipts", {
        method: "POST",
        body: JSON.stringify({
          productId,
          toLocationId,
          quantity: Number(quantity),
          reference,
        }),
      });
      setQuantity("");
      setReference("");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <PageHeader
          title="Recebimentos"
          description="Entradas de mercadoria no armazém (beta)."
        />
        <DataState loading={loading} error={error} empty={!loading && receipts.length === 0}>
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>NF / Ref.</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Operador</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>{r.reference ?? "—"}</TableCell>
                    <TableCell>
                      <span className="font-mono">{r.product.sku}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.product.name}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.toLocation.barcode}
                    </TableCell>
                    <TableCell>{r.quantity}</TableCell>
                    <TableCell>{r.user.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pagination && pagination.total > 0 ? (
              <Pagination pagination={pagination} onPageChange={setPage} />
            ) : null}
          </div>
        </DataState>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Registrar entrada</h2>
        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl border bg-white p-5 shadow-sm"
        >
          <label className="block text-sm">
            Produto
            <select
              required
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Local destino
            <select
              required
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.barcode} ({l.corridor}-{l.row})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Quantidade
            <input
              type="number"
              min={1}
              required
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            NF / Referência
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-[#0d9488] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Confirmar recebimento"}
          </button>
        </form>
      </div>
    </div>
  );
}
