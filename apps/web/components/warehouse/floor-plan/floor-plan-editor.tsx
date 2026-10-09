"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipboardCheck, DoorOpen, Flag, MousePointer2, Package, Square, Warehouse } from "lucide-react";
import { DataState } from "@/components/ops/data-state";
import {
  fetchFloorPlan,
  previewFloorPlanRoute,
  saveFloorPlan,
  setEstanteFace,
  updateEstanteStructure,
  validateFloorPlan,
  type EstanteStructureBody,
  type FloorElement,
  type FloorElementType,
  type FloorPlanEditorData,
  type FloorPlanEstante,
  type FloorPlanValidation,
  type RoutePreview,
} from "@/lib/api/floor-plan";
import {
  fetchApproachWaves,
  saveApproachWaves,
  type ApproachWave,
  type ApproachWaveKind,
} from "@/lib/api/approach-waves";
import { BASE_CELL_PX, FloorPlanCanvas, type FloorTool } from "./floor-plan-canvas";
import { ZoomViewport } from "./zoom-viewport";
import { ApproachOverlay } from "./approach-overlay";
import { ApproachWavesPanel, type ApproachPick } from "./approach-waves-panel";
import { sameStop, stopFromPoint } from "./approach-geometry";
import {
  ElementPropertiesPanel,
  GondolaElevation,
  PlanSettingsPanel,
  RoutePanel,
  UnplacedEstantesPanel,
  ValidationPanel,
} from "./floor-plan-panels";
import {
  FACE_COLORS,
  ROUTE_COLOR,
  SINGLETON_TYPES,
  arrangeEstantes,
  clampElement,
  computeReachability,
  createElement,
  elementAt,
  elementEstanteIds,
  formatMeters,
  gondolaForEstante,
  gondolaGeometry,
  gondolaView,
  isBlocking,
  overlapsEstante,
  type Face,
  rotateElement,
  splitGondola,
  toDraft,
} from "./geometry";

type Mode = "edit" | "route" | "approach";

const MODE_LABELS: Record<Mode, string> = {
  edit: "Editar planta",
  route: "Simular rota",
  approach: "Ondas de aproximação",
};

const TOOLS: Array<{ id: FloorTool; title: string; icon: ReactNode }> = [
  { id: "select", title: "Selecionar e mover (V)", icon: <MousePointer2 className="h-4 w-4" /> },
  { id: "GONDOLA", title: "Gôndola (clique na planta)", icon: <Warehouse className="h-4 w-4" /> },
  {
    id: "OBSTACLE",
    title: "Obstáculo: pilar, parede, mesa… (clique ou arraste para desenhar)",
    icon: <Square className="h-4 w-4" />,
  },
  {
    id: "START_POINT",
    title: "Saída do separador (início do picking). Pode ter várias: a rota parte da mais próxima",
    icon: <Flag className="h-4 w-4" />,
  },
  {
    id: "PACKING_POINT",
    title: "Packing (entrega final). Pode ter vários: a rota termina no mais próximo (clique ou arraste)",
    icon: <Package className="h-4 w-4" />,
  },
  { id: "DOCK", title: "Doca (clique ou arraste)", icon: <DoorOpen className="h-4 w-4" /> },
  {
    id: "RECEIVING_AREA",
    title: "Recebimento (conferência; a armazenagem parte daqui). Clique ou arraste",
    icon: <ClipboardCheck className="h-4 w-4" />,
  },
];

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

