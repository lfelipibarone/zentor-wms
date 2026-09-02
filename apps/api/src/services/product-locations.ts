import type { Prisma } from "@prisma/client";
import { LocationType, OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildPaginationMeta } from "../lib/pagination.js";
import { enrichOrderPriority } from "./marketplace-priority.js";
import { findProductByBarcode } from "./location-stock.js";
import { formatRouteLabel } from "./packing-queue-sort.js";
import { sortLocationsByRoute } from "./location-route.js";
import { resolvePickFaceForProduct } from "./pick-face-resolve.js";
import { selectableProductWhere } from "./product-selectable.js";
import { loadKitProductIds } from "./product-kit-filter.js";

const DEFAULT_UNASSIGNED_PAGE_SIZE = 100;
const MAX_UNASSIGNED_PAGE_SIZE = 200;

export type PickFacePendingSkuReason = "no_pick_face" | "missing_product";

export type PickFacePendingSku = {
  id: string | null;
  sku: string;
  name: string | null;
  reason: PickFacePendingSkuReason;
  assignable: boolean;
  pausedOrderCount: number;
};

function matchesSkuSearch(
  sku: string,
  name: string | null,
  q?: string,
): boolean {
  const trimmed = q?.trim();
  if (!trimmed) return true;
  const needle = trimmed.toLowerCase();
  return (
    sku.toLowerCase().includes(needle) ||
    (name?.toLowerCase().includes(needle) ?? false)
  );
}

/** SKUs que bloqueiam pedidos PAUSED_ISSUE — foco operacional para cadastro de gôndola. */
export async function listPickFacePendingSkus(
  tenantId: string,
  options?: { q?: string; page?: number; pageSize?: number },
) {
  const pageSize = Math.min(
    Math.max(options?.pageSize ?? DEFAULT_UNASSIGNED_PAGE_SIZE, 1),
    MAX_UNASSIGNED_PAGE_SIZE,
  );
  const page = Math.max(options?.page ?? 1, 1);

  const items = await prisma.orderItem.findMany({
    where: {
      order: { tenantId, status: OrderStatus.PAUSED_ISSUE },
    },
    select: {
      productId: true,
      erpSku: true,
      erpDescription: true,
      orderId: true,
      product: { select: { id: true, sku: true, name: true } },
    },
  });

  const pickFaceCache = new Map<string, boolean>();
  const kitProductIds = await loadKitProductIds(tenantId);

  const bySku = new Map<
    string,
    PickFacePendingSku & { orderIds: Set<string> }
  >();

  for (const item of items) {
    const sku = (item.product?.sku ?? item.erpSku ?? "").trim();
    if (!sku) continue;

    const orderIds = bySku.get(sku)?.orderIds ?? new Set<string>();
    orderIds.add(item.orderId);

    if (bySku.has(sku)) {
      bySku.get(sku)!.orderIds = orderIds;
      continue;
    }

    if (item.productId && kitProductIds.has(item.productId)) continue;

    if (!item.productId) {
      bySku.set(sku, {
        id: null,
        sku,
        name: item.erpDescription?.trim() || null,
        reason: "missing_product",
        assignable: false,
        pausedOrderCount: 0,
        orderIds,
      });
      continue;
    }

    let hasPickFace = pickFaceCache.get(item.productId);
    if (hasPickFace === undefined) {
      const count = await prisma.location.count({
        where: {
          tenantId,
          productId: item.productId,
          type: LocationType.PICK_FACE,
          active: true,
        },
      });
      hasPickFace = count > 0;
      pickFaceCache.set(item.productId, hasPickFace);
    }

    if (hasPickFace) continue;

    bySku.set(sku, {
      id: item.product!.id,
      sku: item.product!.sku,
      name: item.product!.name,
      reason: "no_pick_face",
      assignable: true,
      pausedOrderCount: 0,
      orderIds,
    });
  }

  let rows = [...bySku.values()].map(({ orderIds, ...row }) => ({
    ...row,
    pausedOrderCount: orderIds.size,
  }));

  rows.sort((a, b) => {
    if (a.assignable !== b.assignable) return a.assignable ? -1 : 1;
    return a.sku.localeCompare(b.sku, "pt-BR");
  });

  if (options?.q?.trim()) {
    rows = rows.filter((row) => matchesSkuSearch(row.sku, row.name, options.q));
  }

  const total = rows.length;
  const skip = (page - 1) * pageSize;
  const products = rows.slice(skip, skip + pageSize);

  return {
    products,
    total,
    pagination: buildPaginationMeta(total, page, pageSize),
  };
}

function buildUnassignedPickFaceExtra(
  tenantId: string,
  q?: string,
): Prisma.ProductWhereInput {
  const trimmed = q?.trim();
  return {
    tenantId,
    active: true,
    locations: {
      none: {
        type: LocationType.PICK_FACE,
        active: true,
      },
    },
    ...(trimmed
      ? {
          OR: [
            { sku: { contains: trimmed, mode: "insensitive" as const } },
            { name: { contains: trimmed, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

export async function listProductsWithoutPickFace(
  tenantId: string,
  options?: { q?: string; page?: number; pageSize?: number },
) {
  const pageSize = Math.min(
    Math.max(options?.pageSize ?? DEFAULT_UNASSIGNED_PAGE_SIZE, 1),
    MAX_UNASSIGNED_PAGE_SIZE,
  );
  const page = Math.max(options?.page ?? 1, 1);
  const skip = (page - 1) * pageSize;
  const where = await selectableProductWhere(
    tenantId,
    buildUnassignedPickFaceExtra(tenantId, options?.q),
  );

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { sku: "asc" },
      skip,
      take: pageSize,
      select: { id: true, sku: true, name: true },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    total,
    pagination: buildPaginationMeta(total, page, pageSize),
  };
}

/** Libera pedidos PAUSED_ISSUE quando todas as pendências de cadastro foram resolvidas. */
export async function resumePausedOrdersAfterPickFace(
  tenantId: string,
  productId: string,
): Promise<{ resumedOrderIds: string[] }> {
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: OrderStatus.PAUSED_ISSUE,
      items: { some: { productId } },
    },
    select: {
      id: true,
      items: { select: { productId: true } },
    },
  });

  if (orders.length === 0) return { resumedOrderIds: [] };

  const productIds = new Set<string>([productId]);
  for (const order of orders) {
    for (const item of order.items) {
      if (item.productId) productIds.add(item.productId);
    }
  }

  const withPickFace = await prisma.location.findMany({
    where: {
      tenantId,
      productId: { in: [...productIds] },
      type: LocationType.PICK_FACE,
      active: true,
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  const pickFaceProductIds = new Set(
    withPickFace.map((loc) => loc.productId).filter(Boolean) as string[],
  );

  const resumedOrderIds: string[] = [];

  for (const order of orders) {
    const blocked = order.items.some(
      (item) => !item.productId || !pickFaceProductIds.has(item.productId),
    );
    if (blocked) continue;

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PENDING },
      });
      const { recordOrderStageChange } = await import("./order-stage-log.js");
      await recordOrderStageChange(tx, {
        tenantId,
        orderId: order.id,
        fromStatus: OrderStatus.PAUSED_ISSUE,
        toStatus: OrderStatus.PENDING,
        userId: null,
      });
    });
    await enrichOrderPriority(order.id);
    resumedOrderIds.push(order.id);
  }

  return { resumedOrderIds };
}

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
