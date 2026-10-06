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
