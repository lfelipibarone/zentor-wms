"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { DataState } from "@/components/ops/data-state";
import { WaveLineIssueModal } from "@/components/ops/wave-line-issue-modal";
import { apiFetch } from "@/lib/api/client";
import { fetchWavePackingLine } from "@/lib/api/operations";
import { cn } from "@/lib/utils";

type WaveLine = Awaited<ReturnType<typeof fetchWavePackingLine>>["line"];

export default function PackingWaveLinePage() {
  const params = useParams<{ lineId: string }>();
  const lineId = params.lineId;

  const [line, setLine] = useState<WaveLine | null>(null);
  const [collectionDeadline, setCollectionDeadline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState<WaveLine["allocations"][number] | null>(null);

  const refresh = useCallback(async () => {
    const data = await fetchWavePackingLine(lineId);
    setLine(data.line);
    setCollectionDeadline(data.collectionDeadline ?? null);
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

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={line ? `Conferir ${line.product.sku}` : "Conferir item"}
          description={`${line?.waveName ?? "Onda"} · confira a quantidade de cada pedido. Se estiver errado, toque em Reportar.`}
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
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          className="flex-1 rounded-lg bg-[#0d9488] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          onClick={() => confirmAlloc(alloc.id, alloc.remaining)}
                        >
                          Confirmar {alloc.remaining} un.
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          onClick={() => setReporting(alloc)}
                        >
                          Reportar
                        </button>
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
            allocationId: reporting.id,
            erpOrderId: reporting.order.erpOrderId,
            units: reporting.remaining,
          }}
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
