"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { OrderStatusBadge } from "@/components/ops/order-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LOCATION_TYPE_LABEL } from "@/lib/labels";
import { searchAll } from "@/lib/api/operations";

export default function PesquisaPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Awaited<
    ReturnType<typeof searchAll>
  > | null>(null);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) {
      setError("Digite ao menos 2 caracteres.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResults(await searchAll(q.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na busca");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Pesquisa rápida"
        description="Busque pedidos, produtos e localizações pelo código ou nome."
      />

      <form onSubmit={onSearch} className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SKU, pedido ERP, cliente, barcode da gôndola…"
            className="w-full rounded-lg border bg-white py-2.5 pl-10 pr-4 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-[#0d9488] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Buscar
        </button>
      </form>

      <DataState loading={loading} error={error} empty={false}>
        {results ? (
          <div className="space-y-8">
            <Section title={`Produtos (${results.products.length})`}>
              <ResultTable
                headers={["SKU", "Nome", "Barcode"]}
                rows={results.products.map((p) => [
                  p.sku,
                  p.name,
                  p.barcode ?? "—",
                ])}
              />
            </Section>
            <Section title={`Pedidos (${results.orders.length})`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ERP</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Itens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono">{o.erpOrderId}</TableCell>
                      <TableCell>{o.customerName ?? "—"}</TableCell>
                      <TableCell>
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>{o.itemCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
            <Section title={`Localizações (${results.locations.length})`}>
              <ResultTable
                headers={["Barcode", "Corredor", "Tipo", "Produto", "Qtd"]}
                rows={results.locations.map((l) => [
                  l.barcode,
                  `${l.corridor}-${l.row}`,
                  LOCATION_TYPE_LABEL[l.type] ?? l.type,
                  l.productSku ?? "—",
                  String(l.currentQuantity),
                ])}
              />
            </Section>
          </div>
        ) : null}
      </DataState>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <h2 className="border-b px-4 py-3 font-semibold">{title}</h2>
      <div className="p-2">{children}</div>
    </div>
  );
}

function ResultTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  if (rows.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-muted-foreground">
        Nenhum resultado
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => (
              <TableCell key={j}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
