"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { formatMarketplace } from "@wms/shared";
import { DataState } from "@/components/ops/data-state";
import { FloorPlanCanvas } from "@/components/warehouse/floor-plan/floor-plan-canvas";
import {
  alongAxis,
  computeReachability,
  faceColunas,
  faceHalfRect,
  gondolaGeometry,
  gondolaView,
  slotIndexOnFloor,
  type Face,
} from "@/components/warehouse/floor-plan/geometry";
import { APPROACH_COLORS } from "@/components/warehouse/floor-plan/approach-geometry";
import type { FloorElement, FloorPlanEstante } from "@/lib/api/floor-plan";
import { releaseWave } from "@/lib/api/waves";
import {
  colunaKey,
  createWaveTemplate,
  deleteWaveTemplate,
  fetchWaveMap,
  selectionKey,
  updateWaveTemplate,
  type WaveMapData,
  type WaveMapSelectionEntry,
  type WaveTemplate,
} from "@/lib/api/wave-map";

type LoadedMap = Extract<WaveMapData, { plan: unknown }>;

type Slot = {
  key: string;
  estanteId: string;
  face: Face;
  coluna: string;
  label: string;
  rect: { x: number; y: number; width: number; height: number };
};

const SELECTED_COLOR = "#2563eb";
const HAS_ORDERS_COLOR = "#16a34a";
const NO_ORDERS_COLOR = "#ef4444";

function faceEstanteId(e: FloorElement, face: Face): string | null {
  return (face === "B" ? e.estanteIdB || e.estanteId : e.estanteId) || null;
}

/** Retângulo de cada coluna (por lado) das gôndolas, na mesma divisão que o desenho da planta. */
function buildSlots(elements: FloorElement[], estantes: Map<string, FloorPlanEstante>): Slot[] {
  const out: Slot[] = [];
  for (const e of elements) {
    if (e.type !== "GONDOLA") continue;
    const view = gondolaView(e, estantes);
    const { horizontal, length } = gondolaGeometry(e);
    for (const face of ["A", "B"] as Face[]) {
      if (face === "A" ? !e.faceAEnabled : !e.faceBEnabled) continue;
      const estanteId = faceEstanteId(e, face);
      if (!estanteId) continue;
      const code = estantes.get(estanteId)?.code ?? "?";
      const slots = faceColunas(view, face);
      const half = faceHalfRect(e, face);
      slots.forEach((coluna, i) => {
        const idx = slotIndexOnFloor(e, face, i, slots.length);
        const a = alongAxis(e, (idx * length) / slots.length);
        const b = alongAxis(e, ((idx + 1) * length) / slots.length);
        const lo = Math.min(a, b);
        const size = Math.abs(b - a);
        out.push({
          key: colunaKey({ estanteId, face, coluna }),
          estanteId,
          face,
          coluna,
          label: `${code} ${face === "A" ? "LD" : "LE"} · coluna ${coluna}`,
          rect: horizontal
            ? { x: lo, y: half.y, width: size, height: half.height }
            : { x: half.x, y: lo, width: half.width, height: size },
        });
      });
    }
  }
  return out;
}

function slotAt(slots: Slot[], px: number, py: number): Slot | null {
  for (const s of slots) {
    const r = s.rect;
    if (px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height) return s;
  }
  return null;
}

function parseKey(key: string): WaveMapSelectionEntry {
  const [estanteId, face, coluna, linha] = key.split("|");
  return { estanteId: estanteId!, face: face as Face, coluna: coluna!, linha: linha === "*" ? null : linha! };
}

const byCode = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

