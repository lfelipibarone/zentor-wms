"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { DataState } from "@/components/ops/data-state";
import { apiFetch } from "@/lib/api/client";
import { fetchWavePackingLine } from "@/lib/api/operations";

export default function PackingWaveLinePage() {
  const params = useParams<{ lineId: string }>();
  const lineId = params.lineId;

  const [line, setLine] = useState<
    Awaited<ReturnType<typeof fetchWavePackingLine>>["line"] | null
  >(null);
  const [collectionDeadline, setCollectionDeadline] = useState<string | null>(
    null,
  );
  const [basketBarcode, setBasketBarcode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWavePackingLine(lineId);
      setLine(data.line);
      setCollectionDeadline(data.collectionDeadline ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar linha");
    } finally {
      setLoading(false);
    }
  }, [lineId]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmWaveAlloc = async (
    allocationId: string,
    quantity: number,
    basket?: string,
  ) => {
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/packing/waves/lines/${lineId}/sort`, {
        method: "POST",
        body: JSON.stringify({
          allocationId,
          quantity,
          basketBarcode: basket?.trim() || undefined,
        }),
      });
      const data = await fetchWavePackingLine(lineId);
      setLine(data.line);
      setCollectionDeadline(data.collectionDeadline ?? null);
      if (data.line.sortStatus === "SORTED") {
        setMessage("Linha de onda concluída");
      } else {
        setMessage("Alocação registrada");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro no packing de onda");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={line?.waveName ?? "Onda"}
          description="Distribua as unidades coletadas nas cestas dos pedidos."
        />
        <Link
          href="/packing"
          className="rounded-lg border px-3 py-2 text-sm font-medium"
        >
          Voltar
        </Link>
      </div>

      {message ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
      ) : null}

      <DataState loading={loading} error={error} empty={false}>
        {line ? (
          <>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-amber-800">
                Onda · packing
              </p>
              <p className="mt-1 font-mono text-sm font-bold">{line.product.sku}</p>
              <p className="text-sm text-muted-foreground">
                {line.quantityPicked}/{line.quantityTotal} un. coletadas
              </p>
              <div className="mt-3">
                <CollectionDeadlineIndicator
                  deadline={collectionDeadline}
                  variant="detail"
                />
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <label className="text-xs text-muted-foreground">Cesta (bip)</label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono"
                value={basketBarcode}
                onChange={(e) => setBasketBarcode(e.target.value)}
                placeholder="Código da cesta"
              />
            </div>

            <div className="space-y-3">
              {line.allocations.map((alloc) => (
                <div key={alloc.id} className="rounded-xl border bg-white p-4 shadow-sm">
                  <p className="font-mono font-bold">{alloc.order.erpOrderId}</p>
                  <p className="text-sm text-muted-foreground">
                    {alloc.quantitySorted}/{alloc.quantity} un.
                    {alloc.order.basketCode
                      ? ` · cesta ${alloc.order.basketCode}`
                      : ""}
                  </p>
                  {alloc.remaining > 0 ? (
                    <button
                      type="button"
                      disabled={saving}
                      className="mt-3 w-full rounded-lg bg-[#0d9488] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      onClick={() =>
                        confirmWaveAlloc(
                          alloc.id,
                          alloc.remaining,
                          basketBarcode || alloc.order.basketCode || undefined,
                        )
                      }
                    >
                      Confirmar {alloc.remaining} un.
                    </button>
                  ) : (
                    <p className="mt-2 text-sm font-medium text-emerald-700">OK</p>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
