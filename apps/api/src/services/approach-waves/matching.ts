import { colunaFromRow } from "../location-route.js";

export type Face = "A" | "B";

export type ApproachStop = {
  estanteId: string;
  face: Face;
  colunaFrom: number | null;
  colunaTo: number | null;
};

export type ApproachWaveDef = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  stops: ApproachStop[];
};

export type ZoneLocation = { estanteId?: string | null; face?: string | null; row: string };

export type ZoneMatch = { waveId: string; stopIndex: number; colunaRank: number };

const STOP_WEIGHT = 100_000;

function faceOf(face: string | null | undefined): Face {
  return String(face ?? "A").trim().toUpperCase() === "B" ? "B" : "A";
}

function stopBounds(stop: ApproachStop): { min: number; max: number } | null {
  if (stop.colunaFrom == null && stop.colunaTo == null) return null;
  const a = stop.colunaFrom ?? stop.colunaTo!;
  const b = stop.colunaTo ?? stop.colunaFrom!;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Posição da coluna dentro da parada, no sentido de → até; null = fora da parada. */
export function colunaRankInStop(stop: ApproachStop, loc: ZoneLocation): number | null {
  if (!loc.estanteId || loc.estanteId !== stop.estanteId || faceOf(loc.face) !== stop.face) return null;
  const n = Number.parseInt(colunaFromRow(loc.row), 10);
  const bounds = stopBounds(stop);
  if (!bounds) return Number.isNaN(n) ? STOP_WEIGHT - 1 : n;
  if (Number.isNaN(n) || n < bounds.min || n > bounds.max) return null;
  const descending = stop.colunaFrom != null && stop.colunaTo != null && stop.colunaFrom > stop.colunaTo;
  return descending ? bounds.max - n : n - bounds.min;
}

/** Primeira onda (pela ordem do cadastro) e parada que contêm a localização. */
export function matchLocation(waves: ApproachWaveDef[], loc: ZoneLocation): ZoneMatch | null {
  const ordered = [...waves].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const wave of ordered) {
    for (let i = 0; i < wave.stops.length; i++) {
      const rank = colunaRankInStop(wave.stops[i]!, loc);
      if (rank != null) return { waveId: wave.id, stopIndex: i, colunaRank: rank };
    }
  }
  return null;
}

export function sequenceKey(match: ZoneMatch): number {
  return match.stopIndex * STOP_WEIGHT + match.colunaRank;
}

export function sequenceKeyIn(wave: ApproachWaveDef, loc: ZoneLocation): number | null {
  const match = matchLocation([wave], loc);
  return match ? sequenceKey(match) : null;
}

export function stopsOverlap(a: ApproachStop, b: ApproachStop): boolean {
  if (a.estanteId !== b.estanteId || a.face !== b.face) return false;
  const ra = stopBounds(a);
  const rb = stopBounds(b);
  if (!ra || !rb) return true;
  return ra.min <= rb.max && rb.min <= ra.max;
}

export function formatStop(stop: ApproachStop, code: (estanteId: string) => string): string {
  const side = stop.face === "A" ? "LD" : "LE";
  if (stop.colunaFrom == null && stop.colunaTo == null) return `${code(stop.estanteId)} ${side}`;
  return `${code(stop.estanteId)} ${side} ${stop.colunaFrom ?? stop.colunaTo}→${stop.colunaTo ?? stop.colunaFrom}`;
}

/** Mensagens para cada par de paradas que atendem as mesmas colunas (em ondas do mesmo tipo). */
export function findStopOverlaps(waves: ApproachWaveDef[], code: (estanteId: string) => string): string[] {
  const all = waves.flatMap((wave) => wave.stops.map((stop) => ({ wave, stop })));
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (!stopsOverlap(a.stop, b.stop)) continue;
      out.push(
        a.wave === b.wave
          ? `${formatStop(a.stop, code)} aparece duas vezes em "${a.wave.name}"`
          : `${formatStop(a.stop, code)} está em "${a.wave.name}" e em "${b.wave.name}"`,
      );
    }
  }
  return out;
}
