/** Converte o texto digitado em % inteira 0–100 (ou null se inválido). */
export function parsePercentText(text: string): number | null {
  const t = text.trim().replace("%", "");
  if (!t || !/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return n >= 0 && n <= 100 ? n : null;
}

export function formatPercent(value: number | null | undefined): string {
  return `${Math.round(value ?? 0)}%`;
}

export function parseUnitsText(text: string): number | null {
  const t = text.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

type LevelLoc = {
  stockMode?: "PERCENT" | "QUANTITY";
  stockQuantity?: number | null;
  minQuantity?: number | null;
  fillPercent?: number | null;
  minPercent?: number | null;
};

/** Gôndola medida em unidades (o picking dá baixa sozinho). */
export function isQuantityMode(loc: LevelLoc | null | undefined): boolean {
  return loc?.stockMode === "QUANTITY" && loc.stockQuantity != null;
}

/** "12 un." na gôndola por quantidade, "45%" nas demais. */
export function formatLevel(loc: LevelLoc | null | undefined): string {
  if (isQuantityMode(loc)) return `${loc!.stockQuantity} un.`;
  return formatPercent(loc?.fillPercent);
}

export function formatMinLevel(loc: LevelLoc | null | undefined): string | null {
  if (isQuantityMode(loc)) return loc!.minQuantity != null ? `${loc!.minQuantity} un.` : null;
  return loc?.minPercent != null ? formatPercent(loc.minPercent) : null;
}
