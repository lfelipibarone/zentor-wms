import { CargoTransferStatus, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { formatRouteLabel } from "./packing-queue-sort.js";
import { getRouteEngine } from "./route-engine/index.js";
import { needsReplenishment, percentToFill } from "./stock-percent.js";
import { stockModeFields } from "./location-level.js";

export type ReplenishmentNeed = {
  id: string;
  pickFaceId: string;
  pickFaceBarcode: string;
  routeLabel: string;
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string | null;
  fillPercent: number;
  minPercent: number;
  /** Pontos de % que faltam para encher a gôndola */
  percentToFill: number;
  stockMode: string;
  stockQuantity: number | null;
  minQuantity: number | null;
  capacity: number;
  suggestedPulmao: {
    id: string;
    barcode: string;
    label: string;
    /** % deste SKU no pulmão */
    percent: number;
  } | null;
};

/** Gôndolas com % igual ou abaixo da % mínima (sem transporte já a caminho). */
export async function listReplenishmentNeeds(
  tenantId: string,
): Promise<ReplenishmentNeed[]> {
  const [faces, inTransit, pulmaoStocks] = await Promise.all([
    prisma.location.findMany({
      where: {
        tenantId,
        active: true,
        type: LocationType.PICK_FACE,
        productId: { not: null },
      },
      include: {
        product: {
          select: { id: true, sku: true, name: true, imageUrl: true },
        },
      },
    }),
    prisma.cargoTransfer.findMany({
      where: { tenantId, status: CargoTransferStatus.IN_TRANSIT },
      select: { targetPickFaceId: true },
    }),
    prisma.locationStock.findMany({
      where: {
        tenantId,
        percent: { gt: 0 },
        location: { active: true, type: LocationType.PULMAO },
      },
      include: {
        location: { select: { id: true, barcode: true, corridor: true, row: true } },
      },
    }),
  ]);

  const blockedFaceIds = new Set(
    inTransit
      .map((t) => t.targetPickFaceId)
      .filter((id): id is string => id != null),
  );

  const bestPulmaoByProduct = new Map<string, (typeof pulmaoStocks)[number]>();
  for (const stock of pulmaoStocks) {
    const best = bestPulmaoByProduct.get(stock.productId);
    if (!best || stock.percent > best.percent) {
      bestPulmaoByProduct.set(stock.productId, stock);
    }
  }

  const lowFaces = faces.filter(
    (f) => needsReplenishment(f.fillPercent, f.minPercent) && f.product,
  );

  const sorted = (await getRouteEngine(tenantId)).sortByRoute(lowFaces);

  return sorted
    .filter((face) => !blockedFaceIds.has(face.id))
    .map((face) => {
      const product = face.product!;
      const bestPulmao = bestPulmaoByProduct.get(product.id) ?? null;

      return {
        id: face.id,
        pickFaceId: face.id,
        pickFaceBarcode: face.barcode,
        routeLabel: formatRouteLabel(face),
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        imageUrl: product.imageUrl,
        fillPercent: face.fillPercent,
        minPercent: face.minPercent,
        percentToFill: percentToFill(face.fillPercent),
        ...stockModeFields(face),
        suggestedPulmao: bestPulmao
          ? {
              id: bestPulmao.location.id,
              barcode: bestPulmao.location.barcode,
              label: formatRouteLabel(bestPulmao.location),
              percent: bestPulmao.percent,
            }
          : null,
      };
    });
}
