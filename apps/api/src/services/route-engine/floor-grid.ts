import type { FloorElementSpec, FloorPlanSpec } from "./types.js";

export type FloorGrid = {
  width: number;
  height: number;
  /** 1 = célula bloqueada (gôndola ou obstáculo). */
  blocked: Uint8Array;
};

export function isBlockingElement(e: FloorElementSpec): boolean {
  return e.type === "GONDOLA" || e.type === "OBSTACLE" || e.type === "RECEIVING_AREA";
}

export function buildFloorGrid(plan: FloorPlanSpec): FloorGrid {
  const width = Math.max(1, plan.widthCells);
  const height = Math.max(1, plan.heightCells);
  const blocked = new Uint8Array(width * height);
  for (const e of plan.elements) {
    if (!isBlockingElement(e)) continue;
    for (let y = e.y; y < e.y + e.height; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = e.x; x < e.x + e.width; x++) {
        if (x < 0 || x >= width) continue;
        blocked[y * width + x] = 1;
      }
    }
  }
  return { width, height, blocked };
}

export function cellIndex(grid: FloorGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1;
  return y * grid.width + x;
}

export function isWalkable(grid: FloorGrid, cell: number): boolean {
  return cell >= 0 && cell < grid.blocked.length && grid.blocked[cell] === 0;
}

/** Primeira célula livre encostada no elemento bloqueante (de cima, em sentido horário). */
export function perimeterCell(grid: FloorGrid, e: FloorElementSpec): number {
  const cells: Array<[number, number]> = [];
  for (let x = e.x; x < e.x + e.width; x++) cells.push([x, e.y - 1]);
  for (let y = e.y; y < e.y + e.height; y++) cells.push([e.x + e.width, y]);
  for (let x = e.x + e.width - 1; x >= e.x; x--) cells.push([x, e.y + e.height]);
  for (let y = e.y + e.height - 1; y >= e.y; y--) cells.push([e.x - 1, y]);
  for (const [x, y] of cells) {
    const c = cellIndex(grid, x, y);
    if (isWalkable(grid, c)) return c;
  }
  return -1;
}

/** Primeira célula livre do elemento (pontos operacionais não bloqueiam). */
export function elementAnchorCell(grid: FloorGrid, e: FloorElementSpec): number {
  for (let y = e.y; y < e.y + Math.max(1, e.height); y++) {
    for (let x = e.x; x < e.x + Math.max(1, e.width); x++) {
      const c = cellIndex(grid, x, y);
      if (isWalkable(grid, c)) return c;
    }
  }
  return -1;
}
