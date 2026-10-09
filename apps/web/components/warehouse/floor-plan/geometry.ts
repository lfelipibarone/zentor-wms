import type { FloorElement, FloorElementType, FloorPlanDraft, FloorPlanEstante } from "@/lib/api/floor-plan";

export type Face = "A" | "B";
export type Rotation = 0 | 90 | 180 | 270;

export const FACE_COLORS: Record<Face, string> = { A: "#0891b2", B: "#7c3aed" };
export const FACE_SIDE: Record<Face, "LD" | "LE"> = { A: "LD", B: "LE" };

export function faceColunas(
  estante: { colunasLD: string[]; colunasLE: string[] } | null | undefined,
  face: Face,
): string[] {
  if (!estante) return [];
  return face === "A" ? estante.colunasLD : estante.colunasLE;
}
/** Estantes vinculadas à gôndola (LD e, se diferente, LE). */
export function elementEstanteIds(e: Pick<FloorElement, "type" | "estanteId" | "estanteIdB">): string[] {
  if (e.type !== "GONDOLA") return [];
  return [...new Set([e.estanteId, e.estanteIdB].filter((id): id is string => Boolean(id)))];
}

type ColunaRangeFields = Pick<FloorElement, "colunaMinA" | "colunaMaxA" | "colunaMinB" | "colunaMaxB">;
export type ColunaRange = { min: number | null; max: number | null };

export function faceColunaRange(e: ColunaRangeFields, face: Face): ColunaRange {
  return face === "A"
    ? { min: e.colunaMinA ?? null, max: e.colunaMaxA ?? null }
    : { min: e.colunaMinB ?? null, max: e.colunaMaxB ?? null };
}

export function hasColunaRange(e: ColunaRangeFields): boolean {
  return [e.colunaMinA, e.colunaMaxA, e.colunaMinB, e.colunaMaxB].some((v) => v != null);
}

/** Mesma regra do Route Engine: sem faixa atende tudo; com faixa, só colunas numéricas dentro dela. */
export function filterColunas(colunas: string[], range: ColunaRange): string[] {
  if (range.min == null && range.max == null) return colunas;
  return colunas.filter((code) => {
    const n = Number.parseInt(code, 10);
    return !Number.isNaN(n) && (range.min == null || n >= range.min) && (range.max == null || n <= range.max);
  });
}

function rangesOverlap(a: ColunaRange, b: ColunaRange): boolean {
  return (a.min ?? -Infinity) <= (b.max ?? Infinity) && (b.min ?? -Infinity) <= (a.max ?? Infinity);
}

/** Faixa de colunas que a gôndola cobre de uma estante (união dos lados em que ela está vinculada). */
export function estanteRangeIn(e: FloorElement, estanteId: string): ColunaRange | null {
  const faces = (["A", "B"] as Face[]).filter((f) => (f === "B" ? e.estanteIdB || e.estanteId : e.estanteId) === estanteId);
  if (!faces.length) return null;
  const ranges = faces.map((f) => faceColunaRange(e, f));
  return {
    min: ranges.some((r) => r.min == null) ? null : Math.min(...ranges.map((r) => r.min!)),
    max: ranges.some((r) => r.max == null) ? null : Math.max(...ranges.map((r) => r.max!)),
  };
}

/** A outra gôndola atende colunas da estante que se sobrepõem às desta (sem faixa = todas). */
export function overlapsEstante(a: FloorElement, b: FloorElement, estanteId: string): boolean {
  const ra = estanteRangeIn(a, estanteId);
  const rb = estanteRangeIn(b, estanteId);
  return Boolean(ra && rb && rangesOverlap(ra, rb));
}

/**
 * Como a gôndola aparece no mapa: colunas do LD vêm da estante do LD e as do LE da estante do LE
 * (a mesma estante quando é frente e verso), limitadas à faixa de colunas da gôndola. Código combinado, ex.: "C/D".
 */
