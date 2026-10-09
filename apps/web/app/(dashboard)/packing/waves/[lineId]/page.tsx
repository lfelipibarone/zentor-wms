"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { DataState } from "@/components/ops/data-state";
import { WaveLineIssueModal } from "@/components/ops/wave-line-issue-modal";
import { apiFetch } from "@/lib/api/client";
import { productMatchesCode } from "@wms/shared";
import { fetchWavePackingLine } from "@/lib/api/operations";
import { cn } from "@/lib/utils";

export default function PackingWaveLinePage() {
  const params = useParams<{ lineId: string }>();
  const lineId = params.lineId;
  const router = useRouter();
  const [issueOpen, setIssueOpen] = useState(false);

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
  const [productCode, setProductCode] = useState("");
  const [productOk, setProductOk] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const checkProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!line || !productCode.trim()) return;
    if (productMatchesCode(line.product, productCode)) {
      setProductOk(true);
      setProductError(null);
    } else {
      setProductError(
        `Produto errado: "${productCode.trim()}" não é ${line.product.sku}. Confira o que veio do picking.`,
      );
      setProductCode("");
    }
  };

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
        setMessage("Item conferido em todos os pedidos");
      } else {
        setMessage("Unidades conferidas na cesta do pedido");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro na conferência");
    } finally {
      setSaving(false);
    }
  };

  const canReport =
    !!line && line.quantityPicked > 0 && line.allocations.every((a) => a.quantitySorted === 0);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={line ? `Conferir ${line.product.sku}` : "Conferir item"}
          description={`${line?.waveName ?? "Onda"} · bipe o produto para conferir o que veio do picking e confirme as unidades de cada pedido.`}
        />
        <div className="flex gap-2">
          {canReport ? (
            <button
              type="button"
              onClick={() => setIssueOpen(true)}
              className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Reportar erro
            </button>
          ) : null}
          {line ? (
            <Link
              href={`/packing/ondas/${line.waveId}`}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
            >
              Onda completa
            </Link>
          ) : null}
          <Link
            href="/packing"
            className="rounded-lg border px-3 py-2 text-sm font-medium"
          >
            Voltar
          </Link>
        </div>
      </div>

      {message ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
      ) : null}

      <DataState loading={loading} error={error} empty={false}>
        {line ? (
          <>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-amber-800">
                Onda · conferência
              </p>
              <p className="mt-1 font-mono text-sm font-bold">{line.product.sku}</p>
              <p className="text-sm">{line.product.name}</p>
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

            {productOk ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                Produto conferido: {line.product.sku}
              </p>
            ) : (
              <form
                onSubmit={checkProduct}
                className="rounded-xl border-2 border-[#0d9488] bg-white p-4 shadow-sm"
              >
                <label className="text-sm font-semibold text-slate-800">
                  1. Bipe o produto coletado
                </label>
                <p className="text-xs text-muted-foreground">
                  Código de barras, SKU ou QR da etiqueta do produto.
                </p>
                <input
                  autoFocus
                  className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-sm"
                  value={productCode}
                  onChange={(e) => {
                    setProductCode(e.target.value);
                    setProductError(null);
                  }}
                  placeholder="Bipar produto"
                />
                {productError ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-red-700">{productError}</p>
                    {canReport ? (
                      <button
                        type="button"
                        onClick={() => setIssueOpen(true)}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Devolver para o separador
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </form>
            )}

            <div className={cn("rounded-xl border bg-white p-4 shadow-sm", !productOk && "opacity-50")}>
              <label className="text-xs text-muted-foreground">
                {productOk ? "2. " : ""}Cesta (bip)
              </label>
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
                      disabled={saving || !productOk}
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

      {issueOpen && line ? (
        <WaveLineIssueModal
          lineId={line.id}
          sku={line.product.sku}
          units={line.quantityPicked}
          onClose={() => setIssueOpen(false)}
          onSubmitted={() => router.push(`/packing/ondas/${line.waveId}`)}
        />
      ) : null}
    </div>
  );
}
