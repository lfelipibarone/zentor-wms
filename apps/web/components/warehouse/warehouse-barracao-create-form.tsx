"use client";

import { useState } from "react";
import { createWarehouseItem } from "@/lib/api/warehouse";

export function WarehouseBarracaoCreateForm({
  onCreated,
  onCancel,
  compact = false,
}: {
  onCreated: (barracao: { id: string; code: string; name: string | null }) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!code.trim()) {
      setErr("Código obrigatório");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const { item } = await createWarehouseItem("barracoes", {
        code: code.trim(),
        name: name.trim() || undefined,
      });
      onCreated({
        id: item.id,
        code: item.code,
        name: item.name,
      });
      setCode("");
      setName("");
      setSaving(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao cadastrar barracão");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`space-y-3 rounded-xl border border-dashed border-[#0d9488]/40 bg-teal-50/30 p-4 ${
        compact ? "" : ""
      }`}
    >
      <p className="text-sm font-medium text-slate-800">Cadastrar novo barracão</p>
      <label className="block text-sm">
        Código
        <input
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-mono uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Ex.: B1"
        />
      </label>
      <label className="block text-sm">
        Nome (opcional)
        <input
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Galpão principal"
        />
      </label>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      <div className="flex flex-wrap gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          >
            Cancelar
          </button>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar barracão"}
        </button>
      </div>
    </div>
  );
}