export function gondolaView(
  e: Pick<FloorElement, "estanteId" | "estanteIdB"> & ColunaRangeFields,
  estantes: Map<string, FloorPlanEstante>,
): FloorPlanEstante | undefined {
  const a = e.estanteId ? estantes.get(e.estanteId) : undefined;
  if (!a) return undefined;
  const b = e.estanteIdB ? estantes.get(e.estanteIdB) : undefined;
  const pair = Boolean(b && b.id !== a.id);
  if (!pair && !hasColunaRange(e)) return a;
  const le = pair ? b! : a;
  return {
    id: a.id,
    code: pair ? [a.code, le.code].sort((x, y) => x.localeCompare(y, "pt-BR")).join("/") : a.code,
    name: pair ? null : a.name,
    colunasLD: filterColunas(a.colunasLD, faceColunaRange(e, "A")),
    colunasLE: filterColunas(le.colunasLE, faceColunaRange(e, "B")),
    linhas: pair ? Math.max(a.linhasLD, le.linhasLE, 1) : a.linhas,
    linhasLD: a.linhasLD,
    linhasLE: le.linhasLE,
  };
}

/** "1–7" para colunas numéricas contínuas, senão "1, 3, 8". */
export function formatColunas(codes: string[]): string {
  if (codes.length <= 2) return codes.join(", ");
  const nums = codes.map((c) => Number.parseInt(c, 10));
  const sorted = [...nums].sort((x, y) => x - y);
  const contiguous = sorted.every((n, i) => !Number.isNaN(n) && (i === 0 || n === sorted[i - 1]! + 1));
  return contiguous ? `${sorted[0]}–${sorted[sorted.length - 1]}` : codes.join(", ");
}

export const ROUTE_COLOR = "#ea580c";
export const DANGER_COLOR = "#dc2626";

export const ELEMENT_LABELS: Record<FloorElementType, string> = {
  GONDOLA: "Gôndola",
  OBSTACLE: "Obstáculo",
  START_POINT: "Início",
  PACKING_POINT: "Packing",
  DOCK: "Doca",
  RECEIVING_AREA: "Recebimento",
};

/** Só pode existir um destes por planta; adicionar outro move o existente. */
export const SINGLETON_TYPES = new Set<FloorElementType>(["RECEIVING_AREA"]);

/** Tipos que podem se repetir e aparecem numerados no mapa quando há mais de um ("Packing 2"). */
export const NUMBERED_TYPES = new Set<FloorElementType>(["START_POINT", "PACKING_POINT", "DOCK"]);

/** Nome exibido do elemento: rótulo, senão o tipo (numerado quando há mais de um do mesmo tipo). */
export function elementDisplayName(e: FloorElement, elements: FloorElement[]): string {
  if (e.label) return e.label;
  const base = ELEMENT_LABELS[e.type];
  if (!NUMBERED_TYPES.has(e.type)) return base;
  const same = elements.filter((x) => x.type === e.type);
  return same.length > 1 ? `${base} ${same.findIndex((x) => x.id === e.id) + 1}` : base;
}

/** Atalhos de obstáculo: rótulo e tamanho sugerido em metros. */
export const OBSTACLE_PRESETS: Array<{ label: string; widthM: number; heightM: number }> = [
  { label: "Pilar", widthM: 0.5, heightM: 0.5 },
  { label: "Parede", widthM: 5, heightM: 0.5 },
  { label: "Mesa", widthM: 2, heightM: 1 },
  { label: "Escada", widthM: 1.5, heightM: 3 },
  { label: "Escritório", widthM: 4, heightM: 3 },
  { label: "Área bloqueada", widthM: 3, heightM: 3 },
];

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Redimensiona pelo canto/lado arrastado até o ponto (px, py), encaixando na linha da grade mais próxima. */
export function resizeFromHandle(o: FloorElement, handle: ResizeHandle, px: number, py: number): FloorElement {
  let left = o.x;
  let top = o.y;
  let right = o.x + o.width;
  let bottom = o.y + o.height;
  if (handle.includes("e")) right = Math.max(left + 1, Math.round(px));
  if (handle.includes("w")) left = Math.min(right - 1, Math.round(px));
  if (handle.includes("s")) bottom = Math.max(top + 1, Math.round(py));
  if (handle.includes("n")) top = Math.min(bottom - 1, Math.round(py));
  return { ...o, x: left, y: top, width: right - left, height: bottom - top };
}

/** Áreas retangulares que podem trocar de tipo entre si no painel. */
export const AREA_TYPES: FloorElementType[] = ["OBSTACLE", "RECEIVING_AREA", "DOCK"];

