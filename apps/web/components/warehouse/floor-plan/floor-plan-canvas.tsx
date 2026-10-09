"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { FloorElement, FloorElementType, FloorPlanEstante, RoutePreview } from "@/lib/api/floor-plan";
import {
  DANGER_COLOR,
  FACE_COLORS,
  ROUTE_COLOR,
  accessCell,
  alongAxis,
  clampElement,
  elementAt,
  elementDisplayName,
  faceColunas,
  faceHalfRect,
  gondolaGeometry,
  gondolaView,
  isAccessReachable,
  resizeFromHandle,
  slotIndexOnFloor,
  type Face,
  type Reachability,
  type ResizeHandle,
} from "./geometry";

export type FloorTool = "select" | FloorElementType;

/** Pixels por célula com zoom 1. */
export const BASE_CELL_PX = 14;

/** Ferramentas que aceitam clicar e arrastar para desenhar a área no tamanho certo. */
const DRAWABLE = new Set<FloorTool>(["OBSTACLE", "RECEIVING_AREA", "DOCK", "PACKING_POINT"]);

/** Movimento máximo (px) para ainda contar como clique. */
const CLICK_TOLERANCE = 5;

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

type DragState = {
  id: string;
  kind: "move" | ResizeHandle;
  offsetX: number;
  offsetY: number;
  origin: FloorElement;
  moved: boolean;
};

type DrawState = { type: FloorElementType; x0: number; y0: number; x1: number; y1: number };

function drawRect(d: DrawState) {
  return {
    x: Math.min(d.x0, d.x1),
    y: Math.min(d.y0, d.y1),
    width: Math.abs(d.x1 - d.x0) + 1,
    height: Math.abs(d.y1 - d.y0) + 1,
  };
}

