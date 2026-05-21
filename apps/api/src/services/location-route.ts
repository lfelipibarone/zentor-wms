/** Coordenada normalizada de corredor/fileira para ordenação de rota. */
export type RouteCoord = { corridor: number; row: number };

export type LocationLike = {
  corridor: string;
  row: string;
  id?: string;
};

function parseSegment(value: string): number {
  const trimmed = value.trim().toUpperCase();
  const num = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(num)) return num;
  if (trimmed.length === 1 && trimmed >= "A" && trimmed <= "Z") {
    return trimmed.charCodeAt(0) - 64;
  }
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = hash * 31 + trimmed.charCodeAt(i);
  }
  return hash;
}

export function toRouteCoord(loc: LocationLike): RouteCoord {
  return {
    corridor: parseSegment(loc.corridor),
    row: parseSegment(loc.row),
  };
}

export function locationDistance(a: RouteCoord, b: RouteCoord): number {
  return Math.abs(a.corridor - b.corridor) + Math.abs(a.row - b.row);
}

/** Ordenação serpentine por corredor (eficiente em corredores longos). */
export function sortLocationsByRoute<T extends LocationLike>(
  locations: T[],
  start?: RouteCoord | null,
): T[] {
  if (locations.length <= 1) return [...locations];

  const withCoord = locations.map((loc) => ({
    loc,
    coord: toRouteCoord(loc),
  }));

  const corridors = [...new Set(withCoord.map((x) => x.coord.corridor))].sort(
    (a, b) => a - b,
  );

  const ordered: typeof withCoord = [];
  let reverse = false;
  for (const c of corridors) {
    const inCorridor = withCoord
      .filter((x) => x.coord.corridor === c)
      .sort((a, b) =>
        reverse ? b.coord.row - a.coord.row : a.coord.row - b.coord.row,
      );
    ordered.push(...inCorridor);
    reverse = !reverse;
  }

  if (!start) return ordered.map((x) => x.loc);

  const remaining = [...ordered];
  const result: typeof withCoord = [];
  let current = start;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = locationDistance(current, remaining[i]!.coord);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    result.push(next);
    current = next.coord;
  }

  return result.map((x) => x.loc);
}

export type ItemWithPickLocation = {
  id: string;
  lineNumber?: number;
  quantityOrdered?: number;
  quantityPicked?: number;
  pickLocation: LocationLike | null;
};

/** Próximo item pendente pela rota mais próxima da última posição visitada. */
export function pickNextItemByRoute<T extends ItemWithPickLocation>(
  items: T[],
  isPending: (item: T) => boolean,
  lastLocation?: LocationLike | null,
): T | null {
  const pending = items.filter(isPending).filter((i) => i.pickLocation);
  if (pending.length === 0) {
    return items.find(isPending) ?? null;
  }

  const sorted = sortLocationsByRoute(
    pending.map((i) => i.pickLocation!),
    lastLocation ? toRouteCoord(lastLocation) : null,
  );

  const firstLoc = sorted[0];
  if (!firstLoc) return pending[0] ?? null;

  return (
    pending.find(
      (i) =>
        i.pickLocation!.corridor === firstLoc.corridor &&
        i.pickLocation!.row === firstLoc.row,
    ) ?? pending[0]!
  );
}

/** Lista de itens pendentes ordenados pela rota (preview "depois"). */
export function sortPendingItemsByRoute<T extends ItemWithPickLocation>(
  items: T[],
  isPending: (item: T) => boolean,
  lastLocation?: LocationLike | null,
): T[] {
  const pending = items.filter(isPending).filter((i) => i.pickLocation);
  const withoutLoc = items.filter(isPending).filter((i) => !i.pickLocation);

  const locs = sortLocationsByRoute(
    pending.map((i) => i.pickLocation!),
    lastLocation ? toRouteCoord(lastLocation) : null,
  );

  const ordered: T[] = [];
  for (const loc of locs) {
    const match = pending.find(
      (i) =>
        i.pickLocation!.corridor === loc.corridor &&
        i.pickLocation!.row === loc.row,
    );
    if (match && !ordered.includes(match)) ordered.push(match);
  }
  for (const p of pending) {
    if (!ordered.includes(p)) ordered.push(p);
  }
  return [...ordered, ...withoutLoc];
}