const DEFAULT_SIZE: Record<FloorElementType, { width: number; height: number }> = {
  GONDOLA: { width: 14, height: 2 },
  OBSTACLE: { width: 2, height: 2 },
  START_POINT: { width: 1, height: 1 },
  PACKING_POINT: { width: 2, height: 2 },
  DOCK: { width: 1, height: 3 },
  RECEIVING_AREA: { width: 4, height: 3 },
};

export function normalizeRotation(rotation: number): Rotation {
  return ((((Math.round(rotation / 90) * 90) % 360) + 360) % 360) as Rotation;
}

export function isBlocking(e: Pick<FloorElement, "type">): boolean {
  return e.type === "GONDOLA" || e.type === "OBSTACLE" || e.type === "RECEIVING_AREA";
}

export function clampElement(e: FloorElement, widthCells: number, heightCells: number): FloorElement {
  const width = Math.max(1, Math.min(e.width, widthCells));
  const height = Math.max(1, Math.min(e.height, heightCells));
  return {
    ...e,
    width,
    height,
    x: Math.max(0, Math.min(e.x, widthCells - width)),
    y: Math.max(0, Math.min(e.y, heightCells - height)),
  };
}

export function createElement(type: FloorElementType, x: number, y: number, id: string): FloorElement {
  const size = DEFAULT_SIZE[type];
  return {
    id,
    type,
    x,
    y,
    width: size.width,
    height: size.height,
    rotation: 0,
    estanteId: null,
    estanteIdB: null,
    faceAEnabled: true,
    faceBEnabled: false,
    colunaReversedA: false,
    // LE continua a numeração dando a volta na ponta: a 1ª coluna do LE fica em frente à última do LD.
    colunaReversedB: true,
    colunaMinA: null,
    colunaMaxA: null,
    colunaMinB: null,
    colunaMaxB: null,
    label: type === "OBSTACLE" ? "Obstáculo" : null,
  };
}

/** Células de comprimento por coluna da estante (com célula de 50 cm, 1 m por coluna). */
const CELLS_PER_COLUNA = 2;
/** Corredor livre entre fileiras de gôndolas, para os pontos de acesso dos dois lados. */
const AISLE_CELLS = 3;
const MARGIN_CELLS = 2;

export function gondolaForEstante(
  estante: { id: string; colunasLD: string[]; colunasLE: string[] },
  x: number,
  y: number,
  id: string,
): FloorElement {
  const colunas = Math.max(estante.colunasLD.length, estante.colunasLE.length, 1);
  return {
    ...createElement("GONDOLA", x, y, id),
    width: Math.max(2, colunas * CELLS_PER_COLUNA),
    estanteId: estante.id,
    faceAEnabled: estante.colunasLD.length > 0 || estante.colunasLE.length === 0,
    faceBEnabled: estante.colunasLE.length > 0,
  };
}

function numericRange(codes: string[]): ColunaRange {
  const nums = codes.map((c) => Number.parseInt(c, 10)).filter((n) => !Number.isNaN(n));
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : { min: null, max: null };
}

/**
 * Divide a gôndola em parte 1 e parte 2 da mesma estante, com um corredor de `gapCells` entre elas.
 * A parte 1 fica com as primeiras `firstCount` colunas como aparecem no desenho (em cada lado, respeitando o sentido).
 */
export function splitGondola(
  e: FloorElement,
  estantes: Map<string, FloorPlanEstante>,
  firstCount: number,
  gapCells: number,
  secondId: string,
): [FloorElement, FloorElement] | null {
  const view = gondolaView(e, estantes);
  if (!view) return null;
  const faces = (["A", "B"] as Face[]).filter(
    (f) => (f === "A" ? e.faceAEnabled : e.faceBEnabled) && faceColunas(view, f).length > 0,
  );
  const total = Math.max(0, ...faces.map((f) => faceColunas(view, f).length));
  const k = Math.round(firstCount);
  if (total < 2 || k < 1 || k >= total) return null;

  const part1: FloorElement = { ...e };
  const part2: FloorElement = { ...e, id: secondId };
  for (const face of faces) {
    const onFloor = colunasOnFloor(e, face, faceColunas(view, face));
    const kf = onFloor.length === total ? k : Math.round((k * onFloor.length) / total);
    const pieces = [onFloor.slice(0, kf), onFloor.slice(kf)] as const;
    [part1, part2].forEach((part, i) => {
      const range = numericRange(pieces[i]);
      const enabled = pieces[i].length > 0 && range.min != null;
      if (face === "A") Object.assign(part, { faceAEnabled: enabled, colunaMinA: range.min, colunaMaxA: range.max });
      else Object.assign(part, { faceBEnabled: enabled, colunaMinB: range.min, colunaMaxB: range.max });
    });
  }

  const { rotation, horizontal, length } = gondolaGeometry(e);
  const len1 = Math.max(1, Math.round((length * k) / total));
  const len2 = Math.max(1, length - len1);
  const gap = Math.max(1, Math.round(gapCells));
  const span = len1 + gap + len2;
  // Início (eixo do desenho) de cada parte; em 180/270 o desenho corre ao contrário do eixo da planta.
  const reversedAxis = rotation === 180 || rotation === 270;
  const start1 = reversedAxis ? span - len1 : 0;
  const start2 = reversedAxis ? 0 : len1 + gap;
  const place = (part: FloorElement, start: number, len: number) =>
    horizontal
      ? Object.assign(part, { x: e.x + start, width: len })
      : Object.assign(part, { y: e.y + start, height: len });
  place(part1, start1, len1);
  place(part2, start2, len2);
  return [part1, part2];
}

