import { cellIndex, type FloorGrid } from "./floor-grid.js";
import type { GondolaSlots, Face, FloorElementSpec } from "./types.js";

export function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/**
 * Geometria da gôndola a partir do retângulo ocupado. Rotação em sentido horário:
 * 0 = Face A (LD) em cima e colunas da esquerda para a direita;
 * 90 = Face A à direita e colunas de cima para baixo;
 * 180 = Face A embaixo e colunas da direita para a esquerda;
 * 270 = Face A à esquerda e colunas de baixo para cima.
 * `colunaReversedA` / `colunaReversedB` invertem o sentido só da face correspondente.
 */
export function gondolaGeometry(e: FloorElementSpec) {
  const rotation = normalizeRotation(e.rotation);
  const horizontal = rotation === 0 || rotation === 180;
  return {
    rotation,
    horizontal,
    length: horizontal ? e.width : e.height,
    thickness: horizontal ? e.height : e.width,
  };
}

export function accessCellForSlot(
  grid: FloorGrid,
  e: FloorElementSpec,
  slotIndex: number,
  slotCount: number,
  face: Face,
): number {
  if (slotCount <= 0 || slotIndex < 0 || slotIndex >= slotCount) return -1;
  const { rotation, length, thickness } = gondolaGeometry(e);
  const reversed = face === "A" ? e.colunaReversedA : e.colunaReversedB;
  const idx = reversed ? slotCount - 1 - slotIndex : slotIndex;
  const off = Math.min(length - 1, Math.floor(((idx + 0.5) * length) / slotCount));
  const isA = face === "A";
  switch (rotation) {
    case 0:
      return cellIndex(grid, e.x + off, isA ? e.y - 1 : e.y + thickness);
    case 90:
      return cellIndex(grid, isA ? e.x + thickness : e.x - 1, e.y + off);
    case 180:
      return cellIndex(grid, e.x + length - 1 - off, isA ? e.y + thickness : e.y - 1);
    case 270:
      return cellIndex(grid, isA ? e.x - 1 : e.x + thickness, e.y + length - 1 - off);
  }
}

function slotSortKey(code: string): [number, string] {
  const n = Number.parseInt(code, 10);
  return [Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n, code];
}

/** Ordena códigos numericamente quando possível (1, 2, 10) e remove duplicados. */
export function sortSlotCodes(codes: Iterable<string>): string[] {
  const unique = [...new Set([...codes].map((c) => c.trim().toUpperCase()).filter(Boolean))];
  return unique.sort((a, b) => {
    const [na, sa] = slotSortKey(a);
    const [nb, sb] = slotSortKey(b);
    return na !== nb ? na - nb : sa.localeCompare(sb);
  });
}

export function normalizeFace(face: string | null | undefined): Face {
  return String(face ?? "A").trim().toUpperCase() === "B" ? "B" : "A";
}

export type AccessPoint = {
  elementId: string;
  estanteId: string;
  colunaCode: string;
  face: Face;
  cell: number;
};

/** Índice estanteId+coluna+face -> célula de acesso para todas as gôndolas da planta. */
export function buildAccessIndex(
  grid: FloorGrid,
  elements: FloorElementSpec[],
  slots: GondolaSlots,
) {
  const byKey = new Map<string, AccessPoint>();
  const points: AccessPoint[] = [];
  const gondolaByEstante = new Map<string, FloorElementSpec>();

  for (const e of elements) {
    if (e.type !== "GONDOLA") continue;
    const faces: Face[] = [];
    if (e.faceAEnabled) faces.push("A");
    if (e.faceBEnabled) faces.push("B");
    for (const face of faces) {
      const estanteId = faceEstanteId(e, face);
      if (!estanteId) continue;
      gondolaByEstante.set(estanteId, e);
      const codes = elementFaceSlots(e, face, slots);
      codes.forEach((colunaCode, i) => {
        const point: AccessPoint = {
          elementId: e.id,
          estanteId,
          colunaCode,
          face,
          cell: accessCellForSlot(grid, e, i, codes.length, face),
        };
        byKey.set(accessKey(estanteId, colunaCode, face), point);
        points.push(point);
      });
    }
  }

  return { byKey, points, gondolaByEstante };
}

export function faceColunaRange(e: FloorElementSpec, face: Face): { min: number | null; max: number | null } {
  return face === "A"
    ? { min: e.colunaMinA ?? null, max: e.colunaMaxA ?? null }
    : { min: e.colunaMinB ?? null, max: e.colunaMaxB ?? null };
}

export function colunaInRange(code: string, range: { min: number | null; max: number | null }): boolean {
  if (range.min == null && range.max == null) return true;
  const n = Number.parseInt(code, 10);
  if (Number.isNaN(n)) return false;
  return (range.min == null || n >= range.min) && (range.max == null || n <= range.max);
}

/** Colunas que este lado da gôndola atende: as da estante do lado, dentro da faixa da gôndola. */
export function elementFaceSlots(e: FloorElementSpec, face: Face, slots: GondolaSlots): string[] {
  const estanteId = faceEstanteId(e, face);
  if (!estanteId) return [];
  const range = faceColunaRange(e, face);
  return (slots.get(estanteId)?.[face] ?? []).filter((code) => colunaInRange(code, range));
}

/** Estante atendida por um lado da gôndola. */
export function faceEstanteId(e: FloorElementSpec, face: Face): string | null {
  return (face === "B" ? e.estanteIdB || e.estanteId : e.estanteId) || null;
}

/** Estantes vinculadas à gôndola (LD e, se diferente, LE). */
export function elementEstanteIds(e: FloorElementSpec): string[] {
  if (e.type !== "GONDOLA") return [];
  return [...new Set([e.estanteId, e.estanteIdB].filter((id): id is string => Boolean(id)))];
}

export function accessKey(estanteId: string, colunaCode: string, face: Face): string {
  return `${estanteId}|${colunaCode.trim().toUpperCase()}|${face}`;
}
