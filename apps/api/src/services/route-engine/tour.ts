/**
 * Caminho aberto (sem retorno) sobre `n` nós: vizinho mais próximo seguido de 2-opt.
 * `fromStart(i)` é o custo do ponto de partida até o nó i (0 quando não há partida).
 */
export function solveOpenTour(
  n: number,
  fromStart: (i: number) => number,
  dist: (i: number, j: number) => number,
  opts?: { maxTwoOptNodes?: number; maxPasses?: number },
): number[] {
  if (n <= 1) return n === 1 ? [0] : [];

  const remaining = new Set<number>(Array.from({ length: n }, (_, i) => i));
  const route: number[] = [];
  let current = -1;
  while (remaining.size > 0) {
    let best = -1;
    let bestCost = Infinity;
    for (const i of remaining) {
      const c = current < 0 ? fromStart(i) : dist(current, i);
      if (c < bestCost || (c === bestCost && i < best)) {
        bestCost = c;
        best = i;
      }
    }
    route.push(best);
    remaining.delete(best);
    current = best;
  }

  if (n > (opts?.maxTwoOptNodes ?? 150)) return route;

  const cost = (a: number, b: number) => (a < 0 ? fromStart(b) : dist(a, b));
  const maxPasses = opts?.maxPasses ?? 50;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < n - 1; i++) {
      const before = i === 0 ? -1 : route[i - 1]!;
      for (let j = i + 1; j < n; j++) {
        const after = j === n - 1 ? null : route[j + 1]!;
        const oldCost =
          cost(before, route[i]!) + (after === null ? 0 : dist(route[j]!, after));
        const newCost =
          cost(before, route[j]!) + (after === null ? 0 : dist(route[i]!, after));
        if (newCost + 1e-9 < oldCost) {
          route.splice(i, j - i + 1, ...route.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return route;
}