/**
 * Distribui as estantes em fileiras horizontais abaixo dos elementos existentes, com corredor entre
 * fileiras. Retorna as gôndolas novas e a altura mínima da planta para caberem.
 */
export function arrangeEstantes(
  estantes: Array<{ id: string; colunasLD: string[]; colunasLE: string[] }>,
  existing: FloorElement[],
  widthCells: number,
  makeId: () => string,
): { elements: FloorElement[]; heightCells: number } {
  let y = existing.reduce((max, e) => Math.max(max, e.y + e.height + AISLE_CELLS), MARGIN_CELLS + 1);
  let x = MARGIN_CELLS;
  const out: FloorElement[] = [];
  for (const estante of estantes) {
    const g = gondolaForEstante(estante, x, y, makeId());
    if (x > MARGIN_CELLS && x + g.width > widthCells - MARGIN_CELLS) {
      x = MARGIN_CELLS;
      y += g.height + AISLE_CELLS;
      g.x = x;
      g.y = y;
    }
    out.push(g);
    x += g.width + 2;
  }
  const bottom = out.reduce((max, e) => Math.max(max, e.y + e.height), 0);
  return { elements: out, heightCells: bottom + AISLE_CELLS };
}

/** Gira 90° no sentido horário mantendo o centro aproximado e trocando largura/altura. */
export function rotateElement(e: FloorElement): FloorElement {
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  return {
    ...e,
    rotation: normalizeRotation(e.rotation + 90),
    width: e.height,
    height: e.width,
    x: Math.round(cx - e.height / 2),
    y: Math.round(cy - e.width / 2),
  };
}

export function gondolaGeometry(e: FloorElement) {
  const rotation = normalizeRotation(e.rotation);
  const horizontal = rotation === 0 || rotation === 180;
  return {
    rotation,
    horizontal,
    length: horizontal ? e.width : e.height,
    thickness: horizontal ? e.height : e.width,
  };
}

/** Posição contínua (em células) ao longo do comprimento da gôndola -> coordenada no eixo longo. */
export function alongAxis(e: FloorElement, t: number): number {
  const { rotation, length } = gondolaGeometry(e);
  switch (rotation) {
    case 0:
      return e.x + t;
    case 90:
      return e.y + t;
    case 180:
      return e.x + length - t;
    case 270:
      return e.y + length - t;
  }
}

/** Retângulo (em células) da metade da gôndola que pertence à face. */
export function faceHalfRect(e: FloorElement, face: Face) {
  const { rotation, horizontal } = gondolaGeometry(e);
  const aOnLowSide = rotation === 0 || rotation === 270;
  const lowSide = face === "A" ? aOnLowSide : !aOnLowSide;
  if (horizontal) {
    return { x: e.x, y: lowSide ? e.y : e.y + e.height / 2, width: e.width, height: e.height / 2 };
  }
  return { x: lowSide ? e.x : e.x + e.width / 2, y: e.y, width: e.width / 2, height: e.height };
}

export function isColunaReversed(e: FloorElement, face: Face): boolean {
  return face === "A" ? e.colunaReversedA : e.colunaReversedB;
}

export function slotIndexOnFloor(e: FloorElement, face: Face, slotIndex: number, slotCount: number) {
  return isColunaReversed(e, face) ? slotCount - 1 - slotIndex : slotIndex;
}

