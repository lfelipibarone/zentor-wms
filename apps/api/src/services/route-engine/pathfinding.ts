import { isWalkable, type FloorGrid } from "./floor-grid.js";

export type DistanceField = {
  /** Passos (células) até a origem; -1 = inalcançável. */
  dist: Int32Array;
  prev: Int32Array;
};

/** BFS 4-vizinhos: custo uniforme por célula. */
export function computeDistanceField(grid: FloorGrid, source: number): DistanceField {
  const size = grid.width * grid.height;
  const dist = new Int32Array(size).fill(-1);
  const prev = new Int32Array(size).fill(-1);
  if (!isWalkable(grid, source)) return { dist, prev };

  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  queue[tail++] = source;
  dist[source] = 0;

  while (head < tail) {
    const c = queue[head++]!;
    const x = c % grid.width;
    const next = dist[c]! + 1;
    const neighbors = [
      x > 0 ? c - 1 : -1,
      x < grid.width - 1 ? c + 1 : -1,
      c - grid.width,
      c + grid.width,
    ];
    for (const n of neighbors) {
      if (n < 0 || n >= size || grid.blocked[n] || dist[n]! >= 0) continue;
      dist[n] = next;
      prev[n] = c;
      queue[tail++] = n;
    }
  }

  return { dist, prev };
}

/** Caminho da origem do campo até `target` (inclusive), ou [] se inalcançável. */
export function tracePath(field: DistanceField, target: number): number[] {
  if (target < 0 || field.dist[target]! < 0) return [];
  const path: number[] = [];
  for (let c = target; c >= 0; c = field.prev[c]!) path.push(c);
  return path.reverse();
}

/** Cache LRU de campos de distância por célula de origem. */
export class DistanceFieldCache {
  private readonly fields = new Map<number, DistanceField>();

  constructor(
    private readonly grid: FloorGrid,
    private readonly maxEntries = 256,
  ) {}

  get(source: number): DistanceField {
    const hit = this.fields.get(source);
    if (hit) {
      this.fields.delete(source);
      this.fields.set(source, hit);
      return hit;
    }
    const field = computeDistanceField(this.grid, source);
    this.fields.set(source, field);
    if (this.fields.size > this.maxEntries) {
      const oldest = this.fields.keys().next().value;
      if (oldest !== undefined) this.fields.delete(oldest);
    }
    return field;
  }

  steps(from: number, to: number): number {
    if (from === to) return isWalkable(this.grid, from) ? 0 : -1;
    return this.get(from).dist[to] ?? -1;
  }
}
