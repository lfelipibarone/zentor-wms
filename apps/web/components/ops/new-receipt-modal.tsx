"use client";

import { useState } from "react";
import {
  startPurchaseReceipt,
  startReturnReceipt,
} from "@/lib/api/operations";

type Mode = "entry" | "return";

export function NewReceiptModal({
  open,
  onClose,
  defaultMode = "entry",
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  defaultMode?: Mode;
  onStarted: (sessionId: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [barcode, setBarcode] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === "entry") {
        const data = await startPurchaseReceipt(barcode.trim());
        onStarted(data.session.id);
      } else {
        const data = await startReturnReceipt(reference.trim() || undefined);
        onStarted(data.session.id);
      }
      onClose();
      setBarcode("");
      setReference("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao iniciar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-receipt-title"
      >
        <h2 id="new-receipt-title" className="text-lg font-semibold">
          Novo recebimento
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "entry"
            ? "Bipe o DANFE ou informe a chave de acesso (44 dígitos)."
            : "Inicie uma devolução de cliente."}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("entry")}
            className={
              mode === "entry"
                ? "rounded-lg bg-[#0d9488] px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700"
            }
          >
            NF entrada
          </button>
          <button
            type="button"
            onClick={() => setMode("return")}
            className={
              mode === "return"
                ? "rounded-lg bg-[#0d9488] px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700"
            }
          >
            Devolução
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {mode === "entry" ? (
            <div>
              <label className="text-sm font-medium" htmlFor="danfe">
                Código DANFE / chave NF-e
              </label>
              <input
                id="danfe"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="44 dígitos"
                autoFocus
                required
              />
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium" htmlFor="ref">
                Referência (opcional)
              </label>
              <input
                id="ref"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Pedido ou observação"
                autoFocus
              />
            </div>
          )}
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || (mode === "entry" && !barcode.trim())}
              className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Iniciando…" : "Iniciar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
