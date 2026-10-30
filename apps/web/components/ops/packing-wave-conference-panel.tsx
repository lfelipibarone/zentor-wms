"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
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

type Props = {
  lineId: string;
  onClose: () => void;
  onChanged?: () => void;
};

export function PackingWaveConferencePanel({ lineId, onClose, onChanged }: Props) {
  const [line, setLine] = useState<WaveLine | null>(null);
  const [collectionDeadline, setCollectionDeadline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMessage(null);
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar item"))
      .finally(() => setLoading(false));
  }, [refresh]);

  const confirmAlloc = async (allocationId: string, quantity: number) => {
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/packing/waves/lines/${lineId}/sort`, {
        method: "POST",
        body: JSON.stringify({ allocationId, quantity }),
      });
      const updated = await refresh();
      onChanged?.();
      if (updated.sortStatus === "SORTED") {
        setMessage("Item conferido em todos os pedidos");
        onClose();
      } else {
        setMessage("Quantidade confirmada");
      }
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

  const pendingAllocs =
    line?.allocations.filter((a) => a.remaining > 0 && !a.awaitingRepick) ?? [];

  return (
    <div className="flex h-[min(720px,calc(100vh-7rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-3">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0d9488]">
            Estação · conferir
          </p>
          <p className="mt-1 truncate font-mono text-lg font-bold tracking-tight text-slate-900">
            {line?.product.sku ?? "…"}
          </p>
          <p className="truncate text-sm text-slate-500">{line?.waveName ?? "Onda"}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
          aria-label="Fechar painel"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
        {message ? (
          <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p>
        ) : null}

        <DataState loading={loading} error={error} empty={false}>
          {line ? (
            <>
              <div className="flex gap-4">
                <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {line.product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={line.product.imageUrl}
                      alt={line.product.name}
                      className="h-full w-full object-contain p-2"
                    />
                  ) : (
                    <span className="px-2 text-center font-mono text-xs text-slate-400">
                      sem foto
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-base font-medium leading-snug text-slate-900">
                    {line.product.name}
                  </p>
                  <p className="text-sm text-slate-500">
                    Local{" "}
                    <span className="font-mono font-semibold text-slate-800">
                      {line.pickLocation.barcode}
                    </span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="tabular-nums">
                      {line.quantityPicked}/{line.quantityTotal} un.
                    </span>
                  </p>
                  <CollectionDeadlineIndicator deadline={collectionDeadline} />
                </div>
              </div>

              {line.allocations.length === 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Sem pedidos alocados nesta linha. Atualize a fila.
                </p>
              ) : pendingAllocs.length === 0 ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  Todos os pedidos desta linha já foram conferidos.
                </p>
              ) : null}

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
                        "rounded-2xl border px-4 py-4",
                        done && "border-emerald-200 bg-emerald-50/70",
                        alloc.awaitingRepick && "border-red-200 bg-red-50/60",
                        !done && !alloc.awaitingRepick && "border-slate-200 bg-slate-50/50",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-mono text-base font-bold text-slate-900">
                          {alloc.order?.erpOrderId ?? "Pedido"}
                        </p>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {alloc.order?.basketCode
                            ? `Cesta ${alloc.order.basketCode}`
                            : "Sem cesta"}
                        </p>
                      </div>

                      {done ? (
                        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                          <Check className="h-4 w-4" /> Conferido
                        </p>
                      ) : alloc.awaitingRepick ? (
                        <p className="mt-3 text-sm font-semibold text-red-700">
                          Aguardando recoleta
                        </p>
                      ) : (
                        <div className="mt-4 space-y-3">
                          <label className="block">
                            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Quantidade · esperado {alloc.remaining}
                              {alloc.quantitySorted > 0
                                ? ` · ${alloc.quantitySorted} já ok`
                                : ""}
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
                              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-3xl font-bold tabular-nums tracking-tight text-slate-900 outline-none ring-[#0d9488] focus:border-[#0d9488] focus:ring-2"
                            />
                          </label>
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <button
                              type="button"
                              disabled={saving || !qtyValid}
                              className="rounded-xl bg-[#0d9488] py-3.5 text-base font-semibold text-white transition hover:bg-teal-700 disabled:opacity-40"
                              onClick={() => handleConfirm(alloc)}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              className="rounded-xl border border-red-300 px-4 py-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-40"
                              onClick={() =>
                                setReporting({
                                  alloc,
                                  initialType: "WRONG_ITEM",
                                  initialDescription: "",
                                })
                              }
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
      </div>

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
            void refresh().then(() => onChanged?.());
          }}
        />
      ) : null}
    </div>
  );
}
