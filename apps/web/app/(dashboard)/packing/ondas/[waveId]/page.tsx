"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Printer, RefreshCw, Tags } from "lucide-react";
import type { ShippingLabelApiResult } from "@/components/ops/shipping-label-panel";
import { apiFetch } from "@/lib/api/client";
import { fetchShippingLabelText, triggerBlobDownload } from "@/lib/shipping-label-file";
import { printZplWithQz } from "@/lib/shipping-label-qz";
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

function lineState(line: WaveLine, pickFinished: boolean) {
  if (line.sortStatus === "SORTED") {
    return { label: "Conferido", className: "bg-emerald-100 text-emerald-800", ready: false };
  }
  if (!pickFinished) {
    return line.quantityPicked >= line.quantityTotal
      ? { label: "Coletado", className: "bg-sky-100 text-sky-800", ready: false }
      : line.quantityPicked > 0
        ? { label: "Coleta parcial", className: "bg-amber-100 text-amber-800", ready: false }
        : { label: "Aguardando coleta", className: "bg-slate-100 text-slate-600", ready: false };
  }
  if (line.quantityPicked < line.quantityTotal) {
    // Packing devolveu um pedido ao separador: os demais seguem conferindo.
    return {
      label: "Recoleta pedida",
      className: "bg-red-100 text-red-800",
      ready: line.quantityPicked > line.quantitySorted,
    };
  }
  return { label: "Pronto p/ conferir", className: "bg-amber-200 text-amber-900", ready: true };
}

