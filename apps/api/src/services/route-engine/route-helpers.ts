import type { RoutableLocation, RouteEngine, RouteOrigin } from "./types.js";

type WithPickLocation<L extends RoutableLocation> = { pickLocation: L | null };

/** Itens pendentes com localização na ordem da rota; os sem localização vão ao fim. */
export function sortPendingItemsByEngine<
  L extends RoutableLocation,
  T extends WithPickLocation<L>,
>(
  engine: RouteEngine,
  items: T[],
  isPending: (item: T) => boolean,
  lastLocation?: RoutableLocation | null,
  origin?: RouteOrigin,
): T[] {
  const pending = items.filter(isPending);
  const withLoc = pending.filter((i) => i.pickLocation);
  const withoutLoc = pending.filter((i) => !i.pickLocation);
  const wrapped = withLoc.map((item) => ({ ...item.pickLocation!, __item: item }));
  const sorted = engine.sortByRoute(wrapped, lastLocation ?? null, origin);
  return [...sorted.map((w) => w.__item), ...withoutLoc];
}

export function pickNextItemByEngine<
  L extends RoutableLocation,
  T extends WithPickLocation<L>,
>(
  engine: RouteEngine,
  items: T[],
  isPending: (item: T) => boolean,
  lastLocation?: RoutableLocation | null,
  origin?: RouteOrigin,
): T | null {
  return sortPendingItemsByEngine(engine, items, isPending, lastLocation, origin)[0] ?? null;
}
