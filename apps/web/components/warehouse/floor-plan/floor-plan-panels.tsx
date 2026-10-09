"use client";

import { useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import type {
  EstanteStructureBody,
  FloorElement,
  FloorPlanEstante,
  FloorPlanValidation,
  RoutePreview,
} from "@/lib/api/floor-plan";
import {
  AREA_TYPES,
  DANGER_COLOR,
  ELEMENT_LABELS,
  FACE_COLORS,
  FACE_SIDE,
  OBSTACLE_PRESETS,
  ROUTE_COLOR,
  accessCell,
  colunasOnFloor,
  elementEstanteIds,
  faceColunaRange,
  faceColunas,
  formatColunas,
  gondolaView,
  faceSideLabel,
  formatMeters,
  gondolaGeometry,
  isAccessReachable,
  type Face,
  type Reachability,
} from "./geometry";

const inputCls = "mt-1 w-full rounded-lg border px-2 py-1.5 text-sm";

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs text-slate-600">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(ev) => {
          const n = Math.round(Number(ev.target.value));
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className={inputCls}
      />
    </label>
  );
}

export function PlanSettingsPanel({
  cellSizeCm,
  widthCells,
  heightCells,
  onChange,
}: {
  cellSizeCm: number;
  widthCells: number;
  heightCells: number;
  onChange: (patch: { cellSizeCm?: number; widthCells?: number; heightCells?: number }) => void;
}) {
  const m = cellSizeCm / 100;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Barracão</h3>
      <p className="text-xs text-slate-500">
        Área de {formatMeters(widthCells * m)} × {formatMeters(heightCells * m)}. Clique em um elemento para
        editar, ou escolha uma ferramenta à esquerda e clique na planta para adicionar.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Largura (células)" value={widthCells} min={4} max={400} onChange={(v) => onChange({ widthCells: v })} />
        <NumberField label="Altura (células)" value={heightCells} min={4} max={400} onChange={(v) => onChange({ heightCells: v })} />
        <NumberField label="Célula (cm)" value={cellSizeCm} min={10} max={500} onChange={(v) => onChange({ cellSizeCm: v })} />
      </div>
    </div>
  );
}