function LabelStatus({
  hasLabel,
  format,
  error,
}: {
  hasLabel: boolean;
  format: PackingWaveOverview["orders"][number]["labelFormat"];
  error?: string;
}) {
  const badge = "whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium";
  if (error) {
    return (
      <div className="max-w-[220px]">
        <span className={cn(badge, "bg-red-100 text-red-700")}>
          {hasLabel ? "Falha ao baixar" : "Falha ao gerar"}
        </span>
        <p className="mt-1 text-xs text-red-700">{error}</p>
      </div>
    );
  }
  if (hasLabel) {
    return (
      <span className={cn(badge, "bg-emerald-100 text-emerald-800")}>
        Gerada{format === "pdf" ? " · PDF" : ""}
      </span>
    );
  }
  return <span className={cn(badge, "bg-slate-100 text-slate-600")}>Falta gerar</span>;
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

  const [labelErrors, setLabelErrors] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<{ done: number; total: number } | null>(null);
  const [printing, setPrinting] = useState(false);
  const [labelMessage, setLabelMessage] = useState<string | null>(null);

  const lines = data?.lines ?? [];
  const orders = data?.orders ?? [];
  const missingLabels = orders.filter((o) => !o.hasLabel);
  const printableLabels = orders.filter((o) => o.hasLabel && o.labelFormat !== "pdf");
  const pdfLabels = orders.filter((o) => o.hasLabel && o.labelFormat === "pdf");
  const labelBusy = generating !== null || printing;

  const openOrderConference = async (orderId: string) => {
    try {
      await apiFetch(`/api/packing/orders/${orderId}/start`, { method: "POST", body: "{}" });
      router.push(`/packing/${orderId}`);
    } catch (e) {
      setLabelMessage(e instanceof Error ? e.message : "Não foi possível abrir o pedido");
    }
  };

  const generateAll = async () => {
    if (missingLabels.length === 0) return;
    if (!window.confirm(`Gerar a etiqueta de ${missingLabels.length} pedido(s) no Tiny?`)) return;
    setLabelMessage(null);
    const errors: Record<string, string> = {};
    let ok = 0;
    for (const [i, order] of missingLabels.entries()) {
      setGenerating({ done: i, total: missingLabels.length });
      try {
        const result = await apiFetch<ShippingLabelApiResult>(
          `/api/packing/orders/${order.id}/shipping-labels`,
          { method: "POST", body: "{}" },
        );
        if (result.status === "OK" && result.urls.length > 0) ok++;
        else errors[order.id] = result.message ?? "Etiqueta indisponível";
      } catch (e) {
        errors[order.id] = e instanceof Error ? e.message : "Erro ao gerar etiqueta";
      }
    }
    setGenerating(null);
    setLabelErrors(errors);
    const failed = Object.keys(errors).length;
    setLabelMessage(
      `${ok} etiqueta(s) gerada(s)${failed ? ` · ${failed} com erro (veja a coluna Etiqueta)` : ""}.`,
    );
    await load();
  };

  const printAll = async () => {
    if (printableLabels.length === 0) return;
    setPrinting(true);
    setLabelMessage(null);
    const zpls: string[] = [];
    const errors: Record<string, string> = {};
    for (const order of printableLabels) {
      try {
        zpls.push((await fetchShippingLabelText(order.id)).trim());
      } catch (e) {
        errors[order.id] = e instanceof Error ? e.message : "Erro ao baixar etiqueta";
      }
    }
    setLabelErrors((prev) => {
      const next = { ...prev };
      for (const order of printableLabels) delete next[order.id];
      return { ...next, ...errors };
    });
    const notes: string[] = [];
    if (Object.keys(errors).length) notes.push(`${Object.keys(errors).length} não baixaram`);
    if (pdfLabels.length) notes.push(`${pdfLabels.length} em PDF ficaram de fora (imprima pela conferência)`);
    const suffix = notes.length ? ` · ${notes.join(" · ")}` : "";

    if (zpls.length > 0) {
      const combined = zpls.join("\n");
      try {
        const { printer } = await printZplWithQz(combined);
        setLabelMessage(`${zpls.length} etiqueta(s) enviada(s) para ${printer}${suffix}.`);
      } catch (e) {
        const safeName = (data?.wave.name ?? "onda").replace(/[^\w.-]+/g, "_");
        triggerBlobDownload(new Blob([combined], { type: "text/plain" }), `etiquetas-${safeName}.zpl`);
        const raw = e instanceof Error ? e.message : "";
        const reason = /connection|websocket/i.test(raw) || !raw ? "QZ Tray não está aberto neste computador" : raw;
        setLabelMessage(
          `Não deu para imprimir direto (${reason}). Baixei um arquivo com as ${zpls.length} etiqueta(s)${suffix}.`,
        );
      }
    } else {
      setLabelMessage(`Nenhuma etiqueta para imprimir${suffix}.`);
    }
    setPrinting(false);
  };
  const unitsTotal = lines.reduce((s, l) => s + l.quantityTotal, 0);
  const unitsPicked = lines.reduce((s, l) => s + l.quantityPicked, 0);
  const unitsSorted = lines.reduce((s, l) => s + l.quantitySorted, 0);
  const linesPicked = lines.filter((l) => l.quantityPicked >= l.quantityTotal).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader
          title={data?.wave.name ?? "Onda"}
          description="Onda de picking completa: o que já foi coletado, o que falta e a conferência de cada item e pedido."
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
          <Link
            href={`/packing/etiquetas?onda=${waveId}`}
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium"
          >
            Etiquetas da onda
          </Link>
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
            {data.wave.status === "RELEASED" && !data.wave.pickFinished ? (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
                Onda ainda em separação. A conferência libera quando o separador finalizar e deixar as
                cestas na mesa do packing.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Pedidos" value={String(orders.length)} />
              <Stat label="Itens coletados" value={`${linesPicked}/${lines.length}`} />
              <Stat label="Unidades coletadas" value={`${unitsPicked}/${unitsTotal}`} />
              <Stat label="Unidades conferidas" value={`${unitsSorted}/${unitsTotal}`} />
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
                      <TableHead className="whitespace-nowrap text-right">Conferido</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => {
                      const state = lineState(line, data.wave.pickFinished);
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
                                Conferir
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-800">
                  Pedidos da onda ({orders.length})
                  <span className="ml-2 font-normal text-muted-foreground">
                    {orders.length - missingLabels.length}/{orders.length} etiqueta(s) gerada(s)
                  </span>
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={generateAll}
                    disabled={labelBusy || missingLabels.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Tags className="h-4 w-4" />
                    )}
                    {generating
                      ? `Gerando ${generating.done + 1}/${generating.total}…`
                      : `Gerar todas as etiquetas${missingLabels.length ? ` (${missingLabels.length})` : ""}`}
                  </button>
                  <button
                    type="button"
                    onClick={printAll}
                    disabled={labelBusy || printableLabels.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {printing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Printer className="h-4 w-4" />
                    )}
                    {printing
                      ? "Imprimindo…"
                      : `Imprimir todas as etiquetas${printableLabels.length ? ` (${printableLabels.length})` : ""}`}
                  </button>
                </div>
              </div>
              {labelMessage ? (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{labelMessage}</p>
              ) : null}
              <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Marketplace</TableHead>
                      <TableHead>Cesta</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Conferido</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Etiqueta</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <span className="whitespace-nowrap font-mono text-sm font-medium">{o.erpOrderId}</span>
                          {o.customerName ? (
                            <span className="block whitespace-nowrap text-xs text-muted-foreground">
                              {o.customerName}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <MarketplaceBadge value={o.marketplace} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-sm">{o.basketCode ?? "—"}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            o.unitsTotal > 0 && o.unitsSorted >= o.unitsTotal && "font-semibold text-emerald-700",
                          )}
                        >
                          {o.unitsSorted}/{o.unitsTotal}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status}
                        </TableCell>
                        <TableCell>
                          <LabelStatus
                            hasLabel={o.hasLabel}
                            format={o.labelFormat}
                            error={labelErrors[o.id]}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {o.status === "PICKED_AWAITING_CONFERENCE" ? (
                            <button
                              type="button"
                              onClick={() => openOrderConference(o.id)}
                              className="rounded-lg bg-[#0d9488] px-3 py-1.5 text-xs font-semibold text-white"
                            >
                              Conferir
                            </button>
                          ) : null}
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
