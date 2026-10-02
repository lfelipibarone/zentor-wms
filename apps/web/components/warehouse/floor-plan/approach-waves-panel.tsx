"use client";

import { ArrowDown, ArrowUp, Flag, MapPin, Plus, Repeat, Trash2, X } from "lucide-react";
import type { ApproachStop, ApproachWave, ApproachWaveKind } from "@/lib/api/approach-waves";
import { APPROACH_COLORS, stopLabel } from "./approach-geometry";

export type ApproachPick = "start" | "stops" | null;

const KINDS: Array<{ id: ApproachWaveKind; label: string }> = [
  { id: "PICKING", label: "Picking" },
  { id: "PACKING", label: "Packing" },
];

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function colunaInput(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function ApproachWavesPanel({
  kind,
  onKindChange,
  waves,
  selectedIndex,
  onSelect,
  onChange,
  pick,
  onPickChange,
  estanteCode,
  dirty,
  saving,
  error,
  planDirty,
  onSave,
  onDiscard,
}: {
  kind: ApproachWaveKind;
  onKindChange: (kind: ApproachWaveKind) => void;
  waves: ApproachWave[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onChange: (waves: ApproachWave[]) => void;
  pick: ApproachPick;
  onPickChange: (pick: ApproachPick) => void;
  estanteCode: (estanteId: string) => string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  planDirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const selected = selectedIndex != null ? waves[selectedIndex] : undefined;
  const update = (patch: Partial<ApproachWave>) => {
    if (selectedIndex == null) return;
    onChange(waves.map((w, i) => (i === selectedIndex ? { ...w, ...patch } : w)));
  };
  const setStops = (stops: ApproachStop[]) => update({ stops });

  const addWave = () => {
    const color = APPROACH_COLORS[waves.length % APPROACH_COLORS.length]!;
    onChange([...waves, { name: `Onda ${waves.length + 1}`, color, active: true, startX: null, startY: null, stops: [] }]);
    onSelect(waves.length);
    onPickChange("start");
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => onKindChange(k.id)}
            className={`flex-1 rounded-md px-2 py-1 font-medium ${kind === k.id ? "bg-white text-[#0d9488] shadow-sm" : "text-slate-600"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {kind === "PICKING"
          ? "Cada onda vira uma parte do lote: um separador por área, andando na ordem das paradas."
          : "Cada mesa de packing pega a fila da sua onda, na ordem das paradas."}
      </p>
      {planDirty ? (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Salve a planta antes, para a saída valer no desenho novo.</p>
      ) : null}

      <ul className="space-y-1">
        {waves.map((w, i) => (
          <li key={w.id ?? `new-${i}`} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onSelect(i);
                onPickChange(null);
              }}
              className={`flex flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-left ${i === selectedIndex ? "border-[#0d9488] bg-teal-50" : "bg-white"}`}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: w.color }} />
              <span className={`flex-1 truncate font-medium ${w.active ? "" : "text-slate-400 line-through"}`}>{w.name}</span>
              <span className="text-xs text-slate-500">{w.stops.length} parada(s)</span>
            </button>
            <button
              type="button"
              title="Subir"
              onClick={() => {
                onChange(move(waves, i, i - 1));
                onSelect(Math.max(0, i - 1));
              }}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Descer"
              onClick={() => {
                onChange(move(waves, i, i + 1));
                onSelect(Math.min(waves.length - 1, i + 1));
              }}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addWave}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-1.5 text-slate-600 hover:bg-slate-50"
      >
        <Plus className="h-4 w-4" /> Nova onda
      </button>

      {selected ? (
        <div className="space-y-3 rounded-lg border p-3">
          <input
            value={selected.name}
            onChange={(e) => update({ name: e.target.value })}
            className="w-full rounded-md border px-2 py-1 font-medium"
            maxLength={60}
          />
          <div className="flex flex-wrap gap-1.5">
            {APPROACH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => update({ color: c })}
                className={`h-5 w-5 rounded-full ${selected.color === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={selected.active} onChange={(e) => update({ active: e.target.checked })} /> Ativa
          </label>

          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onPickChange(pick === "start" ? null : "start")}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs ${pick === "start" ? "border-[#0d9488] bg-teal-50 text-[#0d9488]" : ""}`}
            >
              <Flag className="h-3.5 w-3.5" /> {selected.startX != null ? "Mudar saída" : "Marcar saída"}
            </button>
            <button
              type="button"
              onClick={() => onPickChange(pick === "stops" ? null : "stops")}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs ${pick === "stops" ? "border-[#0d9488] bg-teal-50 text-[#0d9488]" : ""}`}
            >
              <MapPin className="h-3.5 w-3.5" /> Adicionar paradas
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {pick === "start"
              ? "Clique numa célula livre do mapa para a saída."
              : pick === "stops"
                ? "Clique no lado de uma gôndola (ou parte) para adicionar a próxima parada."
                : selected.startX != null
                  ? `Saída na célula (${selected.startX}, ${selected.startY}).`
                  : "Sem saída marcada."}
          </p>

          <ol className="space-y-1">
            {selected.stops.map((stop, si) => (
              <li key={`${stop.estanteId}-${stop.face}-${si}`} className="flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-1">
                <span className="w-5 text-center text-xs font-bold" style={{ color: selected.color }}>
                  {si + 1}
                </span>
                <span className="flex-1 truncate text-xs font-medium">{stopLabel(stop, estanteCode)}</span>
                <input
                  type="number"
                  min={1}
                  title="De (coluna)"
                  value={stop.colunaFrom ?? ""}
                  onChange={(e) =>
                    setStops(selected.stops.map((s, k) => (k === si ? { ...s, colunaFrom: colunaInput(e.target.value) } : s)))
                  }
                  className="w-12 rounded border px-1 py-0.5 text-xs"
                />
                <input
                  type="number"
                  min={1}
                  title="Até (coluna)"
                  value={stop.colunaTo ?? ""}
                  onChange={(e) =>
                    setStops(selected.stops.map((s, k) => (k === si ? { ...s, colunaTo: colunaInput(e.target.value) } : s)))
                  }
                  className="w-12 rounded border px-1 py-0.5 text-xs"
                />
                <button
                  type="button"
                  title="Inverter sentido"
                  onClick={() =>
                    setStops(selected.stops.map((s, k) => (k === si ? { ...s, colunaFrom: s.colunaTo, colunaTo: s.colunaFrom } : s)))
                  }
                  className="rounded p-0.5 text-slate-500 hover:bg-white"
                >
                  <Repeat className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Subir"
                  onClick={() => setStops(move(selected.stops, si, si - 1))}
                  className="rounded p-0.5 text-slate-500 hover:bg-white"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Descer"
                  onClick={() => setStops(move(selected.stops, si, si + 1))}
                  className="rounded p-0.5 text-slate-500 hover:bg-white"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Remover"
                  onClick={() => setStops(selected.stops.filter((_, k) => k !== si))}
                  className="rounded p-0.5 text-red-500 hover:bg-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Excluir "${selected.name}"?`)) return;
              onChange(waves.filter((_, i) => i !== selectedIndex));
              onSelect(null);
              onPickChange(null);
            }}
            className="flex items-center gap-1 text-xs text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir onda
          </button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        {dirty ? (
          <button type="button" onClick={onDiscard} className="rounded-lg border px-3 py-1.5">
            Descartar
          </button>
        ) : null}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          className="flex-1 rounded-lg bg-[#0d9488] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar ondas"}
        </button>
      </div>
    </div>
  );
}
