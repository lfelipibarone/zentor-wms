"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { DataState } from "@/components/ops/data-state";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchPackingWaveOverview, type PackingWaveOverview } from "@/lib/api/operations";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type WaveLine = PackingWaveOverview["lines"][number];

function lineState(line: WaveLine) {
  if (line.sortStatus === "SORTED") {
    return { label: "Distribuído", className: "bg-emerald-100 text-emerald-800", ready: false };
  }
  if (line.quantityPicked <= 0) {
    return { label: "Aguardando coleta", className: "bg-slate-100 text-slate-600", ready: false };
  }
  if (line.quantityPicked < line.quantityTotal) {
    return { label: "Coleta parcial", className: "bg-amber-100 text-amber-800", ready: true };
  }
  return { label: "Pronto p/ distribuir", className: "bg-amber-200 text-amber-900", ready: true };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default function PackingWaveOverviewPage() {
  const router = useRouter();
  const { waveId } = useParams<{ waveId: string }>();
  const [data, setData] = useState<PackingWaveOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPackingWaveOverview(waveId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar onda");
    } finally {
      setLoading(false);
    }
  }, [waveId]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = data?.lines ?? [];
  const orders = data?.orders ?? [];
  const unitsTotal = lines.reduce((s, l) => s + l.quantityTotal, 0);
  const unitsPicked = lines.reduce((s, l) => s + l.quantityPicked, 0);
  const unitsSorted = lines.reduce((s, l) => s + l.quantitySorted, 0);
  const linesPicked = lines.filter((l) => l.quantityPicked >= l.quantityTotal).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader
          title={data?.wave.name ?? "Onda"}
          description="Onda de picking completa: o que já foi coletado, o que falta e a distribuição nas cestas dos pedidos."
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
          <Link href="/packing" className="rounded-lg border bg-white px-3 py-2 text-sm font-medium">
            Voltar
          </Link>
        </div>
      </div>

      <DataState loading={loading && !data} error={error} empty={false}>
        {data ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <CollectionDeadlineIndicator deadline={data.wave.collectionDeadline} />
              {data.wave.acceptedByName ? <span>Separador: {data.wave.acceptedByName}</span> : null}
              {data.wave.status !== "RELEASED" ? (
                <span className="font-medium text-slate-700">Onda encerrada</span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Pedidos" value={String(orders.length)} />
              <Stat label="Itens coletados" value={`${linesPicked}/${lines.length}`} />
              <Stat label="Unidades coletadas" value={`${unitsPicked}/${unitsTotal}`} />
              <Stat label="Unidades nas cestas" value={`${unitsSorted}/${unitsTotal}`} />
            </div>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-800">Itens da onda ({lines.length})</h2>
              <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Gôndola</TableHead>
                      <TableHead className="text-right">Coletado</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Nas cestas</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => {
                      const state = lineState(line);
                      return (
                        <TableRow key={line.id}>
                          <TableCell>
                            <span className="font-mono text-sm font-medium">{line.sku}</span>
                            <span className="block max-w-[200px] truncate text-xs text-muted-foreground">
                              {line.productName}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{line.routeLabel}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {line.quantityPicked}/{line.quantityTotal}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {line.quantitySorted}/{line.quantityTotal}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
                                state.className,
                              )}
                            >
                              {state.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {state.ready && data.wave.status === "RELEASED" ? (
                              <button
                                type="button"
                                onClick={() => router.push(`/packing/waves/${line.id}`)}
                                className="rounded-lg bg-[#0d9488] px-3 py-1.5 text-xs font-semibold text-white"
                              >
                                Distribuir
                              </button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-800">Pedidos da onda ({orders.length})</h2>
              <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Marketplace</TableHead>
                      <TableHead>Cesta</TableHead>
                      <TableHead className="text-right">Unidades nas cestas</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <span className="font-mono text-sm font-medium">{o.erpOrderId}</span>
                          {o.customerName ? (
                            <span className="block text-xs text-muted-foreground">{o.customerName}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <MarketplaceBadge value={o.marketplace} />
                        </TableCell>
                        <TableCell className="font-mono text-sm">{o.basketCode ?? "—"}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            o.unitsTotal > 0 && o.unitsSorted >= o.unitsTotal && "font-semibold text-emerald-700",
                          )}
                        >
                          {o.unitsSorted}/{o.unitsTotal}
                        </TableCell>
                        <TableCell className="text-sm">
                          {ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
