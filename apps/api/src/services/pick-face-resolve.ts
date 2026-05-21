import { Location, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sortLocationsByRoute } from "./location-route.js";

export class PickFaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickFaceError";
  }
}

/** Gôndola de estoque de giro com menor saldo; empate por rota. */
export async function resolvePickFaceForProduct(
  productId: string,
  tenantId?: string,
  minFreeSpace = 0,
): Promise<Location> {
  const locations = await prisma.location.findMany({
    where: {
      type: LocationType.PICK_FACE,
      active: true,
      productId,
      ...(tenantId ? { tenantId } : {}),
    },
  });

  if (locations.length === 0) {
    throw new PickFaceError(
      "Nenhum endereço de estoque de giro ativo para este produto. Cadastre ou abasteça.",
    );
  }

  const eligible = locations.filter(
    (l) => l.capacity - l.currentQuantity >= minFreeSpace,
  );
  const pool = eligible.length > 0 ? eligible : locations;

  const byQty = [...pool].sort((a, b) => {
    if (a.currentQuantity !== b.currentQuantity) {
      return a.currentQuantity - b.currentQuantity;
    }
    return 0;
  });

  const minQty = byQty[0]!.currentQuantity;
  const tied = byQty.filter((l) => l.currentQuantity === minQty);
  if (tied.length === 1) return tied[0]!;

  const sorted = sortLocationsByRoute(tied);
  return sorted[0]!;
}

export async function suggestPickFaceDeposit(
  tenantId: string,
  productId: string,
  quantity: number,
): Promise<Location | null> {
  try {
    return await resolvePickFaceForProduct(productId, tenantId, quantity);
  } catch {
    return null;
  }
}
