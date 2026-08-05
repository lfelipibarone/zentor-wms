/** Gera códigos em intervalo: letras (A–F) ou números (01–10). */
export function expandCodeRange(
  from: string,
  to: string,
  padWidth?: number,
): string[] {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (!f || !t) throw new Error("Informe o início e o fim do intervalo");

  if (/^[A-Z]$/.test(f) && /^[A-Z]$/.test(t)) {
    const start = f.charCodeAt(0);
    const end = t.charCodeAt(0);
    if (end < start) throw new Error("Fim deve ser igual ou posterior ao início");
    return Array.from({ length: end - start + 1 }, (_, i) =>
      String.fromCharCode(start + i),
    );
  }

  const fNum = Number.parseInt(f, 10);
  const tNum = Number.parseInt(t, 10);
  if (!Number.isNaN(fNum) && !Number.isNaN(tNum)) {
    const width =
      padWidth && padWidth > 0
        ? padWidth
        : Math.max(f.length, t.length, String(tNum).length);
    if (tNum < fNum) throw new Error("Fim deve ser igual ou posterior ao início");
    return Array.from({ length: tNum - fNum + 1 }, (_, i) => {
      const n = fNum + i;
      return width > 0 ? String(n).padStart(width, "0") : String(n);
    });
  }

  throw new Error("Use letras (A–F) ou números (01–10)");
}

/** Uma linha ou separadores vírgula/ponto-e-vírgula. */
export function parseCodeList(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const code = raw.trim();
    if (!code) continue;
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(code);
  }
  return result;
}
