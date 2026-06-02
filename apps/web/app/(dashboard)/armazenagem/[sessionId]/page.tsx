"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import {
  completePutawaySession,
  fetchPutawaySession,
  storePutawayItem,
  type PutawaySessionView,
} from "@/lib/api/putaway";

export default function ArmazenagemSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [data, setData] = useState<PutawaySessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationBarcode, setLocationBarcode] = useState("");
  const [productBarcode, setProductBarcode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPutawaySession(sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.nextItem) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await storePutawayItem(sessionId, {
        itemId: data.nextItem.id,
        locationBarcode: locationBarcode.trim(),
        productBarcode: productBarcode.trim() || undefined,
        quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
      });
      setData(updated);
      setLocationBarcode("");
      setProductBarcode("");
      setQuantity("1");
      setMessage(
        updated.allStored
          ? "Todos os itens armazenados"
          : `Próximo: ${updated.nextItem?.description ?? updated.nextItem?.productCode}`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao armazenar");
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await completePutawaySession(sessionId);
      router.push("/armazenagem");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao finalizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Armazenagem"
        description="Bipe ou informe o pulmão e a quantidade de cada item."
      />

      <Link href="/armazenagem" className="text-sm text-[#0d9488] underline">
        Voltar à fila
      </Link>

      <DataState loading={loading} error={error} empty={false}>
        {data ? (
          <>
            {data.nextItem ? (
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="font-mono font-bold">{data.nextItem.productCode}</p>
                <p className="text-sm">{data.nextItem.description}</p>
                <p className="mt-2 text-sm font-semibold">
                  Faltam {data.nextItem.remaining} un.
                </p>
                <form className="mt-4 space-y-3" onSubmit={handleStore}>
                  <label className="block text-sm">
                    <span className="font-medium">Código do pulmão</span>
                    <input
                      className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
                      value={locationBarcode}
                      onChange={(e) => setLocationBarcode(e.target.value)}
                      placeholder="Barcode da posição"
                      required
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Produto (opcional se já alocado)</span>
                    <input
                      className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
                      value={productBarcode}
                      onChange={(e) => setProductBarcode(e.target.value)}
                      placeholder="SKU / barcode"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Quantidade</span>
                    <input
                      type="number"
                      min={1}
                      max={data.nextItem.remaining}
                      className="mt-1 w-32 rounded-lg border px-3 py-2 text-sm"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Confirmar armazenagem
                  </button>
                </form>
              </div>
            ) : (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                Todos os itens foram armazenados.
              </p>
            )}

            {message ? (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
            ) : null}

            {data.allStored ? (
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={saving}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
              >
                Finalizar sessão
              </button>
            ) : null}

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="p-2">Produto</th>
                    <th className="p-2">Armazenado</th>
                    <th className="p-2">Pulmão</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="p-2 font-mono">{it.productCode}</td>
                      <td className="p-2">
                        {it.quantityStored}/{it.quantityExpected}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {it.locationBarcode ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
