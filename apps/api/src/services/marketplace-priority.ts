import {
  MARKETPLACE_PRIORITY_BONUS,
  normalizeMarketplace,
  type MarketplaceCode,
} from "@wms/shared";
import { prisma } from "../lib/prisma.js";

/** Prioridade 0–100: quanto maior, mais urgente na fila e na onda. */
export function computeOrderPriority(params: {
  collectionDeadline: Date | null;
  marketplace?: string | null;
}): number {
  const { collectionDeadline, marketplace } = params;
  let score = 20;

  const code = normalizeMarketplace(marketplace);
  if (code && MARKETPLACE_PRIORITY_BONUS[code]) {
    score += MARKETPLACE_PRIORITY_BONUS[code]!;
  } else if (marketplace?.toUpperCase().includes("MERCADO")) {
    score += 5;
  }

  if (!collectionDeadline) {
    return score;
  }

  const msUntil = collectionDeadline.getTime() - Date.now();
  const hoursUntil = msUntil / (1000 * 60 * 60);

  if (hoursUntil <= 0) return 100;
  if (hoursUntil <= 2) return 95;
  if (hoursUntil <= 4) return 85;
  if (hoursUntil <= 8) return 70;
  if (hoursUntil <= 24) return 55;
  if (hoursUntil <= 48) return 40;
  return 25;
}

/** Enriquece deadline/prioridade após ingestão (ML: usa dados já no pedido ou futura API). */
export async function enrichOrderPriority(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;

  let deadline = order.collectionDeadline;

  if (
    !deadline &&
    order.marketplace?.toUpperCase().includes("MERCADO") &&
    order.shippingLabel
  ) {
    const parsed = tryParseDeadlineFromLabel(order.shippingLabel);
    if (parsed) deadline = parsed;
  }

  const wmsScore = computeOrderPriority({
    collectionDeadline: deadline,
    marketplace: order.marketplace,
  });

  const erpScore = order.erpPriority ?? null;
  const priority =
    erpScore !== null ? Math.max(wmsScore, erpScore) : wmsScore;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      priority,
      ...(deadline && !order.collectionDeadline
        ? { collectionDeadline: deadline }
        : {}),
    },
  });
}

function tryParseDeadlineFromLabel(label: string): Date | null {
  const iso = Date.parse(label);
  if (!Number.isNaN(iso)) return new Date(iso);
  return null;
}

export function detectMarketplaceFromTiny(
  ecommerce?: string | null,
  storeName?: string | null,
  extra?: string | null,
): string | null {
  const parts = [ecommerce, storeName, extra].filter(Boolean).join(" ");
  const normalized = normalizeMarketplace(parts);
  if (normalized) return normalized;
  return ecommerce?.trim() || storeName?.trim() || null;
}

export function marketplaceDisplayLabel(
  raw: string | null | undefined,
): string {
  const code = normalizeMarketplace(raw);
  if (code) {
    const labels: Record<MarketplaceCode, string> = {
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
    return labels[code];
  }
  return raw?.trim() || "Sem marketplace";
}
