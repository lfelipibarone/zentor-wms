import {
  CANONICAL_MARKETPLACE_CODES,
  normalizeMarketplace,
} from "@wms/shared";

/** Espelha o filtro da API para listas carregadas no cliente (ex.: fila de packing). */
export function matchesMarketplaceFilter(
  marketplace: string | null | undefined,
  filter: string,
): boolean {
  if (!filter.trim()) return true;
  const m = filter.trim();

  if (m === "SEM_MARKETPLACE") return !marketplace;

  if (m === "OUTROS") {
    if (!marketplace) return false;
    const norm = normalizeMarketplace(marketplace);
    if (norm === "OUTROS") return true;
    return (
      !CANONICAL_MARKETPLACE_CODES.includes(
        marketplace as (typeof CANONICAL_MARKETPLACE_CODES)[number],
      ) && norm === null
    );
  }

  const normalized = normalizeMarketplace(m);
  if (normalized && normalized !== "OUTROS") {
    return normalizeMarketplace(marketplace) === normalized;
  }

  return marketplace === m;
}