export function FloorPlanCanvas({
  widthCells,
  heightCells,
  elements,
  estantes,
  selectedId,
  tool,
  interactive,
  zoom,
  reachability,
  issueElementIds,
  route,
  overlay,
  onSelect,
  onPlace,
  onElementChange,
  onDragEnd,
  onPointClick,
}: {
  widthCells: number;
  heightCells: number;
  elements: FloorElement[];
  estantes: Map<string, FloorPlanEstante>;
  selectedId: string | null;
  tool: FloorTool;
  interactive: boolean;
  zoom: number;
  reachability: Reachability;
  issueElementIds: Set<string>;
  route: RoutePreview | null;
  overlay?: ReactNode;
  onSelect: (id: string | null) => void;
  /** `size` vem quando o usuário arrastou para desenhar a área. */
  onPlace: (type: FloorElementType, x: number, y: number, size?: { width: number; height: number }) => void;
  onElementChange: (element: FloorElement) => void;
  onDragEnd: (changed: boolean) => void;
  onPointClick?: (x: number, y: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const clickRef = useRef<{ x: number; y: number } | null>(null);
  const cellPx = BASE_CELL_PX * zoom;

  const pointAt = (ev: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const cellAt = (ev: { clientX: number; clientY: number }) => {
    const p = pointAt(ev);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  const startDrag = (ev: ReactPointerEvent, element: FloorElement, kind: DragState["kind"]) => {
    const c = cellAt(ev);
    dragRef.current = {
      id: element.id,
      kind,
      offsetX: c.x - element.x,
      offsetY: c.y - element.y,
      origin: element,
      moved: false,
    };
    svgRef.current?.setPointerCapture(ev.pointerId);
  };

  const onPointerDown = (ev: ReactPointerEvent<SVGSVGElement>) => {
    // Clique só vale no soltar: arrastar a partir daqui move o mapa (ZoomViewport).
    if (onPointClick && ev.button === 0) {
      clickRef.current = { x: ev.clientX, y: ev.clientY };
      return;
    }
    if (!interactive || ev.button !== 0) return;
    const c = cellAt(ev);
    if (c.x < 0 || c.y < 0 || c.x >= widthCells || c.y >= heightCells) return;
    if (tool !== "select") {
      ev.stopPropagation();
      if (DRAWABLE.has(tool)) {
        const d = { type: tool, x0: c.x, y0: c.y, x1: c.x, y1: c.y };
        drawRef.current = d;
        setDraw(d);
        svgRef.current?.setPointerCapture(ev.pointerId);
      } else {
        onPlace(tool, c.x, c.y);
      }
      return;
    }
    const hit = elementAt(elements, c.x, c.y);
    onSelect(hit?.id ?? null);
    if (hit) {
      ev.stopPropagation();
      startDrag(ev, hit, "move");
    }
  };

  const onPointerMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const d = drawRef.current;
    if (d) {
      const c = cellAt(ev);
      const next = {
        ...d,
        x1: Math.max(0, Math.min(widthCells - 1, c.x)),
        y1: Math.max(0, Math.min(heightCells - 1, c.y)),
      };
      if (next.x1 !== d.x1 || next.y1 !== d.y1) {
        drawRef.current = next;
        setDraw(next);
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const o = drag.origin;
    let next: FloorElement;
    if (drag.kind === "move") {
      const c = cellAt(ev);
      next = { ...o, x: c.x - drag.offsetX, y: c.y - drag.offsetY };
    } else {
      const p = pointAt(ev);
      next = resizeFromHandle(o, drag.kind, p.x, p.y);
    }
    const clamped = clampElement(next, widthCells, heightCells);
    if (clamped.x !== o.x || clamped.y !== o.y || clamped.width !== o.width || clamped.height !== o.height) {
      drag.moved = true;
    }
    onElementChange(clamped);
  };

  const onPointerUp = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const d = drawRef.current;
    if (d) {
      drawRef.current = null;
      setDraw(null);
      const r = drawRect(d);
      if (r.width > 1 || r.height > 1) onPlace(d.type, r.x, r.y, { width: r.width, height: r.height });
      else onPlace(d.type, d.x0, d.y0);
      return;
    }
    const click = clickRef.current;
    clickRef.current = null;
    if (click && onPointClick && Math.hypot(ev.clientX - click.x, ev.clientY - click.y) < CLICK_TOLERANCE) {
      const p = pointAt(ev);
      if (p.x >= 0 && p.y >= 0 && p.x < widthCells && p.y < heightCells) onPointClick(p.x, p.y);
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) onDragEnd(drag.moved);
  };

  const selected = elements.find((e) => e.id === selectedId) ?? null;
  /** Alças com tamanho constante na tela, independente do zoom. */
  const handleSize = Math.min(0.7, Math.max(0.25, 8 / cellPx));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${widthCells} ${heightCells}`}
      width={widthCells * cellPx}
      height={heightCells * cellPx}
      role="img"
      aria-label="Planta do barracão"
      className="block select-none bg-white"
      style={{
        touchAction: "none",
        cursor: onPointClick ? "pointer" : interactive && tool !== "select" ? "crosshair" : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <defs>
        <pattern id="fp-grid" width={1} height={1} patternUnits="userSpaceOnUse">
          <path d="M1 0H0V1" fill="none" stroke="#e2e8f0" strokeWidth={0.04} />
        </pattern>
        <pattern id="fp-grid-major" width={10} height={10} patternUnits="userSpaceOnUse">
          <rect width={10} height={10} fill="url(#fp-grid)" />
          <path d="M10 0H0V10" fill="none" stroke="#cbd5e1" strokeWidth={0.08} />
        </pattern>
        <pattern id="fp-hatch" width={0.5} height={0.5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={0.5} height={0.5} fill="#f1f5f9" />
          <path d="M0 0V0.5" stroke="#94a3b8" strokeWidth={0.12} />
        </pattern>
      </defs>

      <rect x={0} y={0} width={widthCells} height={heightCells} fill="url(#fp-grid-major)" />

      {elements.map((e) =>
        e.type === "GONDOLA" ? (
          <GondolaShape
            key={e.id}
            element={e}
            estante={gondolaView(e, estantes)}
            selected={interactive && e.id === selectedId}
            hasIssue={issueElementIds.has(e.id)}
          />
        ) : (
          <MarkerShape
            key={e.id}
            element={e}
            name={elementDisplayName(e, elements)}
            selected={interactive && e.id === selectedId}
            hasIssue={issueElementIds.has(e.id)}
          />
        ),
      )}

      {draw ? (
        <rect
          {...drawRect(draw)}
          fill="#0d9488"
          fillOpacity={0.15}
          stroke="#0d9488"
          strokeWidth={0.08}
          strokeDasharray="0.3 0.2"
          pointerEvents="none"
        />
      ) : null}

      {interactive && selected?.type === "GONDOLA" ? (
        <AccessDots
          element={selected}
          estante={gondolaView(selected, estantes)}
          reachability={reachability}
        />
      ) : null}

      {interactive && selected ? (
        <ResizeHandles
          element={selected}
          size={handleSize}
          onStart={(ev, handle) => {
            ev.stopPropagation();
            startDrag(ev, selected, handle);
          }}
        />
      ) : null}

      {overlay}

      {route ? <RouteOverlay route={route} /> : null}

      <rect
        x={0.05}
        y={0.05}
        width={widthCells - 0.1}
        height={heightCells - 0.1}
        fill="none"
        stroke="#475569"
        strokeWidth={0.1}
      />
    </svg>
  );
}

function GondolaShape({
  element: e,
  estante,
  selected,
  hasIssue,
}: {
  element: FloorElement;
  estante?: FloorPlanEstante;
  selected: boolean;
  hasIssue: boolean;
}) {
  const { horizontal, length } = gondolaGeometry(e);
  const faces: Face[] = [];
  if (e.faceAEnabled) faces.push("A");
  if (e.faceBEnabled) faces.push("B");
  const maxSlots = Math.max(1, ...faces.map((f) => faceColunas(estante, f).length));
  const fontSize = Math.min(0.6, (length / maxSlots) * 0.5);
  const stroke = selected ? "#0d9488" : hasIssue ? DANGER_COLOR : "#64748b";

  return (
    <g>
      <rect x={e.x} y={e.y} width={e.width} height={e.height} fill="#e2e8f0" />
      {faces.map((face) => {
        const r = faceHalfRect(e, face);
        return (
          <rect
            key={face}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            fill={FACE_COLORS[face]}
            fillOpacity={face === "A" ? 0.18 : 0.24}
          />
        );
      })}
      {faces.flatMap((face) => {
        const r = faceHalfRect(e, face);
        const slots = faceColunas(estante, face);
        return slots.slice(1).map((_, k) => {
          const along = alongAxis(e, ((k + 1) * length) / slots.length);
          return horizontal ? (
            <line key={`${face}-${k}`} x1={along} y1={r.y} x2={along} y2={r.y + r.height} stroke="#94a3b8" strokeWidth={0.04} />
          ) : (
            <line key={`${face}-${k}`} x1={r.x} y1={along} x2={r.x + r.width} y2={along} stroke="#94a3b8" strokeWidth={0.04} />
          );
        });
      })}
      {faces.map((face) => {
        const r = faceHalfRect(e, face);
        const slots = faceColunas(estante, face);
        return slots.map((code, i) => {
          const idx = slotIndexOnFloor(e, face, i, slots.length);
          const mid = alongAxis(e, ((idx + 0.5) * length) / slots.length);
          return (
            <text
              key={`${face}-${code}`}
              x={horizontal ? mid : r.x + r.width / 2}
              y={horizontal ? r.y + r.height / 2 : mid}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#334155"
              pointerEvents="none"
            >
              {code}
            </text>
          );
        });
      })}
      <rect
        x={e.x}
        y={e.y}
        width={e.width}
        height={e.height}
        rx={0.1}
        fill="none"
        stroke={stroke}
        strokeWidth={selected || hasIssue ? 0.16 : 0.07}
        strokeDasharray={estante ? undefined : "0.3 0.2"}
      />
      <g pointerEvents="none">
        <circle
          cx={horizontal ? e.x - 0.6 : e.x + e.width / 2}
          cy={horizontal ? e.y + e.height / 2 : e.y - 0.6}
          r={0.55}
          fill={estante ? "#334155" : DANGER_COLOR}
        />
        <text
          x={horizontal ? e.x - 0.6 : e.x + e.width / 2}
          y={horizontal ? e.y + e.height / 2 : e.y - 0.6}
          fontSize={estante && estante.code.length > 2 ? 0.4 : 0.6}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
        >
          {estante?.code ?? "?"}
        </text>
      </g>
    </g>
  );
}

function ResizeHandles({
  element: e,
  size,
  onStart,
}: {
  element: FloorElement;
  size: number;
  onStart: (ev: ReactPointerEvent, handle: ResizeHandle) => void;
}) {
  const handles: ResizeHandle[] = ["nw", "ne", "sw", "se"];
  if (e.width >= size * 3) handles.push("n", "s");
  if (e.height >= size * 3) handles.push("e", "w");
  // Alças por fora do elemento: o miolo continua livre para arrastar, mesmo em pontos de 1 célula.
  return (
    <g>
      {handles.map((h) => {
        const x = h.includes("w") ? e.x - size : h.includes("e") ? e.x + e.width : e.x + (e.width - size) / 2;
        const y = h.includes("n") ? e.y - size : h.includes("s") ? e.y + e.height : e.y + (e.height - size) / 2;
        return (
          <rect
            key={h}
            x={x}
            y={y}
            width={size}
            height={size}
            rx={size * 0.2}
            fill="#fff"
            stroke="#0d9488"
            strokeWidth={size * 0.22}
            style={{ cursor: HANDLE_CURSOR[h] }}
            onPointerDown={(ev) => onStart(ev, h)}
          />
        );
      })}
    </g>
  );
}

function MarkerShape({
  element: e,
  name,
  selected,
  hasIssue,
}: {
  element: FloorElement;
  name: string;
  selected: boolean;
  hasIssue: boolean;
}) {
  const stroke = selected ? "#0d9488" : hasIssue ? DANGER_COLOR : "#64748b";
  const strokeWidth = selected || hasIssue ? 0.16 : 0.07;
  const label = e.label || null;

  if (e.type === "OBSTACLE") {
    const fontSize = Math.min(0.6, e.height * 0.7);
    const fits = label != null && label.length * fontSize * 0.55 <= e.width - 0.2;
    return (
      <g>
        <title>{name}</title>
        <rect x={e.x} y={e.y} width={e.width} height={e.height} fill="url(#fp-hatch)" stroke={stroke} strokeWidth={strokeWidth} />
        {fits ? (
          <text
            x={e.x + e.width / 2}
            y={e.y + e.height / 2}
            fontSize={fontSize}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#475569"
            pointerEvents="none"
          >
            {label}
          </text>
        ) : null}
      </g>
    );
  }

  if (e.type === "RECEIVING_AREA") {
    return (
      <g>
        <rect
          x={e.x}
          y={e.y}
          width={e.width}
          height={e.height}
          rx={0.15}
          fill="#fef3c7"
          stroke={selected || hasIssue ? stroke : "#d97706"}
          strokeWidth={selected || hasIssue ? strokeWidth : 0.08}
          strokeDasharray={selected || hasIssue ? undefined : "0.3 0.2"}
        />
        <text
          x={e.x + e.width / 2}
          y={e.y + e.height / 2}
          fontSize={Math.min(0.65, e.width / 7)}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#92400e"
          pointerEvents="none"
        >
          {label ?? "Recebimento"}
        </text>
      </g>
    );
  }

  const fill = e.type === "START_POINT" ? "#0d9488" : e.type === "PACKING_POINT" ? "#ea580c" : "#475569";
  return (
    <g>
      <title>{name}</title>
      <rect
        x={e.x}
        y={e.y}
        width={e.width}
        height={e.height}
        rx={e.type === "START_POINT" ? Math.min(e.width, e.height) / 2 : 0.15}
        fill={fill}
        fillOpacity={0.85}
        stroke={selected ? stroke : "none"}
        strokeWidth={strokeWidth}
      />
      <text
        x={e.x + e.width + 0.3}
        y={e.y + e.height / 2}
        fontSize={0.65}
        dominantBaseline="central"
        fill="#0f172a"
        pointerEvents="none"
      >
        {name}
      </text>
    </g>
  );
}

function AccessDots({
  element,
  estante,
  reachability,
}: {
  element: FloorElement;
  estante?: FloorPlanEstante;
  reachability: Reachability;
}) {
  const faces: Face[] = [];
  if (element.faceAEnabled) faces.push("A");
  if (element.faceBEnabled) faces.push("B");
  return (
    <g pointerEvents="none">
      {faces.flatMap((face) =>
        faceColunas(estante, face).map((code, i, slots) => {
          const cell = accessCell(element, i, slots.length, face);
          if (!cell) return null;
          const ok = isAccessReachable(reachability, cell);
          return (
            <circle
              key={`${code}-${face}`}
              cx={cell.x + 0.5}
              cy={cell.y + 0.5}
              r={0.22}
              fill={ok ? FACE_COLORS[face] : DANGER_COLOR}
            />
          );
        }),
      )}
    </g>
  );
}

function RouteOverlay({ route }: { route: RoutePreview }) {
  return (
    <g pointerEvents="none">
      {route.path.length > 1 ? (
        <polyline
          points={route.path.map(([x, y]) => `${x + 0.5},${y + 0.5}`).join(" ")}
          fill="none"
          stroke={ROUTE_COLOR}
          strokeWidth={0.22}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {route.stops.map((s, i) => (
        <g key={`${s.locationId}-${i}`}>
          <circle cx={s.x + 0.5} cy={s.y + 0.5} r={0.5} fill={ROUTE_COLOR} stroke="#fff" strokeWidth={0.08} />
          <text
            x={s.x + 0.5}
            y={s.y + 0.5}
            fontSize={0.5}
            fontWeight={700}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
          >
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}
