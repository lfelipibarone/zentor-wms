import { matchLocation, sequenceKeyIn, type ApproachWaveDef, type ZoneLocation } from "./matching.js";

/** Valor do filtro do packing para pedidos e linhas fora de todas as áreas. */
export const NO_ZONE = "none";

export type PartPlan<T> = {
  approachWaveId: string | null;
  name: string;
  color: string | null;
  sortOrder: number;
  lines: T[];
};

function byCadastro(waves: ApproachWaveDef[]): ApproachWaveDef[] {
  return [...waves].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Agrupa as linhas por onda de aproximação, na ordem do cadastro; fora de área vira "Sem área", no fim. */
export function planWaveParts<T extends { location: ZoneLocation }>(lines: T[], waves: ApproachWaveDef[]): PartPlan<T>[] {
  const byWave = new Map<string, T[]>();
  const none: T[] = [];
  for (const line of lines) {
    const match = matchLocation(waves, line.location);
    if (!match) {
      none.push(line);
      continue;
    }
    const list = byWave.get(match.waveId) ?? [];
    list.push(line);
    byWave.set(match.waveId, list);
  }
  const parts: PartPlan<T>[] = byCadastro(waves)
    .filter((w) => byWave.has(w.id))
    .map((w, i) => ({ approachWaveId: w.id, name: w.name, color: w.color, sortOrder: i, lines: byWave.get(w.id)! }));
  if (none.length > 0) {
    parts.push({ approachWaveId: null, name: "Sem área", color: null, sortOrder: parts.length, lines: none });
  }
  return parts;
}

/** Ordena pela sequência da onda (parada, depois coluna); o que está fora da onda vai para o fim, na ordem original. */
export function sortBySequence<T>(items: T[], wave: ApproachWaveDef, locate: (item: T) => ZoneLocation | null): T[] {
  return items
    .map((item, i) => {
      const loc = locate(item);
      return { item, i, key: (loc ? sequenceKeyIn(wave, loc) : null) ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.item);
}

/** Onda de packing do pedido: a com mais unidades; empate fica com a primeira do cadastro; null = sem área. */
export function packingZoneFor(
  items: Array<{ quantity: number; location: ZoneLocation | null }>,
  waves: ApproachWaveDef[],
): string | null {
  const totals = new Map<string, number>();
  for (const it of items) {
    if (!it.location || it.quantity <= 0) continue;
    const match = matchLocation(waves, it.location);
    if (match) totals.set(match.waveId, (totals.get(match.waveId) ?? 0) + it.quantity);
  }
  let best: string | null = null;
  let bestQty = 0;
  for (const w of byCadastro(waves)) {
    const qty = totals.get(w.id) ?? 0;
    if (qty > bestQty) {
      best = w.id;
      bestQty = qty;
    }
  }
  return best;
}

/** Fila de uma área do packing: urgência maior primeiro, depois a sequência da área; sem posição vai para o fim. */
export function sortByUrgencyThenSequence<T>(
  items: T[],
  urgency: (item: T) => number,
  key: (item: T) => number | null,
): T[] {
  return items
    .map((item, i) => ({ item, i, u: urgency(item), k: key(item) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => b.u - a.u || a.k - b.k || a.i - b.i)
    .map((x) => x.item);
}
