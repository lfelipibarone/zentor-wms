import { prisma } from "../lib/prisma.js";

/** Prioridade 0–100: quanto maior, mais urgente na fila e na onda. */
export function computeOrderPriority(params: {
  collectionDeadline: Date | null;
  marketplace?: string | null;
}): number {
  const { collectionDeadline, marketplace } = params;
  let score = 20;

  if (marketplace?.toUpperCase().includes("MERCADO")) {
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

  const priority = computeOrderPriority({
    collectionDeadline: deadline,
    marketplace: order.marketplace,
  });

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
): string | null {
  const raw = `${ecommerce ?? ""} ${storeName ?? ""}`.toUpperCase();
  if (raw.includes("MERCADO") || raw.includes("MELI")) return "MERCADO_LIVRE";
  if (raw.includes("SHOPEE")) return "SHOPEE";
  if (raw.includes("AMAZON")) return "AMAZON";
  if (raw.includes("MAGALU") || raw.includes("MAGAZINE")) return "MAGALU";
  return ecommerce?.trim() || null;
}
