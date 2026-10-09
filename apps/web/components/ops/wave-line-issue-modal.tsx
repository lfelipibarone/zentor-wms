"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  PACKING_ISSUE_TYPE_LABEL,
  reportWaveLineIssue,
  type PackingIssueType,
} from "@/lib/api/operations";

const TYPE_OPTIONS: PackingIssueType[] = ["WRONG_ITEM", "WRONG_QUANTITY", "DAMAGED", "MISSING"];

export function WaveLineIssueModal({
  lineId,
  sku,
  location,
  order,
  onClose,
  onSubmitted,
}: {
  lineId: string;
  sku: string;
  location: string;
  order: { allocationId: string; erpOrderId: string; units: number };
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [type, setType] = useState<PackingIssueType>("WRONG_ITEM");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** undefined = ainda não enviado; null = voltou sem separador identificado */
  const [returnedTo, setReturnedTo] = useState<string | null | undefined>(undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await reportWaveLineIssue(lineId, {
        type,
        description: description.trim() || undefined,
        allocationId: order.allocationId,
      });
      setReturnedTo(result.returnedToName ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reportar erro");
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (submitting) return;
    if (returnedTo !== undefined) onSubmitted();
    else onClose();
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-900">Reportar erro no pedido {order.erpOrderId}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {sku} · local {location} · {order.units} un. O separador é avisado e coleta de novo para
              este pedido.
            </p>
          </div>
        </div>

        {returnedTo !== undefined ? (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              {returnedTo
                ? `${returnedTo} foi avisado: pedido ${order.erpOrderId} · ${sku} · local ${location}.`
                : `Pedido ${order.erpOrderId} voltou para a separação (não foi possível identificar quem separou).`}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSubmitted}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
              >
                OK
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">O que está errado</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as PackingIssueType)}
                disabled={submitting}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {PACKING_ISSUE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Descrição (opcional)</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 280))}
                disabled={submitting}
                rows={3}
                placeholder="Ex.: veio a garrafa no lugar da caneca"
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              />
            </label>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Avisar o separador
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