export function WaveMapBuilder({
  marketplace,
  onCreated,
  onUseInList,
}: {
  marketplace: string;
  onCreated: (message: string) => void;
  onUseInList: (orderIds: string[]) => void;
}) {
  const [barracaoId, setBarracaoId] = useState("");
  const [data, setData] = useState<WaveMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [template, setTemplate] = useState<WaveTemplate | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateColor, setTemplateColor] = useState(APPROACH_COLORS[0]!);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchWaveMap({ barracaoId: barracaoId || undefined, marketplace: marketplace || undefined });
      setData(d);
      if (!barracaoId && d.barracao) setBarracaoId(d.barracao.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar o mapa");
    } finally {
      setLoading(false);
    }
  }, [barracaoId, marketplace]);

  useEffect(() => {
    void load();
  }, [load]);

  const map = data && data.barracao ? (data as LoadedMap) : null;

  const estantes = useMemo(() => new Map((map?.estantes ?? []).map((e) => [e.id, e])), [map]);
  const slots = useMemo(() => (map ? buildSlots(map.plan.elements, estantes) : []), [map, estantes]);
  const slotByKey = useMemo(() => new Map(slots.map((s) => [s.key, s])), [slots]);
  const reachability = useMemo(
    () => computeReachability(map?.plan.elements ?? [], map?.plan.widthCells ?? 1, map?.plan.heightCells ?? 1),
    [map],
  );
  const ordersById = useMemo(() => new Map((map?.orders ?? []).map((o) => [o.id, o])), [map]);

  /** Linhas cadastradas de cada coluna; completa com as que têm pedido (caso a estrutura esteja incompleta). */
  const linhasByColuna = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of map?.colunas ?? []) m.set(colunaKey(c), new Set(c.linhas));
    for (const c of map?.cells ?? []) {
      const k = colunaKey(c);
      const set = m.get(k) ?? new Set<string>();
      set.add(c.linha);
      m.set(k, set);
    }
    return new Map([...m].map(([k, v]) => [k, [...v].sort(byCode)]));
  }, [map]);

  const ordersByColuna = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of map?.cells ?? []) {
      const k = colunaKey(c);
      const set = m.get(k) ?? new Set<string>();
      for (const id of c.orderIds) set.add(id);
      m.set(k, set);
    }
    return m;
  }, [map]);

  const ordersByLinha = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of map?.cells ?? []) {
      const k = selectionKey(c, c.linha);
      const set = m.get(k) ?? new Set<string>();
      for (const id of c.orderIds) set.add(id);
      m.set(k, set);
    }
    return m;
  }, [map]);

  const matchedOrderIds = useMemo(() => {
    const out = new Set<string>();
    for (const c of map?.cells ?? []) {
      if (selected.has(selectionKey(c, null)) || selected.has(selectionKey(c, c.linha))) {
        for (const id of c.orderIds) out.add(id);
      }
    }
    return [...out];
  }, [map, selected]);

  const matchedOrders = useMemo(
    () => matchedOrderIds.map((id) => ordersById.get(id)).filter((o): o is NonNullable<typeof o> => Boolean(o)),
    [matchedOrderIds, ordersById],
  );

  const marketplaces = useMemo(() => [...new Set(matchedOrders.map((o) => o.marketplace ?? null))], [matchedOrders]);
  const releaseMarketplace =
    marketplace || (marketplaces.length === 1 ? (marketplaces[0] ?? "SEM_MARKETPLACE") : undefined);

  /** Estado de cada coluna: inteira, algumas linhas ou nada. */
  const colunaState = useCallback(
    (key: string): "whole" | "partial" | null => {
      const slot = slotByKey.get(key);
      if (!slot) return null;
      if (selected.has(selectionKey(slot, null))) return "whole";
      const linhas = linhasByColuna.get(key) ?? [];
      return linhas.some((l) => selected.has(selectionKey(slot, l))) ? "partial" : null;
    },
    [selected, slotByKey, linhasByColuna],
  );

  const clearColuna = (next: Set<string>, slot: Pick<Slot, "estanteId" | "face" | "coluna">) => {
    next.delete(selectionKey(slot, null));
    for (const l of linhasByColuna.get(colunaKey(slot)) ?? []) next.delete(selectionKey(slot, l));
  };

  const toggleColuna = (slot: Slot) => {
    setFocusKey(slot.key);
    setSelected((prev) => {
      const next = new Set(prev);
      if (colunaState(slot.key)) clearColuna(next, slot);
      else next.add(selectionKey(slot, null));
      return next;
    });
  };

  const toggleLinha = (slot: Slot, linha: string) => {
    const all = linhasByColuna.get(slot.key) ?? [];
    setSelected((prev) => {
      const next = new Set(prev);
      const whole = selectionKey(slot, null);
      if (next.has(whole)) {
        next.delete(whole);
        for (const l of all) if (l !== linha) next.add(selectionKey(slot, l));
        return next;
      }
      const k = selectionKey(slot, linha);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      if (all.length > 0 && all.every((l) => next.has(selectionKey(slot, l)))) {
        for (const l of all) next.delete(selectionKey(slot, l));
        next.add(whole);
      }
      return next;
    });
  };

  const selectionEntries = useMemo(() => [...selected].map(parseKey), [selected]);

  const selectedColunas = useMemo(() => {
    const keys = new Set(selectionEntries.map((e) => colunaKey(e)));
    return [...keys]
      .map((k) => slotByKey.get(k))
      .filter((s): s is Slot => Boolean(s))
      .sort((a, b) => byCode(a.label, b.label));
  }, [selectionEntries, slotByKey]);

  const focus = focusKey ? (slotByKey.get(focusKey) ?? null) : null;

  const applyTemplate = (t: WaveTemplate) => {
    setTemplate(t);
    setTemplateName(t.name);
    setTemplateColor(t.color);
    setSelected(new Set(t.selection.map((s) => selectionKey(s, s.linha))));
    setFocusKey(null);
    setMessage(null);
  };

  const newSelection = () => {
    setTemplate(null);
    setTemplateName("");
    setSelected(new Set());
    setFocusKey(null);
    setMessage(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Falha na operação" });
    } finally {
      setBusy(false);
    }
  };

  const createWave = () =>
    run(async () => {
      const result = await releaseWave({
        orderIds: matchedOrderIds,
        auto: false,
        partitionStrategy: "SINGLE_WAVE",
        marketplace: releaseMarketplace,
        templateId: template?.id,
      });
      const kind = template ? `da onda fixa "${template.name}"` : "temporária";
      const text = `Onda ${kind} criada com ${result.orderCount} pedido(s) → ${result.lineCount} linha(s). Ela já aparece em "Ondas ativas".`;
      onCreated(text);
      if (!template) setSelected(new Set());
      await load();
      setMessage({ tone: "ok", text });
    });

  const saveTemplate = () =>
    run(async () => {
      if (!map) return;
      if (template) {
        const { template: saved } = await updateWaveTemplate(template.id, {
          name: templateName,
          color: templateColor,
          selection: selectionEntries,
        });
        setTemplate(saved);
        setMessage({ tone: "ok", text: `Onda fixa "${saved.name}" atualizada.` });
      } else {
        const { template: saved } = await createWaveTemplate({
          barracaoId: map.barracao.id,
          name: templateName,
          color: templateColor,
          selection: selectionEntries,
        });
        setTemplate(saved);
        setMessage({ tone: "ok", text: `Onda fixa "${saved.name}" salva. Gere quando quiser com os pedidos do momento.` });
      }
      await load();
    });

  const removeTemplate = (t: WaveTemplate) =>
    run(async () => {
      if (!window.confirm(`Excluir a onda fixa "${t.name}"? As ondas já geradas continuam.`)) return;
      await deleteWaveTemplate(t.id);
      if (template?.id === t.id) newSelection();
      await load();
    });

  const toggleTemplateActive = (t: WaveTemplate) =>
    run(async () => {
      await updateWaveTemplate(t.id, { active: !t.active });
      await load();
    });

  const templateMatchCount = useCallback(
    (t: WaveTemplate) => {
      const keys = new Set(t.selection.map((s) => selectionKey(s, s.linha)));
      const ids = new Set<string>();
      for (const c of map?.cells ?? []) {
        if (keys.has(selectionKey(c, null)) || keys.has(selectionKey(c, c.linha))) c.orderIds.forEach((id) => ids.add(id));
      }
      return ids.size;
    },
    [map],
  );

  const overlay = (
    <g>
      {slots.map((s) => {
        const state = colunaState(s.key);
        const count = ordersByColuna.get(s.key)?.size ?? 0;
        const { x, y, width, height } = s.rect;
        const inset = 0.04;
        const short = Math.min(width, height);
        const fill = state ? SELECTED_COLOR : count > 0 ? HAS_ORDERS_COLOR : NO_ORDERS_COLOR;
        const opacity = state === "whole" ? 0.5 : state === "partial" ? 0.28 : count > 0 ? 0.3 : 0.1;
        const badgeR = Math.min(0.3, short * 0.24);
        return (
          <g key={s.key}>
            <rect
              x={x + inset}
              y={y + inset}
              width={Math.max(0.05, width - inset * 2)}
              height={Math.max(0.05, height - inset * 2)}
              fill="#fff"
            />
            <rect
              x={x + inset}
              y={y + inset}
              width={Math.max(0.05, width - inset * 2)}
              height={Math.max(0.05, height - inset * 2)}
              fill={fill}
              fillOpacity={opacity}
              stroke={s.key === focusKey ? "#0f172a" : state ? SELECTED_COLOR : "none"}
              strokeWidth={s.key === focusKey ? 0.12 : 0.07}
              strokeDasharray={state === "partial" ? "0.2 0.12" : undefined}
            >
              <title>{`${s.label} — ${count} pedido(s)`}</title>
            </rect>
            <text
              x={x + width / 2}
              y={y + height / 2}
              fontSize={Math.min(0.5, short * 0.42)}
              textAnchor="middle"
              dominantBaseline="central"
              fill={count > 0 || state ? "#0f172a" : "#94a3b8"}
              fontWeight={count > 0 || state ? 600 : 400}
              pointerEvents="none"
            >
              {s.coluna}
            </text>
            {count > 0 ? (
              <g pointerEvents="none">
                <circle
                  cx={x + width - badgeR - 0.07}
                  cy={y + badgeR + 0.07}
                  r={badgeR}
                  fill={state ? SELECTED_COLOR : HAS_ORDERS_COLOR}
                />
                <text
                  x={x + width - badgeR - 0.07}
                  y={y + badgeR + 0.07}
                  fontSize={badgeR * (count > 99 ? 0.8 : count > 9 ? 1.05 : 1.3)}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                >
                  {count}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );

  return (
    <DataState loading={loading && !data} error={error} empty={false}>
      {data && !data.barracao ? (
        <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">
          Nenhum barracão tem mapa salvo. Monte a planta em Layout do galpão → Mapa do galpão para escolher as colunas aqui.
        </p>
      ) : map ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {map.barracoes.length > 1
              ? map.barracoes.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setBarracaoId(b.id);
                      newSelection();
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      b.id === map.barracao.id ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-white text-slate-700"
                    }`}
                  >
                    {b.code}
                    {b.name ? <span className="ml-1 font-normal text-slate-500">— {b.name}</span> : null}
                  </button>
                ))
              : null}
            <span className="text-sm text-muted-foreground">
              {map.orders.length} pedido(s) sem onda com item neste barracão
              {map.unmappedOrderCount > 0 ? ` · ${map.unmappedOrderCount} sem posição no mapa` : ""}
            </span>
            <div className="ml-auto flex items-center gap-3 text-xs text-slate-600">
              <span className="flex items-center gap-1">
                <span className="h-3.5 w-3.5 rounded-sm" style={{ background: "#16a34a4d" }} />
                <span
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                  style={{ background: HAS_ORDERS_COLOR }}
                >
                  2
                </span>
                tem pedido · nº de pedidos
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3.5 w-3.5 rounded-sm" style={{ background: "#ef44441a" }} /> sem pedido
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3.5 w-3.5 rounded-sm border" style={{ background: "#2563eb80", borderColor: SELECTED_COLOR }} /> selecionada
              </span>
              <button
                type="button"
                title="Diminuir"
                onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                className="rounded border bg-white p-1"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Aumentar"
                onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
                className="rounded border bg-white p-1"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="max-h-[70vh] overflow-auto rounded-xl border bg-white p-2 shadow-sm">
              <FloorPlanCanvas
                widthCells={map.plan.widthCells}
                heightCells={map.plan.heightCells}
                elements={map.plan.elements}
                estantes={estantes}
                selectedId={null}
                tool="select"
                interactive={false}
                zoom={zoom}
                reachability={reachability}
                issueElementIds={new Set()}
                route={null}
                overlay={overlay}
                onSelect={() => {}}
                onPlace={() => {}}
                onElementChange={() => {}}
                onDragEnd={() => {}}
                onPointClick={(x, y) => {
                  const slot = slotAt(slots, x, y);
                  if (slot) toggleColuna(slot);
                }}
              />
            </div>

            <aside className="space-y-4 text-sm">
              <section className="space-y-2 rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="font-semibold">Linhas da coluna</h3>
                {focus ? (
                  <>
                    <p className="text-xs text-slate-600">{focus.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(linhasByColuna.get(focus.key) ?? []).map((l) => {
                        const on =
                          selected.has(selectionKey(focus, null)) || selected.has(selectionKey(focus, l));
                        const n = ordersByLinha.get(selectionKey(focus, l))?.size ?? 0;
                        return (
                          <button
                            key={l}
                            type="button"
                            onClick={() => toggleLinha(focus, l)}
                            className={`rounded-md border px-2 py-1 text-xs font-medium ${
                              on ? "border-blue-600 bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            L{l}
                            {n > 0 ? <span className={on ? "ml-1 text-blue-100" : "ml-1 text-green-700"}>· {n}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-500">Clique nas linhas para escolher só algumas. O número é a quantidade de pedidos.</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    Clique numa coluna da gôndola no mapa para marcar a coluna inteira; depois ajuste as linhas aqui.
                  </p>
                )}
              </section>

              <section className="space-y-2 rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">
                    Seleção {template ? <span className="font-normal text-slate-500">— {template.name}</span> : null}
                  </h3>
                  {selected.size > 0 || template ? (
                    <button type="button" onClick={newSelection} className="text-xs text-slate-500 underline">
                      Limpar
                    </button>
                  ) : null}
                </div>
                {selectedColunas.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhuma coluna marcada.</p>
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-auto">
                    {selectedColunas.map((s) => {
                      const whole = selected.has(selectionKey(s, null));
                      const linhas = whole
                        ? "inteira"
                        : `linhas ${(linhasByColuna.get(s.key) ?? []).filter((l) => selected.has(selectionKey(s, l))).join(", ")}`;
                      return (
                        <li key={s.key} className="flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1">
                          <button type="button" onClick={() => setFocusKey(s.key)} className="flex-1 truncate text-left text-xs">
                            <span className="font-medium">{s.label}</span> <span className="text-slate-500">({linhas})</span>
                          </button>
                          <button
                            type="button"
                            title="Remover"
                            onClick={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                clearColuna(next, s);
                                return next;
                              })
                            }
                            className="rounded p-0.5 text-slate-500 hover:bg-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="rounded-lg bg-teal-50 px-3 py-2">
                  <p className="font-semibold text-teal-900">{matchedOrders.length} pedido(s) entram na onda</p>
                  <p className="text-xs text-teal-800">Pedidos com pelo menos 1 item nas colunas/linhas marcadas.</p>
                  {matchedOrders.length > 0 ? (
                    <p className="mt-1 max-h-16 overflow-auto font-mono text-[11px] text-slate-700">
                      {matchedOrders.map((o) => o.erpOrderId).join(" · ")}
                    </p>
                  ) : null}
                </div>
                {marketplaces.length > 1 && !marketplace ? (
                  <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    Pedidos de lojas diferentes ({marketplaces.map((m) => (m ? formatMarketplace(m) : "sem loja")).join(", ")}).
                    Escolha o marketplace no filtro acima.
                  </p>
                ) : null}

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={busy || matchedOrders.length === 0 || !releaseMarketplace}
                    onClick={() => void createWave()}
                    className="rounded-lg bg-[#0d9488] px-3 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? "Aguarde…" : template ? `Gerar onda de "${template.name}" agora` : "Criar onda temporária agora"}
                  </button>
                  <button
                    type="button"
                    disabled={matchedOrders.length === 0}
                    onClick={() => onUseInList(matchedOrderIds)}
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    Ver/ajustar estes pedidos na lista
                  </button>
                </div>
                {message ? (
                  <p
                    className={`rounded-lg border p-2 text-xs ${
                      message.tone === "ok"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-red-200 bg-red-50 text-red-800"
                    }`}
                  >
                    {message.text}
                  </p>
                ) : null}
              </section>

              <section className="space-y-2 rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="flex items-center gap-1 font-semibold">
                  <Bookmark className="h-4 w-4" /> {template ? "Editar onda fixa" : "Salvar como onda fixa"}
                </h3>
                <p className="text-xs text-slate-500">
                  A onda fixa guarda estas colunas/linhas. Cada vez que você gerar, ela pega os pedidos pendentes do momento.
                </p>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Nome (ex.: Corredor E manhã)"
                  maxLength={60}
                  className="w-full rounded-md border px-2 py-1.5"
                />
                <div className="flex flex-wrap gap-1.5">
                  {APPROACH_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      onClick={() => setTemplateColor(c)}
                      className={`h-5 w-5 rounded-full ${templateColor === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busy || selected.size === 0 || !templateName.trim()}
                  onClick={() => void saveTemplate()}
                  className="w-full rounded-lg border border-[#0d9488] px-3 py-1.5 font-semibold text-[#0d9488] disabled:opacity-50"
                >
                  {template ? "Salvar alterações" : "Salvar onda fixa"}
                </button>
              </section>

              <section className="space-y-2 rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="font-semibold">Ondas fixas deste barracão</h3>
                {map.templates.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhuma ainda.</p>
                ) : (
                  <ul className="space-y-1">
                    {map.templates.map((t) => (
                      <li
                        key={t.id}
                        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                          template?.id === t.id ? "border-teal-400 bg-teal-50" : ""
                        }`}
                      >
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                        <button type="button" onClick={() => applyTemplate(t)} className="flex-1 truncate text-left">
                          <span className={`font-medium ${t.active ? "" : "text-slate-400 line-through"}`}>{t.name}</span>
                          <span className="ml-1 text-xs text-slate-500">· {templateMatchCount(t)} pedido(s) agora</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleTemplateActive(t)}
                          className="text-xs text-slate-500 underline"
                        >
                          {t.active ? "Desativar" : "Ativar"}
                        </button>
                        <button
                          type="button"
                          title="Excluir"
                          onClick={() => void removeTemplate(t)}
                          className="rounded p-0.5 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        </div>
      ) : null}
    </DataState>
  );
}
