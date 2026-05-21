import { CargoTransferStatus, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { formatRouteLabel } from "./packing-queue-sort.js";
import { sortLocationsByRoute } from "./location-route.js";

export type ReplenishmentNeed = {
  id: string;
  pickFaceId: string;
  pickFaceBarcode: string;
  routeLabel: string;
  productId: string;
  sku: string;
  productName: string;
  currentQuantity: number;
  minThreshold: number;
  capacity: number;
  deficit: number;
  suggestedPulmao: {
    id: string;
    barcode: string;
    label: string;
    currentQuantity: number;
  } | null;
};

export async function listReplenishmentNeeds(
  tenantId: string,
): Promise<ReplenishmentNeed[]> {
  const [faces, inTransit, pulmaos] = await Promise.all([
    prisma.location.findMany({
      where: {
        tenantId,
        active: true,
        type: LocationType.PICK_FACE,
        productId: { not: null },
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
      },
    }),
    prisma.cargoTransfer.findMany({
      where: { tenantId, status: CargoTransferStatus.IN_TRANSIT },
      select: { targetPickFaceId: true },
    }),
    prisma.location.findMany({
      where: {
        tenantId,
        active: true,
        type: LocationType.PULMAO,
        productId: { not: null },
      },
    }),
  ]);

  const blockedFaceIds = new Set(
    inTransit
      .map((t) => t.targetPickFaceId)
      .filter((id): id is string => id != null),
  );

  const lowFaces = faces.filter(
    (f) => f.currentQuantity <= f.minThreshold && f.product,
  );

  const sorted = sortLocationsByRoute(lowFaces);

  return sorted
    .filter((face) => !blockedFaceIds.has(face.id))
    .map((face) => {
      const product = face.product!;
      const deficit = Math.max(0, face.minThreshold - face.currentQuantity);
      const room = Math.max(0, face.capacity - face.currentQuantity);
      const qtyNeeded = Math.min(
        deficit > 0 ? deficit : room,
        room || deficit || 1,
      );

      const pulmaoCandidates = pulmaos
        .filter((p) => p.productId === product.id && p.currentQuantity > 0)
        .sort((a, b) => b.currentQuantity - a.currentQuantity);
      const bestPulmao = pulmaoCandidates[0] ?? null;

      return {
        id: face.id,
        pickFaceId: face.id,
        pickFaceBarcode: face.barcode,
        routeLabel: formatRouteLabel(face),
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        currentQuantity: face.currentQuantity,
        minThreshold: face.minThreshold,
        capacity: face.capacity,
        deficit: qtyNeeded,
        suggestedPulmao: bestPulmao
          ? {
              id: bestPulmao.id,
              barcode: bestPulmao.barcode,
              label: formatRouteLabel(bestPulmao),
              currentQuantity: bestPulmao.currentQuantity,
            }
          : null,
      };
    });
}
