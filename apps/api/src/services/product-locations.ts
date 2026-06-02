import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode } from "./location-stock.js";
import { formatRouteLabel } from "./packing-queue-sort.js";
import { sortLocationsByRoute } from "./location-route.js";
import { resolvePickFaceForProduct } from "./pick-face-resolve.js";

export class ProductLocationsError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "ProductLocationsError";
  }
}

export async function listProductLocations(
  tenantId: string,
  productCode: string,
  type: LocationType,
) {
  const product = await findProductByBarcode(productCode);
  if (!product) {
    throw new ProductLocationsError("Produto não encontrado", 404);
  }

  const locations = await prisma.location.findMany({
    where: {
      tenantId,
      active: true,
      type,
      productId: product.id,
      ...(type === LocationType.PULMAO ? { currentQuantity: { gt: 0 } } : {}),
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          barcode: true,
          imageUrl: true,
        },
      },
    },
  });

  const sorted =
    type === LocationType.PULMAO
      ? [...locations].sort((a, b) => b.currentQuantity - a.currentQuantity)
      : sortLocationsByRoute(locations);

  let suggestedId: string | null = null;
  if (type === LocationType.PICK_FACE && sorted.length > 0) {
    const best = await resolvePickFaceForProduct(tenantId, product.id, 1);
    suggestedId = best?.id ?? sorted[0]?.id ?? null;
  } else if (type === LocationType.PULMAO && sorted.length > 0) {
    suggestedId = sorted[0]!.id;
  }

  return {
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      barcode: product.barcode,
      imageUrl: product.imageUrl,
    },
    locations: sorted.map((loc) => ({
      id: loc.id,
      barcode: loc.barcode,
      label: formatRouteLabel(loc),
      corridor: loc.corridor,
      row: loc.row,
      currentQuantity: loc.currentQuantity,
      capacity: loc.capacity,
      minThreshold: loc.minThreshold,
      isSuggested: loc.id === suggestedId,
    })),
  };
}
