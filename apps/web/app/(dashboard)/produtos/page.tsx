"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { LocationChip } from "@/components/products/location-chip";
import type { PaginationMeta } from "@/lib/pagination";
import {
  fetchProducts,
  type ProductListItem,
  type ProductMissingFilter,
} from "@/lib/api/products";
import { cn } from "@/lib/utils";

const FILTERS: { value: ProductMissingFilter | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "location", label: "Sem posição" },
  { value: "image", label: "Sem foto" },
  { value: "barcode", label: "Sem EAN" },
];

export default function ProdutosPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [missing, setMissing] = useState<ProductMissingFilter | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, missing]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProducts({
        q: search || undefined,
        missing: missing || undefined,
        page,
      });
      setProducts(data.products);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [search, missing, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos"
        description="Dados, QR code, fotos e posições de cada SKU. Por padrão, o QR da etiqueta é o próprio SKU."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-[240px] flex-1">
          <label className="text-xs font-medium text-muted-foreground">Pesquisar</label>
          <input
            type="search"
            placeholder="SKU, nome, EAN ou QR…"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              type="button"
              onClick={() => setMissing(f.value)}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium",
                missing === f.value
                  ? "bg-[#0d9488] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={!loading && products.length === 0}
        emptyMessage="Nenhum produto encontrado."
      >
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Foto</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>EAN</TableHead>
                <TableHead>Posições</TableHead>
                <TableHead className="text-right">Estoque WMS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => router.push(`/produtos/${p.id}`)}
                >
                  <TableCell>
                    <div className="relative h-12 w-12 overflow-hidden rounded-md bg-slate-100">
                      {p.imageUrl ? (
                        <Image
                          src={p.imageUrl}
                          alt={p.name}
                          fill
                          className="object-contain"
                          sizes="48px"
                          unoptimized
                        />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono font-semibold">{p.sku}</TableCell>
                  <TableCell>
                    <p className="line-clamp-2 max-w-md">{p.name}</p>
                    {!p.active ? (
                      <Badge variant="secondary" className="mt-1">
                        Inativo
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-sm">{p.barcode ?? "—"}</TableCell>
                  <TableCell>
                    {p.locations.length ? (
                      <div className="flex flex-wrap gap-1">
                        {p.locations.map((l) => (
                          <LocationChip
                            key={l.id}
                            barcode={l.barcode}
                            type={l.type}
                            quantity={l.currentQuantity}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-amber-700">Sem posição</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.locations.reduce((s, l) => s + l.currentQuantity, 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {pagination && pagination.total > 0 ? (
          <Pagination pagination={pagination} onPageChange={setPage} />
        ) : null}
      </DataState>
    </div>
  );
}
