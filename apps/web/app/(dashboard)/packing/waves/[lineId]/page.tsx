"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { DataState } from "@/components/ops/data-state";
import { WaveLineIssueModal } from "@/components/ops/wave-line-issue-modal";
import { apiFetch } from "@/lib/api/client";
import {
  fetchWavePackingLine,
  type PackingIssueType,
} from "@/lib/api/operations";
import { cn } from "@/lib/utils";

type WaveLine = Awaited<ReturnType<typeof fetchWavePackingLine>>["line"];
type Allocation = WaveLine["allocations"][number];

type ReportState = {
  alloc: Allocation;
  initialType: PackingIssueType;
  initialDescription: string;
};

export default function PackingWaveLinePage() {
  const params = useParams<{ lineId: string }>();
  const lineId = params.lineId;

  const [line, setLine] = useState<WaveLine | null>(null);
  const [collectionDeadline, setCollectionDeadline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** qty digitada por allocationId */
  const [qtyByAlloc, setQtyByAlloc] = useState<Record<string, string>>({});
  const [reporting, setReporting] = useState<ReportState | null>(null);

  const refresh = useCallback(async () => {
    const data = await fetchWavePackingLine(lineId);
    setLine(data.line);
    setCollectionDeadline(data.collectionDeadline ?? null);
    setQtyByAlloc((prev) => {
      const next: Record<string, string> = {};
      for (const alloc of data.line.allocations) {
        if (alloc.remaining <= 0 || alloc.awaitingRepick) continue;
        next[alloc.id] =
          prev[alloc.id] !== undefined && prev[alloc.id] !== ""
            ? prev[alloc.id]
            : String(alloc.remaining);
      }
      return next;
    });
    return data.line;
  }, [lineId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar item");
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmAlloc = async (allocationId: string, quantity: number) => {
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/packing/waves/lines/${lineId}/sort`, {
        method: "POST",
        body: JSON.stringify({ allocationId, quantity }),
      });
      const updated = await refresh();
      setMessage(
        updated.sortStatus === "SORTED"
          ? "Item conferido em todos os pedidos"
          : "Quantidade confirmada",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro na conferência");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = (alloc: Allocation) => {
    const remaining = alloc.remaining;
    const parsed = parseInt(qtyByAlloc[alloc.id] ?? String(remaining), 10);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > remaining) {
      setMessage(`Informe uma quantidade entre 1 e ${remaining}`);
      return;
    }
    if (parsed < remaining) {
      setReporting({
        alloc,
        initialType: "WRONG_QUANTITY",
        initialDescription: `Conferiu ${parsed} de ${remaining} un. esperadas.`,
      });
      return;
    }
    void confirmAlloc(alloc.id, parsed);
  };

  const openManualReport = (alloc: Allocation) => {
    setReporting({
      alloc,
      initialType: "WRONG_ITEM",
      initialDescription: "",
    });
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={line ? `Conferir ${line.product.sku}` : "Conferir item"}
          description={`${line?.waveName ?? "Onda"} · digite a quantidade. Se for menor, abre reporte. Item errado: use Reportar.`}
        />
        <div className="flex gap-2">
          {line ? (
            <Link
              href={`/packing/ondas/${line.waveId}`}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
            >
              Onda completa
            </Link>
          ) : null}
          <Link href="/packing" className="rounded-lg border px-3 py-2 text-sm font-medium">
            Voltar
          </Link>
        </div>
      </div>

      {message ? <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p> : null}

      <DataState loading={loading} error={error} empty={false}>
        {line ? (
          <>
            <div className="flex gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
              {line.product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={line.product.imageUrl}
                  alt={line.product.name}
                  className="h-20 w-20 shrink-0 rounded-lg border bg-white object-contain"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold">{line.product.sku}</p>
                <p className="text-sm">{line.product.name}</p>
                <p className="text-sm text-muted-foreground">
                  Local {line.pickLocation.barcode} · {line.quantityPicked}/{line.quantityTotal} un.
                  coletadas
                </p>
                <div className="mt-3">
                  <CollectionDeadlineIndicator deadline={collectionDeadline} variant="detail" />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {line.allocations.map((alloc) => {
                const done = alloc.remaining <= 0;
                const qtyStr = qtyByAlloc[alloc.id] ?? String(alloc.remaining);
                const parsed = parseInt(qtyStr, 10);
                const qtyValid =
                  !Number.isNaN(parsed) && parsed > 0 && parsed <= alloc.remaining;

                return (
                  <div
                    key={alloc.id}
                    className={cn(
                      "rounded-xl border bg-white p-4 shadow-sm",
                      done && "border-emerald-300 bg-emerald-50",
                      alloc.awaitingRepick && "border-red-200 bg-red-50/50",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-mono font-bold">{alloc.order.erpOrderId}</p>
                      <p className="text-sm text-muted-foreground">
                        {alloc.order.basketCode ? `cesta ${alloc.order.basketCode}` : "sem cesta"}
                      </p>
                    </div>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {alloc.quantity} un.
                      {alloc.quantitySorted > 0 && !done ? (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          ({alloc.quantitySorted} já conferida)
                        </span>
                      ) : null}
                    </p>

                    {done ? (
                      <p className="mt-2 text-sm font-medium text-emerald-700">Conferido</p>
                    ) : alloc.awaitingRepick ? (
                      <p className="mt-2 text-sm font-medium text-red-700">
                        Aguardando o separador coletar de novo
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <label className="block text-sm">
                          <span className="mb-1 block font-medium text-slate-700">
                            Quantidade conferida
                          </span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={alloc.remaining}
                            value={qtyStr}
                            disabled={saving}
                            onChange={(e) =>
                              setQtyByAlloc((prev) => ({
                                ...prev,
                                [alloc.id]: e.target.value,
                              }))
                            }
                            className="w-full rounded-lg border px-3 py-2.5 text-lg font-semibold tabular-nums"
                          />
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Esperado: {alloc.remaining} un. · se for menor, abre reporte de
                            quantidade
                          </span>
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving || !qtyValid}
                            className="flex-1 rounded-lg bg-[#0d9488] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                            onClick={() => handleConfirm(alloc)}
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            onClick={() => openManualReport(alloc)}
                          >
                            Reportar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </DataState>

      {reporting && line ? (
        <WaveLineIssueModal
          lineId={line.id}
          sku={line.product.sku}
          location={line.pickLocation.barcode}
          order={{
            allocationId: reporting.alloc.id,
            erpOrderId: reporting.alloc.order.erpOrderId,
            units: reporting.alloc.remaining,
          }}
          initialType={reporting.initialType}
          initialDescription={reporting.initialDescription}
          onClose={() => setReporting(null)}
          onSubmitted={() => {
            setReporting(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
