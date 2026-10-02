"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { FloorElement, FloorElementType, FloorPlanEstante, RoutePreview } from "@/lib/api/floor-plan";
import {
  DANGER_COLOR,
  FACE_COLORS,
  ROUTE_COLOR,
  accessCell,
  alongAxis,
  clampElement,
  elementAt,
  faceColunas,
  faceHalfRect,
  gondolaGeometry,
  gondolaView,
  isAccessReachable,
  slotIndexOnFloor,
  type Face,
  type Reachability,
} from "./geometry";

export type FloorTool = "select" | FloorElementType;

const BASE_CELL_PX = 14;

type DragState = {
  id: string;
  kind: "move" | "resize";
  offsetX: number;
  offsetY: number;
  origin: FloorElement;
  moved: boolean;
};

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
  onSelect,
  onPlace,
  onElementChange,
  onDragEnd,
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
  onSelect: (id: string | null) => void;
  onPlace: (type: FloorElementType, x: number, y: number) => void;
  onElementChange: (element: FloorElement) => void;
  onDragEnd: (changed: boolean) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const cellPx = BASE_CELL_PX * zoom;

  const cellAt = (ev: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(m.inverse());
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
    if (!interactive || ev.button !== 0) return;
    const c = cellAt(ev);
    if (c.x < 0 || c.y < 0 || c.x >= widthCells || c.y >= heightCells) return;
    if (tool !== "select") {
      onPlace(tool, c.x, c.y);
      return;
    }
    const hit = elementAt(elements, c.x, c.y);
    onSelect(hit?.id ?? null);
    if (hit) startDrag(ev, hit, "move");
  };

  const onPointerMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const c = cellAt(ev);
    const o = drag.origin;
    const next =
      drag.kind === "move"
        ? { ...o, x: c.x - drag.offsetX, y: c.y - drag.offsetY }
        : { ...o, width: Math.max(1, c.x - o.x + 1), height: Math.max(1, c.y - o.y + 1) };
    const clamped = clampElement(next, widthCells, heightCells);
    if (clamped.x !== o.x || clamped.y !== o.y || clamped.width !== o.width || clamped.height !== o.height) {
      drag.moved = true;
    }
    onElementChange(clamped);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) onDragEnd(drag.moved);
  };

  const selected = elements.find((e) => e.id === selectedId) ?? null;

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
        cursor: interactive && tool !== "select" ? "crosshair" : "default",
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
            selected={interactive && e.id === selectedId}
            hasIssue={issueElementIds.has(e.id)}
          />
        ),
      )}

      {interactive && selected?.type === "GONDOLA" ? (
        <AccessDots
          element={selected}
          estante={gondolaView(selected, estantes)}
          reachability={reachability}
        />
      ) : null}

      {interactive && selected ? (
        <rect
          x={selected.x + selected.width - 0.55}
          y={selected.y + selected.height - 0.55}
          width={0.55}
          height={0.55}
          fill="#0d9488"
          stroke="#fff"
          strokeWidth={0.08}
          style={{ cursor: "nwse-resize" }}
          onPointerDown={(ev) => {
            ev.stopPropagation();
            startDrag(ev, selected, "resize");
          }}
        />
      ) : null}

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

function MarkerShape({
  element: e,
  selected,
  hasIssue,
}: {
  element: FloorElement;
  selected: boolean;
  hasIssue: boolean;
}) {
  const stroke = selected ? "#0d9488" : hasIssue ? DANGER_COLOR : "#64748b";
  const strokeWidth = selected || hasIssue ? 0.16 : 0.07;
  const label = e.label || null;

  if (e.type === "OBSTACLE") {
    return (
      <g>
        <rect x={e.x} y={e.y} width={e.width} height={e.height} fill="url(#fp-hatch)" stroke={stroke} strokeWidth={strokeWidth} />
        {label && e.width >= 3 ? (
          <text
            x={e.x + e.width / 2}
            y={e.y + e.height / 2}
            fontSize={0.6}
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
  const text = label ?? (e.type === "START_POINT" ? "Início" : e.type === "PACKING_POINT" ? "Packing" : "Doca");
  return (
    <g>
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
        {text}
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