/** Colunas na ordem em que aparecem ao longo do eixo da gôndola para a face. */
export function colunasOnFloor(e: FloorElement, face: Face, colunas: string[]): string[] {
  return isColunaReversed(e, face) ? [...colunas].reverse() : colunas;
}

/** Célula livre ao lado da face no centro do slot da coluna (mesma regra do Route Engine). */
export function accessCell(
  e: FloorElement,
  slotIndex: number,
  slotCount: number,
  face: Face,
): { x: number; y: number } | null {
  if (slotCount <= 0 || slotIndex < 0 || slotIndex >= slotCount) return null;
  const { rotation, length, thickness } = gondolaGeometry(e);
  const idx = slotIndexOnFloor(e, face, slotIndex, slotCount);
  const off = Math.min(length - 1, Math.floor(((idx + 0.5) * length) / slotCount));
  const isA = face === "A";
  switch (rotation) {
    case 0:
      return { x: e.x + off, y: isA ? e.y - 1 : e.y + thickness };
    case 90:
      return { x: isA ? e.x + thickness : e.x - 1, y: e.y + off };
    case 180:
      return { x: e.x + length - 1 - off, y: isA ? e.y + thickness : e.y - 1 };
    case 270:
      return { x: isA ? e.x - 1 : e.x + thickness, y: e.y + length - 1 - off };
  }
}

export function faceSideLabel(e: FloorElement, face: Face): string {
  const { rotation } = gondolaGeometry(e);
  const sides: Record<Rotation, [string, string]> = {
    0: ["de cima", "de baixo"],
    90: ["da direita", "da esquerda"],
    180: ["de baixo", "de cima"],
    270: ["da esquerda", "da direita"],
  };
  return `pelo corredor ${sides[rotation][face === "A" ? 0 : 1]}`;
}

export type Reachability = {
  width: number;
  height: number;
  blocked: Uint8Array;
  dist: Int32Array;
  hasStart: boolean;
};

/** BFS a partir de todos os inícios para colorir pontos de acesso sem caminho em tempo real. */
export function computeReachability(elements: FloorElement[], width: number, height: number): Reachability {
  const blocked = new Uint8Array(width * height);
  for (const e of elements) {
    if (!isBlocking(e)) continue;
    for (let y = Math.max(0, e.y); y < Math.min(height, e.y + e.height); y++) {
      for (let x = Math.max(0, e.x); x < Math.min(width, e.x + e.width); x++) blocked[y * width + x] = 1;
    }
  }
  const dist = new Int32Array(width * height).fill(-1);
  const starts = elements.filter((e) => e.type === "START_POINT");
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const start of starts) {
    const s = start.y * width + start.x;
    if (s < 0 || s >= dist.length || blocked[s] || dist[s]! >= 0) continue;
    queue[tail++] = s;
    dist[s] = 0;
  }
  while (head < tail) {
    const c = queue[head++]!;
    const x = c % width;
    const neighbors = [x > 0 ? c - 1 : -1, x < width - 1 ? c + 1 : -1, c - width, c + width];
    for (const n of neighbors) {
      if (n < 0 || n >= dist.length || blocked[n] || dist[n]! >= 0) continue;
      dist[n] = dist[c]! + 1;
      queue[tail++] = n;
    }
  }
  return { width, height, blocked, dist, hasStart: starts.length > 0 };
}

export function isAccessReachable(r: Reachability, cell: { x: number; y: number } | null): boolean {
  if (!cell || cell.x < 0 || cell.y < 0 || cell.x >= r.width || cell.y >= r.height) return false;
  const i = cell.y * r.width + cell.x;
  if (r.blocked[i]) return false;
  return !r.hasStart || r.dist[i]! >= 0;
}

export function elementAt(elements: FloorElement[], x: number, y: number): FloorElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]!;
    if (x >= e.x && x < e.x + e.width && y >= e.y && y < e.y + e.height) return e;
  }
  return null;
}

export function toDraft(
  plan: { cellSizeCm: number; widthCells: number; heightCells: number },
  elements: FloorElement[],
): FloorPlanDraft {
  return {
    cellSizeCm: plan.cellSizeCm,
    widthCells: plan.widthCells,
    heightCells: plan.heightCells,
    elements,
  };
}

export function formatMeters(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
}