export function FloorPlanEditor({ barracaoId, onSaved }: { barracaoId: string; onSaved?: () => void }) {
  const [data, setData] = useState<FloorPlanEditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dims, setDims] = useState({ cellSizeCm: 50, widthCells: 60, heightCells: 40 });
  const [elements, setElements] = useState<FloorElement[]>([]);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<FloorTool>("select");
  const [pendingEstanteId, setPendingEstanteId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");

  const [validation, setValidation] = useState<FloorPlanValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [orderId, setOrderId] = useState("");
  const [route, setRoute] = useState<RoutePreview | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [approachKind, setApproachKind] = useState<ApproachWaveKind>("PICKING");
  const [approachWaves, setApproachWaves] = useState<ApproachWave[]>([]);
  const [approachSelected, setApproachSelected] = useState<number | null>(null);
  const [approachPick, setApproachPick] = useState<ApproachPick>(null);
  const [approachDirty, setApproachDirty] = useState(false);
  const [approachSaving, setApproachSaving] = useState(false);
  const [approachError, setApproachError] = useState<string | null>(null);

  const loadApproach = useCallback(
    async (kind: ApproachWaveKind) => {
      setApproachError(null);
      try {
        const { waves } = await fetchApproachWaves(barracaoId, kind);
        setApproachWaves(waves);
        setApproachSelected(waves.length > 0 ? 0 : null);
        setApproachPick(null);
        setApproachDirty(false);
      } catch (e) {
        setApproachError(e instanceof Error ? e.message : "Erro ao carregar ondas de aproximação");
      }
    },
    [barracaoId],
  );

  useEffect(() => {
    if (mode === "approach") void loadApproach(approachKind);
  }, [mode, approachKind, loadApproach]);

  const nextId = useRef(1);

  const applyData = useCallback((d: FloorPlanEditorData) => {
    setData(d);
    setDims({ cellSizeCm: d.plan.cellSizeCm, widthCells: d.plan.widthCells, heightCells: d.plan.heightCells });
    setElements(d.plan.elements);
    setVersion(d.plan.version);
    setValidation(d.validation);
    setDirty(false);
    setSelectedId(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchFloorPlan(barracaoId)
      .then((d) => {
        if (!cancelled) applyData(d);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Erro ao carregar planta");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [barracaoId, applyData]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const draft = useMemo(() => toDraft(dims, elements), [dims, elements]);

  useEffect(() => {
    if (!dirty) return;
    setValidating(true);
    const timer = setTimeout(() => {
      validateFloorPlan(barracaoId, draft)
        .then(setValidation)
        .catch(() => undefined)
        .finally(() => setValidating(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [barracaoId, draft, dirty]);

  const estanteById = useMemo(() => new Map((data?.estantes ?? []).map((c) => [c.id, c])), [data]);
  const usedEstanteIds = useMemo(
    () => new Set(elements.flatMap((e) => elementEstanteIds(e))),
    [elements],
  );
  const unplacedEstantes = useMemo(
    () => (data?.estantes ?? []).filter((e) => !usedEstanteIds.has(e.id)),
    [data, usedEstanteIds],
  );
  const reachability = useMemo(
    () => computeReachability(elements, dims.widthCells, dims.heightCells),
    [elements, dims.widthCells, dims.heightCells],
  );
  const issueElementIds = useMemo(
    () => new Set((validation?.issues ?? []).flatMap((i) => i.elementIds ?? [])),
    [validation],
  );

  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const selectedEstante = selected ? gondolaView(selected, estanteById) : undefined;

  const markDirty = () => {
    setDirty(true);
    setRoute(null);
  };

  const replaceElement = useCallback((element: FloorElement) => {
    setElements((prev) => prev.map((e) => (e.id === element.id ? element : e)));
  }, []);

  const patchSelected = (patch: Partial<FloorElement>) => {
    if (!selected) return;
    const updated = clampElement({ ...selected, ...patch }, dims.widthCells, dims.heightCells);
    const newType = patch.type && patch.type !== selected.type ? patch.type : null;
    setElements((prev) =>
      prev.map((e) => {
        if (e.id === selected.id) return updated;
        // Tipo único na planta: o anterior vira obstáculo.
        if (newType && SINGLETON_TYPES.has(newType) && e.type === newType) return { ...e, type: "OBSTACLE" };
        return e;
      }),
    );
    markDirty();
  };

  const rotateSelected = () => {
    if (!selected) return;
    replaceElement(clampElement(rotateElement(selected), dims.widthCells, dims.heightCells));
    markDirty();
  };

  const deleteSelected = () => {
    if (!selected) return;
    setElements((prev) => prev.filter((e) => e.id !== selected.id));
    setSelectedId(null);
    markDirty();
  };

  const placeElement = (type: FloorElementType, x: number, y: number, size?: { width: number; height: number }) => {
    const existing = SINGLETON_TYPES.has(type) ? elements.find((e) => e.type === type) : undefined;
    if (existing) {
      replaceElement(clampElement({ ...existing, x, y, ...size }, dims.widthCells, dims.heightCells));
      setSelectedId(existing.id);
    } else {
      const id = newElementId();
      const estante = type === "GONDOLA" && pendingEstanteId ? estanteById.get(pendingEstanteId) : undefined;
      const base = estante ? gondolaForEstante(estante, x, y, id) : createElement(type, x, y, id);
      const created = clampElement({ ...base, ...size }, dims.widthCells, dims.heightCells);
      setElements((prev) => [...prev, created]);
      setSelectedId(id);
    }
    setPendingEstanteId(null);
    setTool("select");
    markDirty();
  };

  const newElementId = () => `tmp-${Date.now()}-${nextId.current++}`;

  const pickEstante = (estanteId: string | null) => {
    setPendingEstanteId(estanteId);
    setSelectedId(null);
    setTool(estanteId ? "GONDOLA" : "select");
  };

  /** Ajusta comprimento e lados da gôndola às colunas das estantes vinculadas. */
  const fitGondola = (e: FloorElement, estantes: Map<string, FloorPlanEstante>): FloorElement => {
    const view = gondolaView(e, estantes);
    if (!view) return e;
    const sized = gondolaForEstante(view, e.x, e.y, e.id);
    const { horizontal } = gondolaGeometry(e);
    return clampElement(
      {
        ...e,
        width: horizontal ? sized.width : e.width,
        height: horizontal ? e.height : sized.width,
        faceAEnabled: sized.faceAEnabled,
        faceBEnabled: sized.faceBEnabled,
      },
      dims.widthCells,
      dims.heightCells,
    );
  };

  /** Recarrega só as estantes (mantém o desenho não salvo) e reajusta as gôndolas dessas estantes. */
  const refreshEstantes = async (estanteIds: string[]) => {
    const fresh = await fetchFloorPlan(barracaoId);
    setData((prev) => (prev ? { ...prev, estantes: fresh.estantes } : fresh));
    const map = new Map(fresh.estantes.map((c) => [c.id, c]));
    let changed = false;
    setElements((prev) =>
      prev.map((e) => {
        if (!elementEstanteIds(e).some((id) => estanteIds.includes(id))) return e;
        const next = fitGondola(e, map);
        changed ||=
          next.width !== e.width ||
          next.height !== e.height ||
          next.faceAEnabled !== e.faceAEnabled ||
          next.faceBEnabled !== e.faceBEnabled;
        return next;
      }),
    );
    if (changed) markDirty();
  };

  const linkEstante = (face: Face, estanteId: string | null) => {
    if (!selected) return;
    const patch: Partial<FloorElement> =
      face === "A"
        ? { estanteId, ...(estanteId ? {} : { estanteIdB: null }) }
        : { estanteIdB: estanteId };
    const updated = fitGondola({ ...selected, ...patch }, estanteById);
    /** Outra gôndola com colunas da mesma estante que esta passa a atender (outra parte da estante fica). */
    const clashes = (e: FloorElement) =>
      e.id !== selected.id && estanteId != null && overlapsEstante(e, updated, estanteId);
    setElements((prev) =>
      prev
        .filter((e) => !clashes(e) || e.estanteIdB != null)
        .map((e) => {
          if (e.id === selected.id) return updated;
          if (!clashes(e)) return e;
          if (e.estanteIdB === estanteId) return { ...e, estanteIdB: null };
          if (e.estanteId === estanteId && e.estanteIdB) return { ...e, estanteId: e.estanteIdB, estanteIdB: null };
          return e;
        }),
    );
    markDirty();
  };

  const splitSelected = (firstCount: number, gapCells: number) => {
    if (!selected) return false;
    const parts = splitGondola(selected, estanteById, firstCount, gapCells, newElementId());
    if (!parts) return false;
    const right = Math.max(...parts.map((p) => p.x + p.width));
    const bottom = Math.max(...parts.map((p) => p.y + p.height));
    const next = { ...dims, widthCells: Math.max(dims.widthCells, right), heightCells: Math.max(dims.heightCells, bottom) };
    if (next.widthCells !== dims.widthCells || next.heightCells !== dims.heightCells) setDims(next);
    const [first, second] = parts.map((p) => clampElement(p, next.widthCells, next.heightCells)) as [FloorElement, FloorElement];
    setElements((prev) => [...prev.map((e) => (e.id === selected.id ? first : e)), second]);
    markDirty();
    return true;
  };

  const moveEstanteToFace = async (estanteId: string, face: Face) => {
    await setEstanteFace(estanteId, face);
    await refreshEstantes([estanteId]);
  };

  const saveEstante = async (estanteId: string, body: EstanteStructureBody) => {
    const result = await updateEstanteStructure(estanteId, body);
    await refreshEstantes([estanteId]);
    const parts = [
      result.created ? `${result.created} posições criadas` : "",
      result.removed ? `${result.removed} removidas` : "",
      result.errors.length ? `${result.errors.length} com erro (${result.errors[0]!.address}: ${result.errors[0]!.message})` : "",
    ].filter(Boolean);
    return `Estante salva${parts.length ? `: ${parts.join(" · ")}` : ""}. Salve a planta para gravar o novo tamanho da gôndola.`;
  };

  const arrangeAll = () => {
    const { elements: added, heightCells } = arrangeEstantes(unplacedEstantes, elements, dims.widthCells, newElementId);
    if (heightCells > dims.heightCells) setDims((d) => ({ ...d, heightCells }));
    setElements((prev) => [...prev, ...added]);
    setPendingEstanteId(null);
    setTool("select");
    markDirty();
  };

  const changeDims = (patch: Partial<typeof dims>) => {
    const next = { ...dims, ...patch };
    setDims(next);
    if (patch.widthCells !== undefined || patch.heightCells !== undefined) {
      setElements((prev) => prev.map((e) => clampElement(e, next.widthCells, next.heightCells)));
    }
    markDirty();
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      applyData(await saveFloorPlan(barracaoId, draft, version));
      onSaved?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Erro ao salvar planta");
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (!window.confirm("Descartar alterações não salvas?")) return;
    setLoading(true);
    try {
      applyData(await fetchFloorPlan(barracaoId));
    } finally {
      setLoading(false);
    }
  };

  const simulate = async () => {
    setRouteLoading(true);
    setRouteError(null);
    try {
      setRoute(await previewFloorPlanRoute(barracaoId, { orderId: orderId.trim(), draft }));
    } catch (e) {
      setRoute(null);
      setRouteError(e instanceof Error ? e.message : "Erro ao simular rota");
    } finally {
      setRouteLoading(false);
    }
  };

  const confirmLeaveApproach = () =>
    !approachDirty || window.confirm("Descartar alterações nas ondas de aproximação?");

  const changeApproach = (waves: ApproachWave[]) => {
    setApproachWaves(waves);
    setApproachDirty(true);
  };

  const onApproachClick = (px: number, py: number) => {
    if (approachSelected == null || !approachPick) return;
    const wave = approachWaves[approachSelected];
    if (!wave) return;
    if (approachPick === "start") {
      const x = Math.floor(px);
      const y = Math.floor(py);
      const hit = elementAt(elements, x, y);
      if (hit && isBlocking(hit)) {
        setApproachError("A saída precisa ficar numa célula livre");
        return;
      }
      setApproachError(null);
      changeApproach(approachWaves.map((w, i) => (i === approachSelected ? { ...w, startX: x, startY: y } : w)));
      setApproachPick("stops");
      return;
    }
    const stop = stopFromPoint(elements, estanteById, px, py);
    if (!stop || wave.stops.some((s) => sameStop(s, stop))) return;
    changeApproach(approachWaves.map((w, i) => (i === approachSelected ? { ...w, stops: [...w.stops, stop] } : w)));
  };

  const saveApproach = async () => {
    setApproachSaving(true);
    setApproachError(null);
    try {
      const { waves } = await saveApproachWaves(barracaoId, approachKind, approachWaves);
      setApproachWaves(waves);
      setApproachDirty(false);
      setApproachPick(null);
    } catch (e) {
      setApproachError(e instanceof Error ? e.message : "Erro ao salvar ondas de aproximação");
    } finally {
      setApproachSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (mode !== "edit" || isTypingTarget(ev.target)) return;
      if (ev.key === "Escape") {
        setTool("select");
        setPendingEstanteId(null);
        setSelectedId(null);
        return;
      }
      if (ev.key === "v" || ev.key === "V") {
        setTool("select");
        return;
      }
      if (!selected) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        deleteSelected();
      } else if (ev.key === "r" || ev.key === "R") {
        rotateSelected();
      } else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        const step = ev.shiftKey ? 5 : 1;
        const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
        const dy = ev.key === "ArrowUp" ? -step : ev.key === "ArrowDown" ? step : 0;
        // Alt + setas: aumenta/diminui largura (→ ←) e altura (↓ ↑).
        if (ev.altKey) patchSelected({ width: Math.max(1, selected.width + dx), height: Math.max(1, selected.height + dy) });
        else patchSelected({ x: selected.x + dx, y: selected.y + dy });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const m = dims.cellSizeCm / 100;
  const errorCount = validation?.issues.filter((i) => i.severity === "error").length ?? 0;

  return (
    <DataState loading={loading} error={loadError}>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-2.5">
            {(["edit", "route", "approach"] as Mode[]).map((m2) => (
              <button
                key={m2}
                type="button"
                onClick={() => {
                  if (mode === "approach" && m2 !== "approach" && !confirmLeaveApproach()) return;
                  setMode(m2);
                  setTool("select");
                }}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  mode === m2 ? "bg-[#0d9488] text-white" : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                {MODE_LABELS[m2]}
              </button>
            ))}
            <span className="flex-1" />
            {saveError ? <span className="text-sm text-red-600">{saveError}</span> : null}
            <span className="text-xs text-slate-500">
              {dirty ? "Alterações não salvas" : data?.saved ? `Versão ${version} · salva` : "Planta ainda não salva"}
            </span>
            {dirty ? (
              <button type="button" onClick={discard} className="rounded-lg border px-3 py-1.5 text-sm">
                Descartar
              </button>
            ) : null}
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={save}
              className="rounded-lg bg-[#0d9488] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>

          <div className="grid grid-cols-[48px_minmax(0,1fr)] xl:grid-cols-[48px_minmax(0,1fr)_300px]">
            <div className="flex flex-col gap-1.5 border-r bg-slate-50 p-2">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.title}
                  disabled={mode !== "edit"}
                  onClick={() => {
                    setTool(t.id);
                    setPendingEstanteId(null);
                  }}
                  className={`grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40 ${
                    tool === t.id && mode === "edit" ? "bg-white text-[#0d9488] shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  {t.icon}
                </button>
              ))}
            </div>

            <div className="min-w-0">
              <ZoomViewport
                contentWidth={dims.widthCells * BASE_CELL_PX}
                contentHeight={dims.heightCells * BASE_CELL_PX}
                fitKey={barracaoId}
                height="68vh"
              >
                {(zoom) => (
                  <FloorPlanCanvas
                    widthCells={dims.widthCells}
                    heightCells={dims.heightCells}
                    elements={elements}
                    estantes={estanteById}
                    selectedId={selectedId}
                    tool={tool}
                    interactive={mode === "edit"}
                    zoom={zoom}
                    reachability={reachability}
                    issueElementIds={mode === "edit" ? issueElementIds : new Set()}
                    route={mode === "route" ? route : null}
                    onSelect={setSelectedId}
                    onPlace={placeElement}
                    onElementChange={replaceElement}
                    onDragEnd={(changed) => {
                      if (changed) markDirty();
                    }}
                    onPointClick={mode === "approach" ? onApproachClick : undefined}
                    overlay={
                      mode === "approach" ? (
                        <ApproachOverlay
                          waves={approachWaves}
                          selectedIndex={approachSelected}
                          elements={elements}
                          estantes={estanteById}
                        />
                      ) : null
                    }
                  />
                )}
              </ZoomViewport>
              <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2 text-xs text-slate-500">
                <Legend color={FACE_COLORS.A} label="LD" />
                <Legend color={FACE_COLORS.B} label="LE" />
                <Legend color="#94a3b8" label="Obstáculo" />
                <Legend color="#0d9488" label={`Saída do separador (${elements.filter((e) => e.type === "START_POINT").length})`} />
                <Legend color="#ea580c" label={`Packing (${elements.filter((e) => e.type === "PACKING_POINT").length})`} />
                <Legend color={ROUTE_COLOR} label="Rota" />
                <span>
                  1 célula = {dims.cellSizeCm} cm · {formatMeters(dims.widthCells * m)} × {formatMeters(dims.heightCells * m)}
                </span>
                {mode === "edit" ? <span>Alt + setas: aumentar/diminuir o selecionado</span> : null}
                {errorCount > 0 ? <span className="text-red-600">{errorCount} erro(s) na planta</span> : null}
              </div>
            </div>

            <div className="col-span-2 space-y-5 border-t p-4 xl:col-span-1 xl:max-h-[78vh] xl:overflow-y-auto xl:border-l xl:border-t-0">
              {mode === "edit" ? (
                <>
                  {selected ? (
                    <ElementPropertiesPanel
                      element={selected}
                      estantes={data?.estantes ?? []}
                      usedEstanteIds={usedEstanteIds}
                      reachability={reachability}
                      onChange={patchSelected}
                      onRotate={rotateSelected}
                      onDelete={deleteSelected}
                      onSaveEstante={saveEstante}
                      onLinkEstante={linkEstante}
                      onMoveEstanteToFace={moveEstanteToFace}
                      onSplit={splitSelected}
                      cellSizeCm={dims.cellSizeCm}
                      onChangeRange={(patch) => {
                        if (!selected) return;
                        replaceElement(fitGondola({ ...selected, ...patch }, estanteById));
                        markDirty();
                      }}
                    />
                  ) : (
                    <PlanSettingsPanel {...dims} onChange={changeDims} />
                  )}
                  <hr />
                  <UnplacedEstantesPanel
                    estantes={unplacedEstantes}
                    pendingEstanteId={pendingEstanteId}
                    onPick={pickEstante}
                    onArrangeAll={arrangeAll}
                  />
                  <hr />
                  <ValidationPanel validation={validation} validating={validating} onFocusElement={setSelectedId} />
                </>
              ) : mode === "route" ? (
                <RoutePanel
                  orderId={orderId}
                  onOrderIdChange={setOrderId}
                  onSimulate={simulate}
                  loading={routeLoading}
                  error={routeError}
                  route={route}
                />
              ) : (
                <ApproachWavesPanel
                  kind={approachKind}
                  onKindChange={(k) => {
                    if (k === approachKind || !confirmLeaveApproach()) return;
                    setApproachKind(k);
                  }}
                  waves={approachWaves}
                  selectedIndex={approachSelected}
                  onSelect={setApproachSelected}
                  onChange={changeApproach}
                  pick={approachPick}
                  onPickChange={setApproachPick}
                  estanteCode={(id) => estanteById.get(id)?.code ?? "?"}
                  dirty={approachDirty}
                  saving={approachSaving}
                  error={approachError}
                  planDirty={dirty}
                  onSave={saveApproach}
                  onDiscard={() => void loadApproach(approachKind)}
                />
              )}
            </div>
          </div>
        </div>

        {mode === "edit" && selected?.type === "GONDOLA" && selectedEstante ? (
          <GondolaElevation element={selected} estante={selectedEstante} />
        ) : null}
      </div>
    </DataState>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