function EstanteStructureForm({
  estante,
  onSave,
}: {
  estante: FloorPlanEstante;
  onSave: (body: EstanteStructureBody) => Promise<string>;
}) {
  const initial = {
    name: estante.name ?? "",
    ldColunas: estante.colunasLD.length,
    ldLinhas: estante.linhasLD || estante.linhas,
    leColunas: estante.colunasLE.length,
    leLinhas: estante.linhasLE || estante.linhas,
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const total = form.ldColunas * form.ldLinhas + form.leColunas * form.leLinhas;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const text = await onSave({
        name: form.name.trim() || null,
        ld: { colunas: form.ldColunas, linhas: form.ldLinhas },
        le: form.leColunas > 0 ? { colunas: form.leColunas, linhas: form.leLinhas } : null,
      });
      setMessage({ ok: true, text });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Erro ao salvar estante" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">Dados da estante {estante.code}</p>
      <label className="block text-xs text-slate-600">
        Nome / descrição
        <input
          className={inputCls}
          value={form.name}
          maxLength={80}
          placeholder="Opcional"
          onChange={(ev) => setForm({ ...form, name: ev.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Colunas LD (0 = sem LD)" value={form.ldColunas} min={0} max={200} onChange={(v) => setForm({ ...form, ldColunas: v })} />
        <NumberField label="Linhas LD" value={form.ldLinhas} min={1} max={200} onChange={(v) => setForm({ ...form, ldLinhas: v })} />
        <NumberField label="Colunas LE (0 = sem LE)" value={form.leColunas} min={0} max={200} onChange={(v) => setForm({ ...form, leColunas: v })} />
        <NumberField label="Linhas LE" value={form.leLinhas} min={1} max={200} onChange={(v) => setForm({ ...form, leLinhas: v })} />
      </div>
      <p className="text-xs text-slate-500">
        {[
          form.ldColunas > 0 ? `LD colunas 1–${form.ldColunas}` : "",
          form.leColunas > 0 ? `LE ${form.ldColunas + 1}–${form.ldColunas + form.leColunas}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "Sem colunas"}{" "}
        · {total} posições. Posições que saem precisam estar vazias e sem histórico.
      </p>
      {message ? (
        <p className={`text-xs ${message.ok ? "text-teal-700" : "text-red-600"}`}>{message.text}</p>
      ) : null}
      <button
        type="button"
        disabled={!changed || saving || form.ldColunas + form.leColunas === 0}
        onClick={save}
        className="w-full rounded-lg bg-[#0d9488] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar estante"}
      </button>
    </div>
  );
}

export function UnplacedEstantesPanel({
  estantes,
  pendingEstanteId,
  onPick,
  onArrangeAll,
}: {
  estantes: FloorPlanEstante[];
  pendingEstanteId: string | null;
  onPick: (estanteId: string | null) => void;
  onArrangeAll: () => void;
}) {
  if (!estantes.length) {
    return <p className="text-xs text-slate-500">Todas as estantes do cadastro estão no mapa.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Estantes para posicionar ({estantes.length})</h3>
        <button
          type="button"
          onClick={onArrangeAll}
          className="rounded-lg bg-[#0d9488] px-2.5 py-1 text-xs font-semibold text-white"
        >
          Posicionar todas
        </button>
      </div>
      <p className="text-xs text-slate-500">
        {pendingEstanteId
          ? "Clique na planta onde fica a estante (Esc cancela)."
          : "Escolha uma estante e clique na planta, ou posicione todas em fileiras e depois arraste para o lugar certo."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {estantes.map((e) => {
          const active = e.id === pendingEstanteId;
          return (
            <button
              key={e.id}
              type="button"
              title={`LD ${e.colunasLD.length} colunas · LE ${e.colunasLE.length} colunas · ${e.linhas} linhas`}
              onClick={() => onPick(active ? null : e.id)}
              className={`rounded border px-2 py-1 font-mono text-xs ${
                active ? "border-[#0d9488] bg-teal-50 text-teal-800" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {e.code}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotChips({
  element,
  estante,
  face,
  reachability,
}: {
  element: FloorElement;
  estante: FloorPlanEstante;
  face: Face;
  reachability: Reachability;
}) {
  const slots = faceColunas(estante, face);
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(8, Math.max(1, slots.length))}, minmax(0, 1fr))` }}>
      {slots.map((code, i) => {
        const ok = isAccessReachable(reachability, accessCell(element, i, slots.length, face));
        return (
          <span
            key={code}
            title={`${estante.code} ${FACE_SIDE[face]} coluna ${code}${ok ? "" : " · sem acesso"}`}
            className="rounded border px-1 py-0.5 text-center font-mono text-[11px]"
            style={{
              borderColor: ok ? FACE_COLORS[face] : DANGER_COLOR,
              color: ok ? "#0f172a" : DANGER_COLOR,
            }}
          >
            {code}
          </span>
        );
      })}
    </div>
  );
}

export function ElementPropertiesPanel({
  element,
  estantes,
  usedEstanteIds,
  reachability,
  onChange,
  onRotate,
  onDelete,
  onSaveEstante,
  onLinkEstante,
  onMoveEstanteToFace,
  onSplit,
  onChangeRange,
  cellSizeCm,
}: {
  element: FloorElement;
  estantes: FloorPlanEstante[];
  usedEstanteIds: Set<string>;
  reachability: Reachability;
  onChange: (patch: Partial<FloorElement>) => void;
  onRotate: () => void;
  onDelete: () => void;
  onSaveEstante: (estanteId: string, body: EstanteStructureBody) => Promise<string>;
  onLinkEstante: (face: Face, estanteId: string | null) => void;
  onMoveEstanteToFace: (estanteId: string, face: Face) => Promise<void>;
  onSplit: (firstCount: number, gapCells: number) => boolean;
  onChangeRange: (patch: Partial<FloorElement>) => void;
  cellSizeCm: number;
}) {
  const byId = new Map(estantes.map((c) => [c.id, c]));
  const estanteLD = element.estanteId ? byId.get(element.estanteId) : undefined;
  const estanteLE = element.estanteIdB ? byId.get(element.estanteIdB) : undefined;
  const estante = gondolaView(element, byId);
  const linked = [estanteLD, estanteLE].filter((c): c is FloorPlanEstante => Boolean(c));
  const isGondola = element.type === "GONDOLA";
  const { length, thickness } = gondolaGeometry(element);
  const ownIds = new Set(elementEstanteIds(element));
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const moveToFace = async (estanteId: string, face: Face) => {
    setMovingId(estanteId);
    setMoveError(null);
    try {
      await onMoveEstanteToFace(estanteId, face);
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : "Erro ao mudar o lado");
    } finally {
      setMovingId(null);
    }
  };

  const estanteSelect = (face: Face) => {
    const value = (face === "A" ? element.estanteId : element.estanteIdB) ?? "";
    return (
      <select
        className={inputCls}
        value={value}
        disabled={face === "B" && !element.estanteId}
        onChange={(ev) => onLinkEstante(face, ev.target.value || null)}
      >
        <option value="">{face === "A" ? "Sem vínculo" : "A mesma do LD (frente e verso)"}</option>
        {estantes.map((c) => {
          const other = face === "A" ? element.estanteIdB : element.estanteId;
          const usedElsewhere = usedEstanteIds.has(c.id) && !ownIds.has(c.id);
          return (
            <option key={c.id} value={c.id} disabled={c.id === other}>
              Estante {c.code}
              {c.name ? ` — ${c.name}` : ""}
              {usedElsewhere ? " (sai da gôndola atual)" : ""}
            </option>
          );
        })}
      </select>
    );
  };

  /** Estante num lado só da gôndola, mas com posições cadastradas no outro lado. */
  const wrongSide =
    estanteLD && estanteLE
      ? [
          { estante: estanteLD, face: "A" as Face, wrong: estanteLD.colunasLE.length },
          { estante: estanteLE, face: "B" as Face, wrong: estanteLE.colunasLD.length },
        ].filter((w) => w.wrong > 0)
      : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {isGondola
            ? estante
              ? `Gôndola · ${linked.length > 1 ? "" : "Estante "}${estante.code}`
              : "Gôndola sem vínculo"
            : ELEMENT_LABELS[element.type]}
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            title="Girar 90° (R)"
            onClick={onRotate}
            className="rounded-md border p-1.5 text-slate-600 hover:bg-slate-50"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Excluir (Delete)"
            onClick={onDelete}
            className="rounded-md border p-1.5 text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isGondola ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-600">
              Estante do LD
              {estanteSelect("A")}
            </label>
            <label className="block text-xs text-slate-600">
              Estante do LE
              {estanteSelect("B")}
            </label>
          </div>
          <p className="text-xs text-slate-500">
            {estante
              ? `LD ${estante.colunasLD.length} colunas · LE ${estante.colunasLE.length} colunas · ${estante.linhas} linhas de altura · ${length} células de comprimento`
              : "Vincule uma estante para distribuir as colunas na gôndola."}
            {estanteLE ? " Duas estantes de costas: cada lado é uma estante." : ""}
          </p>
          {estanteLD && estanteLE ? (
            <button
              type="button"
              onClick={() => onChange({ estanteId: estanteLE.id, estanteIdB: estanteLD.id })}
              className="rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Trocar lados ({estanteLE.code} no LD, {estanteLD.code} no LE)
            </button>
          ) : null}
          {wrongSide.map((w) => (
            <div key={w.estante.id} className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <p>
                A estante {w.estante.code} está no {FACE_SIDE[w.face]} desta gôndola, mas tem {w.wrong} coluna
                {w.wrong === 1 ? "" : "s"} cadastrada{w.wrong === 1 ? "" : "s"} no {FACE_SIDE[w.face === "A" ? "B" : "A"]}.
              </p>
              <button
                type="button"
                disabled={movingId !== null}
                onClick={() => moveToFace(w.estante.id, w.face)}
                className="rounded border border-amber-300 bg-white px-2 py-1 font-semibold disabled:opacity-50"
              >
                {movingId === w.estante.id
                  ? "Movendo…"
                  : `Passar todas as posições da ${w.estante.code} para o ${FACE_SIDE[w.face]}`}
              </button>
            </div>
          ))}
          {moveError ? <p className="text-xs text-red-600">{moveError}</p> : null}
          {linked.map((c) => (
            <EstanteStructureForm key={c.id} estante={c} onSave={(body) => onSaveEstante(c.id, body)} />
          ))}
          <div className="space-y-2 text-sm">
            {(["A", "B"] as Face[]).map((face) => {
              const enabled = face === "A" ? element.faceAEnabled : element.faceBEnabled;
              const colunas = faceColunas(estante, face);
              return (
                <div key={face} className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(ev) =>
                        onChange(face === "A" ? { faceAEnabled: ev.target.checked } : { faceBEnabled: ev.target.checked })
                      }
                    />
                    {FACE_SIDE[face]}
                    {colunas.length > 0 && !enabled ? (
                      <span className="text-xs text-amber-700">· há posições neste lado</span>
                    ) : null}
                  </label>
                  {enabled && estante ? (
                    <ColunaDirectionToggle
                      colunas={colunas}
                      reversed={face === "A" ? element.colunaReversedA : element.colunaReversedB}
                      onChange={(v) => onChange(face === "A" ? { colunaReversedA: v } : { colunaReversedB: v })}
                    />
                  ) : null}
                </div>
              );
            })}
            {estante && estante.colunasLD.length + estante.colunasLE.length > 1 ? (
              <p className="text-xs text-slate-500">
                Sentido das colunas em cada lado, como aparecem no desenho (da esquerda para a direita com a gôndola sem
                rotação). Se o LE continua a numeração dando a volta na ponta, ele fica invertido em relação ao LD.
              </p>
            ) : null}
          </div>
          {estante && estanteLD ? (
            <GondolaPartsSection
              key={element.id}
              element={element}
              view={estante}
              allColunas={{ A: estanteLD.colunasLD, B: (estanteLE ?? estanteLD).colunasLE }}
              cellSizeCm={cellSizeCm}
              onChangeRange={onChangeRange}
              onSplit={onSplit}
            />
          ) : null}
          <p className="text-xs text-slate-500">
            Comprimento {length} × espessura {thickness} células · rotação {element.rotation}°
          </p>
          {estante && estante.colunasLD.length + estante.colunasLE.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-700">Pontos de acesso por lado</p>
              {(["A", "B"] as Face[])
                .filter((f) => (f === "A" ? element.faceAEnabled : element.faceBEnabled))
                .map((face) => (
                  <div key={face} className="space-y-1">
                    <p className="text-xs text-slate-500">
                      {FACE_SIDE[face]} · {faceSideLabel(element, face)}
                    </p>
                    <SlotChips element={element} estante={estante} face={face} reachability={reachability} />
                  </div>
                ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {AREA_TYPES.includes(element.type) ? (
            <label className="block text-xs text-slate-600">
              Tipo
              <select
                className={inputCls}
                value={element.type}
                onChange={(ev) => {
                  const type = ev.target.value as FloorElement["type"];
                  // Rótulo padrão do tipo antigo não faz sentido no novo.
                  const label = element.label === ELEMENT_LABELS[element.type] ? null : element.label;
                  onChange({ type, label });
                }}
              >
                {AREA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "RECEIVING_AREA" ? "Recebimento (conferência)" : ELEMENT_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs text-slate-600">
            Rótulo
            <input
              className={inputCls}
              value={element.label ?? ""}
              maxLength={60}
              placeholder={ELEMENT_LABELS[element.type]}
              onChange={(ev) => onChange({ label: ev.target.value || null })}
            />
          </label>
          {element.type === "OBSTACLE" ? (
            <div className="space-y-1">
              <p className="text-xs text-slate-600">Tipo de obstáculo</p>
              <div className="flex flex-wrap gap-1.5">
                {OBSTACLE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    title={`${p.label}: ${p.widthM} × ${p.heightM} m`}
                    onClick={() =>
                      onChange({
                        label: p.label,
                        width: Math.max(1, Math.round((p.widthM * 100) / cellSizeCm)),
                        height: Math.max(1, Math.round((p.heightM * 100) / cellSizeCm)),
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-xs font-medium ${
                      element.label === p.label ? "border-[#0d9488] bg-teal-50 text-teal-800" : "bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            {element.type === "START_POINT"
              ? "Saída do separador: onde ele pega a cesta e começa o picking. Pode ter várias; a rota parte da mais próxima do primeiro item."
              : element.type === "PACKING_POINT"
                ? "Entrega final: onde o separador deixa as cestas. Pode ter vários; a rota termina no packing mais próximo do último item."
                : element.type === "DOCK"
                  ? "Onde o caminhão descarrega. Sem área de recebimento na planta, a armazenagem parte daqui."
                  : element.type === "RECEIVING_AREA"
                    ? "Onde a carga é conferida (bipada) e fica aguardando. A armazenagem no pulmão parte daqui, pelo corredor livre mais próximo da borda."
                    : "Área bloqueada: as rotas desviam dela."}
          </p>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={element.x} min={0} max={400} onChange={(v) => onChange({ x: v })} />
        <NumberField label="Y" value={element.y} min={0} max={400} onChange={(v) => onChange({ y: v })} />
        <SizeStepper
          label="Largura"
          value={element.width}
          cellSizeCm={cellSizeCm}
          onChange={(v) => onChange({ width: v })}
        />
        <SizeStepper
          label="Altura"
          value={element.height}
          cellSizeCm={cellSizeCm}
          onChange={(v) => onChange({ height: v })}
        />
      </div>
      <p className="text-[11px] text-slate-400">
        Arraste as alças dos cantos e lados no mapa, ou use Alt + setas, para aumentar e diminuir.
      </p>
    </div>
  );
}

function SizeStepper({
  label,
  value,
  cellSizeCm,
  onChange,
}: {
  label: string;
  value: number;
  cellSizeCm: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.max(1, Math.min(400, Math.round(v))));
  const btn = "grid h-8 w-8 flex-none place-items-center rounded-md border bg-white text-base font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
  return (
    <div className="text-xs text-slate-600">
      <span>
        {label} <span className="text-slate-400">· {formatMeters((value * cellSizeCm) / 100)}</span>
      </span>
      <div className="mt-1 flex items-center gap-1">
        <button type="button" title={`Diminuir ${label.toLowerCase()}`} disabled={value <= 1} onClick={() => set(value - 1)} className={btn}>
          −
        </button>
        <input
          type="number"
          min={1}
          max={400}
          value={value}
          onChange={(ev) => {
            const n = Number(ev.target.value);
            if (Number.isFinite(n) && n >= 1) set(n);
          }}
          className="h-8 w-full min-w-0 rounded-md border px-1 text-center text-sm"
        />
        <button type="button" title={`Aumentar ${label.toLowerCase()}`} onClick={() => set(value + 1)} className={btn}>
          +
        </button>
      </div>
    </div>
  );
}

export function ValidationPanel({
  validation,
  validating,
  onFocusElement,
}: {
  validation: FloorPlanValidation | null;
  validating: boolean;
  onFocusElement: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Validação</h3>
        {validating ? <span className="text-xs text-slate-400">verificando…</span> : null}
      </div>
      {validation ? (
        <>
          <p className="text-xs text-slate-500">
            {validation.reachableAccessPoints} de {validation.totalAccessPoints} pontos de acesso alcançáveis
          </p>
          {validation.issues.length === 0 ? (
            <p className="flex items-start gap-2 text-sm text-teal-700">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-teal-600" />
              Planta válida.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {validation.issues.map((issue, i) => {
                const target = issue.elementIds?.[0];
                return (
                  <li key={`${issue.code}-${i}`} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                        issue.severity === "error" ? "bg-red-600" : "bg-amber-500"
                      }`}
                    />
                    {target ? (
                      <button
                        type="button"
                        onClick={() => onFocusElement(target)}
                        className="text-left hover:underline"
                      >
                        {issue.message}
                      </button>
                    ) : (
                      <span>{issue.message}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-400">Sem resultado ainda.</p>
      )}
    </div>
  );
}

export function RoutePanel({
  orderId,
  onOrderIdChange,
  onSimulate,
  loading,
  error,
  route,
}: {
  orderId: string;
  onOrderIdChange: (v: string) => void;
  onSimulate: () => void;
  loading: boolean;
  error: string | null;
  route: RoutePreview | null;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Simular rota de separação</h3>
      <p className="text-xs text-slate-500">
        Usa a planta como está na tela (mesmo sem salvar) e as localizações alocadas do pedido.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSimulate();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm"
          placeholder="Número do pedido"
          value={orderId}
          onChange={(ev) => onOrderIdChange(ev.target.value)}
        />
        <button
          type="submit"
          disabled={loading || !orderId.trim()}
          className="rounded-lg bg-[#0d9488] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "…" : "Simular"}
        </button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {route ? (
        <div className="space-y-2">
          {route.orderLabel ? <p className="text-xs text-slate-500">Pedido {route.orderLabel}</p> : null}
          <ol className="divide-y text-sm">
            <li className="flex items-center gap-2 py-1.5 text-slate-500">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[11px]">·</span>
              {route.startLabel ?? "Início"}
            </li>
            {route.stops.map((s, i) => (
              <li key={`${s.locationId}-${i}`} className="flex items-center gap-2 py-1.5">
                <span
                  className="grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-semibold text-white"
                  style={{ background: ROUTE_COLOR }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.label}</span>
                <span className="text-xs text-slate-500">{formatMeters(s.distanceMeters)}</span>
              </li>
            ))}
            {route.toPackingMeters != null ? (
              <li className="flex items-center gap-2 py-1.5 text-slate-500">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[11px]">·</span>
                <span className="flex-1">{route.packingLabel ?? "Packing"}</span>
                <span className="text-xs">{formatMeters(route.toPackingMeters)}</span>
              </li>
            ) : null}
          </ol>
          <div className="flex justify-between border-t pt-2 text-sm font-semibold">
            <span>Distância total</span>
            <span>{formatMeters(route.totalMeters)}</span>
          </div>
          {route.unmapped.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-red-700">Fora da planta (usam a rota antiga)</p>
              {route.unmapped.map((label) => (
                <p key={label} className="font-mono text-xs text-red-700">
                  {label}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function optionalInt(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Parte de uma estante: faixa de colunas por lado e divisão em duas partes com corredor no meio. */
function GondolaPartsSection({
  element,
  view,
  allColunas,
  cellSizeCm,
  onChangeRange,
  onSplit,
}: {
  element: FloorElement;
  view: FloorPlanEstante;
  allColunas: Record<Face, string[]>;
  cellSizeCm: number;
  onChangeRange: (patch: Partial<FloorElement>) => void;
  onSplit: (firstCount: number, gapCells: number) => boolean;
}) {
  const faces = (["A", "B"] as Face[]).filter(
    (f) => (f === "A" ? element.faceAEnabled : element.faceBEnabled) && allColunas[f].length > 0,
  );
  const total = Math.max(0, ...faces.map((f) => faceColunas(view, f).length));
  const [firstCount, setFirstCount] = useState(Math.ceil(total / 2));
  const [gapCells, setGapCells] = useState(3);
  const [splitError, setSplitError] = useState<string | null>(null);
  if (!faces.length) return null;

  return (
    <div className="space-y-2 rounded-lg border bg-slate-50 p-2.5">
      <p className="text-xs font-semibold text-slate-700">Partes da estante</p>
      {faces.map((face) => {
        const range = faceColunaRange(element, face);
        const field = (key: "min" | "max") => (face === "A" ? (key === "min" ? "colunaMinA" : "colunaMaxA") : key === "min" ? "colunaMinB" : "colunaMaxB");
        return (
          <div key={face} className="flex items-end gap-2 text-xs text-slate-600">
            <span className="w-24 pb-2 font-medium">
              Colunas do {FACE_SIDE[face]}
            </span>
            {(["min", "max"] as const).map((key) => (
              <label key={key} className="block flex-1">
                {key === "min" ? "de" : "até"}
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  placeholder={key === "min" ? allColunas[face][0] : allColunas[face][allColunas[face].length - 1]}
                  value={range[key] ?? ""}
                  onChange={(ev) => onChangeRange({ [field(key)]: optionalInt(ev.target.value) })}
                />
              </label>
            ))}
          </div>
        );
      })}
      <p className="text-xs text-slate-500">
        Em branco = todas. Esta gôndola atende{" "}
        {faces.map((f) => `${FACE_SIDE[f]} ${formatColunas(faceColunas(view, f)) || "nenhuma"}`).join(" · ")}.
      </p>
      {total >= 2 ? (
        <div className="space-y-1.5 border-t pt-2">
          <p className="text-xs text-slate-500">
            Rua com corredor no meio? Divida em parte 1 e parte 2: as duas continuam com o mesmo nome e o corredor entre
            elas entra na rota.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Colunas na parte 1" value={Math.min(firstCount, total - 1)} min={1} max={total - 1} onChange={setFirstCount} />
            <NumberField
              label={`Corredor (células · ${formatMeters((gapCells * cellSizeCm) / 100)})`}
              value={gapCells}
              min={1}
              max={40}
              onChange={setGapCells}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSplitError(null);
              if (!onSplit(Math.min(firstCount, total - 1), gapCells)) setSplitError("Não foi possível dividir esta gôndola.");
            }}
            className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Dividir em 2 partes
          </button>
          {splitError ? <p className="text-xs text-red-600">{splitError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ColunaDirectionToggle({
  colunas,
  reversed,
  onChange,
}: {
  colunas: string[];
  reversed: boolean;
  onChange: (reversed: boolean) => void;
}) {
  if (colunas.length < 2) return null;
  const first = colunas[0];
  const last = colunas[colunas.length - 1];
  const options = [
    { value: false, label: `${first} → ${last}` },
    { value: true, label: `${last} → ${first}` },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-slate-50 p-0.5 text-xs" role="group" aria-label="Sentido das colunas">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={reversed === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-0.5 font-mono ${
            reversed === o.value ? "bg-white text-[#0d9488] shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GondolaElevation({ element, estante }: { element: FloorElement; estante: FloorPlanEstante }) {
  const faces = (["A", "B"] as Face[]).filter(
    (f) => (f === "A" ? element.faceAEnabled : element.faceBEnabled) && faceColunas(estante, f).length > 0,
  );
  const niveis = Math.max(1, estante.linhas);
  const cw = 26;
  const ch = 16;
  const left = 24;
  const top = 6;
  const h = top + niveis * ch + 18;

  if (faces.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Vista frontal · Estante {estante.code}</h3>
      <p className="text-xs text-slate-500">
        Cada caixa é uma posição (coluna × linha). A coluna muda o ponto de acesso no chão; a linha é a altura.
      </p>
      <div className={`grid gap-6 ${faces.length > 1 ? "md:grid-cols-2" : ""}`}>
        {faces.map((face) => {
          const onFloor = colunasOnFloor(element, face, faceColunas(estante, face));
          // Olhando de frente para o LE, a ordem do chão aparece espelhada.
          const colunas = face === "A" ? onFloor : [...onFloor].reverse();
          const w = left + colunas.length * cw + 4;
          return (
          <div key={face} className="space-y-1">
            <p className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: FACE_COLORS[face] }} />
              {FACE_SIDE[face]}
            </p>
            <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-xl" role="img" aria-label={`Vista frontal ${FACE_SIDE[face]}`}>
              {Array.from({ length: niveis }, (_, ri) => {
                const linha = niveis - ri;
                return (
                  <g key={linha}>
                    <text x={left - 6} y={top + ri * ch + ch / 2} fontSize={7} textAnchor="end" dominantBaseline="central" fill="#64748b">
                      {linha}
                    </text>
                    {colunas.map((code, li) => (
                      <rect
                        key={code}
                        x={left + li * cw + 1}
                        y={top + ri * ch + 1}
                        width={cw - 2}
                        height={ch - 2}
                        rx={2}
                        fill={FACE_COLORS[face]}
                        fillOpacity={0.15}
                        stroke="#cbd5e1"
                        strokeWidth={0.6}
                      >
                        <title>{`${estante.code}-${FACE_SIDE[face]}-${code}-${linha}`}</title>
                      </rect>
                    ))}
                  </g>
                );
              })}
              {colunas.map((code, li) => (
                <text
                  key={code}
                  x={left + li * cw + cw / 2}
                  y={top + niveis * ch + 8}
                  fontSize={7}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#64748b"
                >
                  {code}
                </text>
              ))}
            </svg>
          </div>
          );
        })}
      </div>
    </div>
  );
}
