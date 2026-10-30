"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
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

  return (
    <div className="flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-2 border-b border-amber-100 bg-amber-50/80 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-amber-900">Conferir</p>
          <p className="truncate font-mono text-sm font-bold">
            {line?.product.sku ?? "…"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {line?.waveName ?? "Onda"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-amber-100 hover:text-slate-800"
          aria-label="Fechar painel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {message ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
        ) : null}

        <DataState loading={loading} error={error} empty={false}>
          {line ? (
            <>
              <div className="flex gap-3">
                {line.product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={line.product.imageUrl}
                    alt={line.product.name}
                    className="h-16 w-16 shrink-0 rounded-lg border bg-white object-contain"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{line.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Local {line.pickLocation.barcode} · {line.quantityPicked}/
                    {line.quantityTotal} un.
                  </p>
                  <div className="mt-2">
                    <CollectionDeadlineIndicator
                      deadline={collectionDeadline}
                      variant="detail"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
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
                        "rounded-lg border p-3",
                        done && "border-emerald-300 bg-emerald-50",
                        alloc.awaitingRepick && "border-red-200 bg-red-50/50",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-mono text-sm font-bold">
                          {alloc.order.erpOrderId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {alloc.order.basketCode
                            ? `cesta ${alloc.order.basketCode}`
                            : "sem cesta"}
                        </p>
                      </div>
                      <p className="mt-1 text-lg font-bold tabular-nums">
                        {alloc.quantity} un.
                        {alloc.quantitySorted > 0 && !done ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            ({alloc.quantitySorted} já)
                          </span>
                        ) : null}
                      </p>

                      {done ? (
                        <p className="mt-1 text-sm font-medium text-emerald-700">
                          Conferido
                        </p>
                      ) : alloc.awaitingRepick ? (
                        <p className="mt-1 text-sm font-medium text-red-700">
                          Aguardando recoleta
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <label className="block text-sm">
                            <span className="mb-1 block text-xs font-medium text-slate-700">
                              Qtd conferida
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
                              className="w-full rounded-lg border px-3 py-2 text-base font-semibold tabular-nums"
                            />
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={saving || !qtyValid}
                              className="flex-1 rounded-lg bg-[#0d9488] py-2 text-sm font-semibold text-white disabled:opacity-50"
                              onClick={() => handleConfirm(alloc)}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
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
