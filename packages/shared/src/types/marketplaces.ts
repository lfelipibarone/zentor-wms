export const MARKETPLACE_CODES = [
  "MERCADO_LIVRE",
  "SHOPEE",
  "AMAZON",
  "MAGALU",
  "AMERICANAS",
  "B2W",
  "SHEIN",
  "TIKTOK",
  "OLX",
  "SITE_PROPRIO",
  "MANUAL",
  "OUTROS",
] as const;

export type MarketplaceCode = (typeof MARKETPLACE_CODES)[number];

export const CANONICAL_MARKETPLACE_CODES = MARKETPLACE_CODES.filter(
  (c) => c !== "OUTROS",
) as Exclude<MarketplaceCode, "OUTROS">[];

export const MARKETPLACE_LABEL: Record<MarketplaceCode, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
  AMAZON: "Amazon",
  MAGALU: "Magalu",
  AMERICANAS: "Americanas",
  B2W: "B2W",
  SHEIN: "Shein",
  TIKTOK: "TikTok",
  OLX: "OLX",
  SITE_PROPRIO: "Site próprio",
  MANUAL: "Manual",
  OUTROS: "Outros",
};

export const MARKETPLACE_BADGE: Record<
  MarketplaceCode,
  { bg: string; text: string }
> = {
  MERCADO_LIVRE: { bg: "bg-yellow-100", text: "text-yellow-900" },
  SHOPEE: { bg: "bg-orange-100", text: "text-orange-900" },
  AMAZON: { bg: "bg-slate-900", text: "text-white" },
  MAGALU: { bg: "bg-sky-100", text: "text-sky-900" },
  AMERICANAS: { bg: "bg-red-100", text: "text-red-900" },
  B2W: { bg: "bg-blue-100", text: "text-blue-900" },
  SHEIN: { bg: "bg-pink-100", text: "text-pink-900" },
  TIKTOK: { bg: "bg-fuchsia-100", text: "text-fuchsia-900" },
  OLX: { bg: "bg-purple-100", text: "text-purple-900" },
  SITE_PROPRIO: { bg: "bg-emerald-100", text: "text-emerald-900" },
  MANUAL: { bg: "bg-slate-100", text: "text-slate-700" },
  OUTROS: { bg: "bg-slate-100", text: "text-slate-600" },
};

const CANONICAL_SET = new Set<string>(CANONICAL_MARKETPLACE_CODES);

export function normalizeMarketplace(
  raw?: string | null,
): MarketplaceCode | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();

  if (CANONICAL_SET.has(upper)) {
    return upper as MarketplaceCode;
  }
  if (upper === "OUTROS") return "OUTROS";

  if (upper.includes("MERCADO") || upper.includes("MELI")) {
    return "MERCADO_LIVRE";
  }
  if (upper.includes("SHOPEE")) return "SHOPEE";
  if (upper.includes("AMAZON")) return "AMAZON";
  if (upper.includes("MAGALU") || upper.includes("MAGAZINE")) return "MAGALU";
  if (upper.includes("AMERICANAS") || upper.includes("LOJAS AMERICANAS")) {
    return "AMERICANAS";
  }
  if (upper.includes("B2W") || upper.includes("SUBMARINO") || upper.includes("SHOPTIME")) {
    return "B2W";
  }
  if (upper.includes("SHEIN")) return "SHEIN";
  if (upper.includes("TIKTOK") || upper.includes("TIK TOK")) return "TIKTOK";
  if (upper.includes("OLX")) return "OLX";
  if (
    upper.includes("SITE") ||
    upper.includes("PROPRIO") ||
    upper.includes("LOJA VIRTUAL") ||
    upper.includes("ECOMMERCE")
  ) {
    return "SITE_PROPRIO";
  }
  if (upper.includes("MANUAL")) return "MANUAL";

  return null;
}

export function formatMarketplace(raw?: string | null): string {
  const code = normalizeMarketplace(raw);
  return code ? MARKETPLACE_LABEL[code] : raw?.trim() || "—";
}

export function isKnownCanonicalMarketplace(value: string): boolean {
  return CANONICAL_SET.has(value);
}

/** Bônus de prioridade por marketplace (0 = sem bônus). */
export const MARKETPLACE_PRIORITY_BONUS: Partial<
  Record<MarketplaceCode, number>
> = {
  MERCADO_LIVRE: 5,
};
