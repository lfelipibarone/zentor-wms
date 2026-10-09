"use client";

import { useState } from "react";
import { setEstanteStockMode, type StockMode } from "@/lib/api/warehouse";

export type EstanteColunaScope = { id: string; code: string; total: number };

export function EstanteStockModeModal({
  estanteId,
  estanteLabel,
  total,
  colunas,
  initialColunaId = "",
  onClose,
  onSaved,
}: {
  estanteId: string;
  estanteLabel: string;
  total: number;
  colunas: EstanteColunaScope[];
  /** "" = estante inteira */
  initialColunaId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<StockMode>("QUANTITY");
  const [colunaId, setColunaId] = useState(initialColunaId);
  const coluna = colunas.find((c) => c.id === colunaId);
  const [capacity, setCapacity] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const cap = capacity.trim() ? Number(capacity) : undefined;
    const min = minQuantity.trim() ? Number(minQuantity) : undefined;
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
      setErr("Capacidade deve ser um número inteiro maior que zero");
      return;
    }
    if (min !== undefined && (!Number.isInteger(min) || min < 0)) {
      setErr("Mínimo deve ser um número inteiro");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await setEstanteStockMode(estanteId, {
        stockMode: mode,
        ...(colunaId ? { colunaId } : {}),
        ...(mode === "QUANTITY" ? { capacity: cap, minQuantity: min } : {}),
      });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-labelledby="estante-stock-mode-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="estante-stock-mode-title" className="text-lg font-bold text-slate-900">
          Ocupação da estante <span className="font-mono">{estanteLabel}</span>
        </h2>

        <label className="mt-4 block text-sm">
          Aplicar em
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={colunaId}
            onChange={(e) => setColunaId(e.target.value)}
          >
            <option value="">Estante inteira ({total} gôndolas)</option>
            {colunas.map((c) => (
              <option key={c.id} value={c.id}>
                Coluna {c.code} ({c.total} gôndolas)
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Vale para {coluna ? `as ${coluna.total} gôndolas da coluna ${coluna.code}` : `as ${total} gôndolas da estante`}.
          Pulmões não mudam. Depois dá para trocar uma gôndola sozinha em Editar.
        </p>

        <div className="mt-4 inline-flex rounded-lg bg-slate-100 p-0.5">
          {(
            [
              { id: "PERCENT", label: "Porcentagem" },
              { id: "QUANTITY", label: "Quantidade" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                mode === opt.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {mode === "QUANTITY" ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="block text-sm">
              Capacidade (un.)
              <input
                type="number"
                min={1}
                placeholder="Manter a atual"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Mínimo (un.)
              <input
                type="number"
                min={0}
                placeholder="Pela % atual"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
              />
            </label>
            <p className="col-span-2 text-xs text-slate-500">
              As unidades de cada gôndola são estimadas pela % atual; a próxima contagem no app
              corrige.
            </p>
          </div>
        ) : null}

        {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
