import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const MAX_PICK_FACE_PER_PRODUCT = 3;

export class LocationRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationRuleError";
  }
}

/** Conta endereços de estoque de giro (PICK_FACE) ativos para um SKU. */
export async function countPickFacesForProduct(
  tenantId: string,
  productId: string,
  excludeLocationId?: string,
): Promise<number> {
  return prisma.location.count({
    where: {
      tenantId,
      type: LocationType.PICK_FACE,
      active: true,
      productId,
      ...(excludeLocationId ? { id: { not: excludeLocationId } } : {}),
    },
  });
}

export async function assertMaxPickFaceLocations(
  tenantId: string,
  productId: string | null | undefined,
  type: LocationType,
  excludeLocationId?: string,
): Promise<void> {
  if (type !== LocationType.PICK_FACE || !productId) return;

  const count = await countPickFacesForProduct(
    tenantId,
    productId,
    excludeLocationId,
  );
  if (count >= MAX_PICK_FACE_PER_PRODUCT) {
    throw new LocationRuleError(
      `SKU já possui ${MAX_PICK_FACE_PER_PRODUCT} endereços de estoque de giro`,
    );
  }
}

export { MAX_PICK_FACE_PER_PRODUCT };
