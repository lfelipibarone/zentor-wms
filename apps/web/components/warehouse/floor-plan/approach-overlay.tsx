"use client";

import type { ApproachWave } from "@/lib/api/approach-waves";
import type { FloorElement, FloorPlanEstante } from "@/lib/api/floor-plan";
import { stopRects } from "./approach-geometry";

export function ApproachOverlay({
  waves,
  selectedIndex,
  elements,
  estantes,
}: {
  waves: ApproachWave[];
  selectedIndex: number | null;
  elements: FloorElement[];
  estantes: Map<string, FloorPlanEstante>;
}) {
  return (
    <g pointerEvents="none">
      {waves.map((w, wi) => {
        const isSelected = wi === selectedIndex;
        if (!w.active && !isSelected) return null;
        const stops = w.stops.map((stop) => stopRects(stop, elements, estantes));
        const path: Array<[number, number]> = [];
        if (w.startX != null && w.startY != null) path.push([w.startX + 0.5, w.startY + 0.5]);
        for (const rects of stops) {
          const r = rects[0];
          if (r) path.push([r.x + r.width / 2, r.y + r.height / 2]);
        }
        return (
          <g key={w.id ?? `new-${wi}`}>
            {stops.flatMap((rects, si) =>
              rects.map((r, ri) => (
                <rect
                  key={`${si}-${ri}`}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  fill={w.color}
                  fillOpacity={isSelected ? 0.55 : 0.28}
                  stroke={w.color}
                  strokeWidth={isSelected ? 0.12 : 0.05}
                />
              )),
            )}
            {isSelected && path.length > 1 ? (
              <polyline
                points={path.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={w.color}
                strokeWidth={0.12}
                strokeDasharray="0.4 0.25"
              />
            ) : null}
            {isSelected
              ? stops.map((rects, si) => {
                  const r = rects[0];
                  if (!r) return null;
                  return (
                    <g key={`n-${si}`}>
                      <circle cx={r.x + r.width / 2} cy={r.y + r.height / 2} r={0.45} fill={w.color} stroke="#fff" strokeWidth={0.06} />
                      <text
                        x={r.x + r.width / 2}
                        y={r.y + r.height / 2}
                        fontSize={0.45}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#fff"
                      >
                        {si + 1}
                      </text>
                    </g>
                  );
                })
              : null}
            {w.startX != null && w.startY != null ? (
              <g>
                <rect x={w.startX} y={w.startY} width={1} height={1} rx={0.25} fill={w.color} stroke="#fff" strokeWidth={0.08} />
                <text
                  x={w.startX + 0.5}
                  y={w.startY + 0.5}
                  fontSize={0.55}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                >
                  S
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
