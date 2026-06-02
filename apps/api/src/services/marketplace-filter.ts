import type { Prisma } from "@prisma/client";
import {
  CANONICAL_MARKETPLACE_CODES,
  normalizeMarketplace,
} from "@wms/shared";

/** Filtro de marketplace na API: código canônico, OUTROS ou SEM_MARKETPLACE. */
export function marketplaceWhereClause(
  marketplace?: string | null,
): Prisma.OrderWhereInput | undefined {
  if (!marketplace?.trim()) return undefined;
  const m = marketplace.trim();

  if (m === "SEM_MARKETPLACE") {
    return { marketplace: null };
  }

  if (m === "OUTROS") {
    return {
      AND: [
        { marketplace: { not: null } },
        {
          NOT: {
            marketplace: { in: [...CANONICAL_MARKETPLACE_CODES] },
          },
        },
      ],
    };
  }

  const normalized = normalizeMarketplace(m);
  if (normalized && normalized !== "OUTROS") {
    return { marketplace: normalized };
  }

  return { marketplace: m };
}
