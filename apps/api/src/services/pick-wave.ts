import {
  OrderStatus,
  PickWaveLineSortStatus,
  PickWaveStatus,
  type Location,
  type Order,
  type OrderItem,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { allocateQuantityAcrossPickFaces } from "./pick-allocation.js";
import { PickWaveError } from "./pick-wave-error.js";

export { PickWaveError } from "./pick-wave-error.js";
import { marketplaceWhereClause } from "./marketplace-filter.js";
import { sortOrdersByPickProximity } from "./order-proximity.js";
import { buildOrderPickProfiles } from "./pick-wave-order-profile.js";
import {
  getExcludedOrderDetails,
  getExcludedOrderIds,
  isEligibleForByProductWave,
  orderLinksToAnyInGroup,
  partitionOrders,
  waveSettingsToPartition,
  type OrderWithItems,
  type WavePartitionStrategy,
} from "./pick-wave-partition.js";
import {
  assertOrdersMatchWaveMarketplace,
  assertUniformMarketplace,
} from "./wave-marketplace.js";
import { getWaveSettings } from "./wave-settings.js";

function formatLocation(loc: { corridor: string; row: string; barcode: string }) {
  return `${loc.corridor}-${loc.row} · ${loc.barcode}`;
}

export type WaveLineBuild = {
  productId: string;
  pickLocationId: string;
  productSku: string;
  productName: string;
  locationBarcode: string;
  locationLabel: string;
  quantityTotal: number;
  orderCount: number;
  allocations: { orderItemId: string; quantity: number; erpOrderId: string }[];
};

/** @deprecated Use resolvePickFaceForProduct from pick-face-resolve.ts */
export async function resolvePickLocation(
  productId: string,
): Promise<Location> {
  const { resolvePickFaceForProduct } = await import("./pick-face-resolve.js");
  try {
    return await resolvePickFaceForProduct(productId);
  } catch (e) {
    throw new PickWaveError(
      e instanceof Error
        ? e.message
        : "Nenhuma gôndola ativa encontrada para este produto.",
    );
  }
}

export async function buildWaveCandidateOrders(
  tenantId: string,
  opts?: {
    orderIds?: string[];
    maxOrders?: number;
    onlyDeadlineToday?: boolean;
    marketplace?: string;
  },
): Promise<OrderWithItems[]> {
  const marketplaceFilter = marketplaceWhereClause(opts?.marketplace);

  if (opts?.orderIds?.length) {
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        id: { in: opts.orderIds },
        status: OrderStatus.PENDING,
        ...(marketplaceFilter ?? {}),
      },
      include: { items: true, waveOrders: true },
    });
    const inWave = orders.filter((o) => o.waveOrders.length > 0);
    if (inWave.length > 0) {
      throw new PickWaveError(
        `${inWave.length} pedido(s) já estão em outra onda`,
      );
    }
    return orders;
  }

  const settings = await getWaveSettings(tenantId);
  const maxOrders = opts?.maxOrders ?? settings.autoReleaseMaxOrders;
  const onlyToday = opts?.onlyDeadlineToday ?? settings.onlyDeadlineToday;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const where: Prisma.OrderWhereInput = {
    tenantId,
    status: OrderStatus.PENDING,
    waveOrders: { none: {} },
    ...(marketplaceFilter ?? {}),
  };

  if (onlyToday) {
    where.collectionDeadline = { gte: startOfDay, lte: endOfDay };
  }

  const orders = await prisma.order.findMany({
    where,
    include: { items: true },
    orderBy: [
      { priority: "desc" },
      { collectionDeadline: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    take: maxOrders,
  });

  return orders;
}

export async function buildWaveLinesFromOrders(
  orders: OrderWithItems[],
  tenantId?: string,
): Promise<WaveLineBuild[]> {
  const lineMap = new Map<string, WaveLineBuild>();
  const tid = tenantId ?? orders[0]?.tenantId;
  if (!tid) throw new PickWaveError("Tenant não identificado para alocação");

  for (const order of orders) {
    for (const item of order.items) {
      const remaining = item.quantityOrdered - item.quantityPicked;
      if (remaining <= 0) continue;

      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { sku: true, name: true },
      });

      let segments: Awaited<
        ReturnType<typeof allocateQuantityAcrossPickFaces>
      >["segments"];

      if (item.pickLocationId && remaining > 0) {
        const loc = await prisma.location.findUnique({
          where: { id: item.pickLocationId },
        });
        if (loc) {
          segments = [
            {
              locationId: loc.id,
              barcode: loc.barcode,
              corridor: loc.corridor,
              row: loc.row,
              quantity: remaining,
              label: formatLocation(loc),
            },
          ];
        } else {
          const alloc = await allocateQuantityAcrossPickFaces(
            item.productId,
            tid!,
            remaining,
          );
          segments = alloc.segments;
        }
      } else {
        const alloc = await allocateQuantityAcrossPickFaces(
          item.productId,
          tid!,
          remaining,
        );
        segments = alloc.segments;
        if (segments[0]) {
          await prisma.orderItem.update({
            where: { id: item.id },
            data: { pickLocationId: segments[0].locationId },
          });
        }
      }

      if (segments.length === 0) {
        const loc = await resolvePickLocation(item.productId);
        segments = [
          {
            locationId: loc.id,
            barcode: loc.barcode,
            corridor: loc.corridor,
            row: loc.row,
            quantity: remaining,
            label: formatLocation(loc),
          },
        ];
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { pickLocationId: loc.id },
        });
      }

      for (const seg of segments) {
        const key = `${item.productId}:${seg.locationId}`;
        const existing = lineMap.get(key);
        if (existing) {
          existing.quantityTotal += seg.quantity;
          existing.allocations.push({
            orderItemId: item.id,
            quantity: seg.quantity,
            erpOrderId: order.erpOrderId,
          });
        } else {
          lineMap.set(key, {
            productId: item.productId,
            pickLocationId: seg.locationId,
            productSku: product?.sku ?? "—",
            productName: product?.name ?? "—",
            locationBarcode: seg.barcode,
            locationLabel: seg.label,
            quantityTotal: seg.quantity,
            orderCount: 1,
            allocations: [
              {
                orderItemId: item.id,
                quantity: seg.quantity,
                erpOrderId: order.erpOrderId,
              },
            ],
          });
        }
      }
    }
  }

  return [...lineMap.values()].map((line) => ({
    ...line,
    orderCount: new Set(line.allocations.map((a) => a.erpOrderId)).size,
  }));
}

export async function previewWaveRelease(
  tenantId: string,
  opts?: {
    orderIds?: string[];
    maxOrders?: number;
    marketplace?: string;
    partitionStrategy?: WavePartitionStrategy;
  },
) {
  const settings = await getWaveSettings(tenantId);
  const strategy =
    opts?.partitionStrategy ?? settings.defaultPartitionStrategy;
  const orders = await buildWaveCandidateOrders(tenantId, opts);
  if (orders.length === 0) {
    return {
      orderCount: 0,
      lineCount: 0,
      gondolaPasses: 0,
      waveCount: 0,
      waves: [],
      orders: [],
      lines: [],
      partitionStrategy: strategy,
      marketplace: opts?.marketplace ?? null,
      excludedOrderIds: [],
      proximityGroups: [],
    };
  }

  const waveMarketplace = assertUniformMarketplace(orders);
  const profiles = await buildOrderPickProfiles(tenantId, orders);
  const sorted = sortOrdersByPickProximity(orders, profiles);
  const partitionSettings = waveSettingsToPartition(settings, strategy);
  const groups = partitionOrders(sorted, strategy, partitionSettings, profiles);
  const excludedOrderIds = getExcludedOrderIds(orders, groups, strategy);
  const excludedOrderDetails = getExcludedOrderDetails(orders, groups, strategy);

  const { buildPickProximityGroups } = await import("./order-proximity.js");
  const remaining = orders.filter((o) => excludedOrderIds.includes(o.id));
  const proximityGroups = await buildPickProximityGroups(
    tenantId,
    remaining.length > 0 ? remaining : orders,
    {
      maxDistance: partitionSettings.proximityMaxDistance,
      maxGroups: 5,
    },
  );

  const waves = await Promise.all(
    groups.map(async (group, index) => {
      const lines = await buildWaveLinesFromOrders(group, tenantId);
      return {
        index: index + 1,
        orderCount: group.length,
        lineCount: lines.length,
        gondolaPasses: lines.length,
        orderIds: group.map((o) => o.id),
        orders: group.map((o) => ({
          id: o.id,
          erpOrderId: o.erpOrderId,
          priority: o.priority,
          collectionDeadline: o.collectionDeadline,
          marketplace: o.marketplace,
        })),
        lines: lines.map((l) => ({
          productSku: l.productSku,
          productName: l.productName,
          locationLabel: l.locationLabel,
          quantityTotal: l.quantityTotal,
          orderCount: l.orderCount,
        })),
      };
    }),
  );

  const lineCount = waves.reduce((s, w) => s + w.lineCount, 0);
  return {
    orderCount: orders.length,
    lineCount,
    gondolaPasses: lineCount,
    waveCount: waves.length,
    waves,
    partitionStrategy: strategy,
    marketplace: waveMarketplace,
    excludedOrderIds,
    excludedOrderDetails,
    proximityGroups: proximityGroups.map((g) => ({
      id: g.id,
      orderIds: g.orderIds,
      routeHint: g.routeHint,
      proximityScore: g.proximityScore,
    })),
    orders: orders.map((o) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      priority: o.priority,
      collectionDeadline: o.collectionDeadline,
      marketplace: o.marketplace,
    })),
    lines: waves.flatMap((w) => w.lines),
  };
}

async function createReleasedWave(
  tenantId: string,
  releasedById: string,
  orders: OrderWithItems[],
  waveLabel: string,
  meta?: { marketplace?: string | null; partitionStrategy?: string | null },
) {
  const lineBuilds = await buildWaveLinesFromOrders(orders, tenantId);
  if (lineBuilds.length === 0) {
    throw new PickWaveError("Pedidos sem itens pendentes para separar");
  }

  return prisma.$transaction(async (tx) => {
    const w = await tx.pickWave.create({
      data: {
        tenantId,
        name: waveLabel,
        status: PickWaveStatus.RELEASED,
        marketplace: meta?.marketplace ?? null,
        partitionStrategy: meta?.partitionStrategy ?? null,
        releasedAt: new Date(),
        releasedById,
        orders: {
          create: orders.map((o) => ({ orderId: o.id })),
        },
      },
    });

    for (const line of lineBuilds) {
      const waveLine = await tx.pickWaveLine.create({
        data: {
          waveId: w.id,
          productId: line.productId,
          pickLocationId: line.pickLocationId,
          quantityTotal: line.quantityTotal,
        },
      });
      await tx.pickWaveAllocation.createMany({
        data: line.allocations.map((a) => ({
          waveLineId: waveLine.id,
          orderItemId: a.orderItemId,
          quantity: a.quantity,
        })),
      });
    }

    return { wave: w, lineCount: lineBuilds.length };
  });
}

export async function releasePickWaves(
  tenantId: string,
  releasedById: string,
  opts?: {
    orderIds?: string[];
    auto?: boolean;
    marketplace?: string;
    partitionStrategy?: WavePartitionStrategy;
  },
): Promise<{
  waves: Array<{ waveId: string; orderCount: number; lineCount: number; name: string }>;
  orderCount: number;
  lineCount: number;
}> {
  const enabled = await import("./wave-settings.js").then((m) =>
    m.isWaveEnabled(tenantId),
  );
  if (!enabled) {
    throw new PickWaveError("Separação em onda está desabilitada nas configurações");
  }

  const settings = await getWaveSettings(tenantId);
  const marketplace =
    opts?.marketplace?.trim() || settings.autoReleaseMarketplace || undefined;
  const strategy =
    opts?.partitionStrategy ?? settings.defaultPartitionStrategy;

  const orders = await buildWaveCandidateOrders(tenantId, {
    orderIds: opts?.orderIds,
    marketplace,
  });

  if (orders.length === 0) {
    throw new PickWaveError("Nenhum pedido pendente disponível para a onda");
  }

  const waveMarketplace = assertUniformMarketplace(orders);
  const profiles = await buildOrderPickProfiles(tenantId, orders);
  const sorted = sortOrdersByPickProximity(orders, profiles);
  const partitionSettings = waveSettingsToPartition(settings, strategy);
  const groups = partitionOrders(sorted, strategy, partitionSettings, profiles);

  if (groups.length === 0) {
    throw new PickWaveError(
      strategy === "SINGLE_ITEM"
        ? "Nenhum pedido mono-SKU elegível para onda neste modo"
        : "Nenhum grupo de onda formado com os critérios atuais",
    );
  }

  const baseTime = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const baseDate = new Date().toLocaleDateString("pt-BR");

  const created: Array<{
    waveId: string;
    orderCount: number;
    lineCount: number;
    name: string;
  }> = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const suffix = groups.length > 1 ? ` (${i + 1}/${groups.length})` : "";
    const waveLabel = `Onda ${baseDate} ${baseTime}${suffix}`;
    const { wave, lineCount } = await createReleasedWave(
      tenantId,
      releasedById,
      group,
      waveLabel,
      {
        marketplace: waveMarketplace,
        partitionStrategy: strategy,
      },
    );
    created.push({
      waveId: wave.id,
      orderCount: group.length,
      lineCount,
      name: wave.name,
    });
  }

  const lineCount = created.reduce((s, w) => s + w.lineCount, 0);
  return {
    waves: created,
    orderCount: orders.length,
    lineCount,
  };
}

export async function releasePickWave(
  tenantId: string,
  releasedById: string,
  opts?: {
    orderIds?: string[];
    auto?: boolean;
    appendToWaveId?: string;
    marketplace?: string;
    partitionStrategy?: WavePartitionStrategy;
  },
): Promise<{ waveId: string; orderCount: number; lineCount: number; waveCount?: number }> {
  if (opts?.appendToWaveId) {
    const orderIds = opts.orderIds ?? [];
    const result = await addOrdersToWave(tenantId, opts.appendToWaveId, orderIds);
    return {
      waveId: opts.appendToWaveId,
      orderCount: result.added,
      lineCount: result.lineCount,
    };
  }

  const result = await releasePickWaves(tenantId, releasedById, opts);
  const first = result.waves[0];
  if (!first) {
    throw new PickWaveError("Nenhuma onda foi criada");
  }
  return {
    waveId: first.waveId,
    orderCount: result.orderCount,
    lineCount: result.lineCount,
    waveCount: result.waves.length,
  };
}

export async function getOpenWave(tenantId: string) {
  return prisma.pickWave.findFirst({
    where: {
      tenantId,
      status: PickWaveStatus.RELEASED,
      acceptedById: null,
    },
    orderBy: { releasedAt: "desc" },
    include: { _count: { select: { orders: true, lines: true } } },
  });
}

export async function addOrdersToWave(
  tenantId: string,
  waveId: string,
  orderIds: string[],
): Promise<{ added: number; lineCount: number }> {
  if (orderIds.length === 0) {
    throw new PickWaveError("Nenhum pedido selecionado");
  }

  const wave = await prisma.pickWave.findFirst({
    where: { id: waveId, tenantId },
    include: {
      orders: {
        include: { order: { include: { items: true } } },
      },
    },
  });
  if (!wave) throw new PickWaveError("Onda não encontrada", 404);
  if (wave.status === PickWaveStatus.CLOSED) {
    throw new PickWaveError("Onda encerrada — não é possível editar", 409);
  }
  if (wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está disponível para edição");
  }

  const orders = await buildWaveCandidateOrders(tenantId, { orderIds });
  if (orders.length === 0) {
    throw new PickWaveError("Nenhum pedido elegível para adicionar");
  }

  assertOrdersMatchWaveMarketplace(wave.marketplace, orders);

  if (wave.partitionStrategy === "BY_PRODUCT") {
    for (const o of orders) {
      if (!isEligibleForByProductWave(o)) {
        throw new PickWaveError(
          "Pedido com mais de 5 SKUs pendentes — não pode entrar em onda SKU compartilhado",
        );
      }
    }
  }

  const existingInWave: OrderWithItems[] = wave.orders.map((wo) => ({
    ...wo.order,
    items: wo.order.items,
  }));

  if (existingInWave.length > 0) {
    const settings = await getWaveSettings(tenantId);
    const profiles = await buildOrderPickProfiles(tenantId, [
      ...existingInWave,
      ...orders,
    ]);
    for (const newOrder of orders) {
      if (
        !orderLinksToAnyInGroup(
          newOrder,
          existingInWave,
          profiles,
          settings.proximityMaxDistance,
        )
      ) {
        throw new PickWaveError(
          "Pedido sem SKU em comum nem proximidade com a onda",
        );
      }
    }
  }

  const lineBuilds = await buildWaveLinesFromOrders(orders, tenantId);
  if (lineBuilds.length === 0) {
    throw new PickWaveError("Pedidos sem itens pendentes para separar");
  }

  const lineCount = await prisma.$transaction(async (tx) => {
    for (const line of lineBuilds) {
      const existing = await tx.pickWaveLine.findUnique({
        where: {
          waveId_productId_pickLocationId: {
            waveId,
            productId: line.productId,
            pickLocationId: line.pickLocationId,
          },
        },
      });

      if (existing) {
        if (
          existing.sortStatus !== PickWaveLineSortStatus.PENDING ||
          existing.quantityPicked > 0
        ) {
          throw new PickWaveError(
            `Linha já iniciada para SKU ${line.productSku} — não é possível adicionar pedidos`,
            409,
          );
        }
        await tx.pickWaveLine.update({
          where: { id: existing.id },
          data: { quantityTotal: { increment: line.quantityTotal } },
        });
        await tx.pickWaveAllocation.createMany({
          data: line.allocations.map((a) => ({
            waveLineId: existing.id,
            orderItemId: a.orderItemId,
            quantity: a.quantity,
          })),
        });
      } else {
        const waveLine = await tx.pickWaveLine.create({
          data: {
            waveId,
            productId: line.productId,
            pickLocationId: line.pickLocationId,
            quantityTotal: line.quantityTotal,
          },
        });
        await tx.pickWaveAllocation.createMany({
          data: line.allocations.map((a) => ({
            waveLineId: waveLine.id,
            orderItemId: a.orderItemId,
            quantity: a.quantity,
          })),
        });
      }
    }

    await tx.pickWaveOrder.createMany({
      data: orders.map((o) => ({ waveId, orderId: o.id })),
      skipDuplicates: true,
    });

    return tx.pickWaveLine.count({ where: { waveId } });
  });

  return { added: orders.length, lineCount };
}

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Remove pedido da onda após retorno do packing (reverte sort parcial e alocações). */
export async function detachOrderFromWaveForPackingReturn(
  tx: PrismaTx,
  tenantId: string,
  orderId: string,
  orderItemId: string,
  reportedQty: number,
): Promise<{ waveId?: string; waveName?: string }> {
  const waveOrder = await tx.pickWaveOrder.findFirst({
    where: {
      orderId,
      wave: { tenantId, status: PickWaveStatus.RELEASED },
    },
    include: { wave: { select: { id: true, name: true } } },
  });
  if (!waveOrder) return {};

  const waveId = waveOrder.waveId;

  const reportedAllocations = await tx.pickWaveAllocation.findMany({
    where: { orderItemId, waveLine: { waveId } },
  });
  let remaining = reportedQty;
  for (const alloc of reportedAllocations) {
    if (remaining <= 0) break;
    const revert = Math.min(remaining, alloc.quantitySorted);
    if (revert > 0) {
      await tx.pickWaveAllocation.update({
        where: { id: alloc.id },
        data: { quantitySorted: alloc.quantitySorted - revert },
      });
      remaining -= revert;
    }
  }

  const orderItems = await tx.orderItem.findMany({
    where: { orderId },
    select: { id: true },
  });
  const itemIds = orderItems.map((i) => i.id);

  const allocations = await tx.pickWaveAllocation.findMany({
    where: { orderItemId: { in: itemIds }, waveLine: { waveId } },
  });

  const lineAdjustments = new Map<string, number>();
  for (const alloc of allocations) {
    lineAdjustments.set(
      alloc.waveLineId,
      (lineAdjustments.get(alloc.waveLineId) ?? 0) + alloc.quantity,
    );
    await tx.pickWaveAllocation.delete({ where: { id: alloc.id } });
  }

  for (const [lineId, decrement] of lineAdjustments) {
    const line = await tx.pickWaveLine.findUnique({ where: { id: lineId } });
    if (!line) continue;
    const newTotal = line.quantityTotal - decrement;
    if (newTotal <= 0) {
      await tx.pickWaveLine.delete({ where: { id: lineId } });
    } else {
      await tx.pickWaveLine.update({
        where: { id: lineId },
        data: { quantityTotal: newTotal },
      });
    }
  }

  await tx.pickWaveOrder.delete({ where: { id: waveOrder.id } });

  return { waveId, waveName: waveOrder.wave.name };
}

export async function removeOrderFromWave(
  tenantId: string,
  waveId: string,
  orderId: string,
): Promise<void> {
  const wave = await prisma.pickWave.findFirst({
    where: { id: waveId, tenantId },
  });
  if (!wave) throw new PickWaveError("Onda não encontrada", 404);
  if (wave.status === PickWaveStatus.CLOSED) {
    throw new PickWaveError("Onda encerrada — não é possível editar", 409);
  }
  if (wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está disponível para edição");
  }

  const waveOrder = await prisma.pickWaveOrder.findFirst({
    where: { waveId, orderId },
  });
  if (!waveOrder) {
    throw new PickWaveError("Pedido não pertence a esta onda", 404);
  }

  const orderItems = await prisma.orderItem.findMany({
    where: { orderId },
    select: { id: true },
  });
  const itemIds = orderItems.map((i) => i.id);
  if (itemIds.length === 0) {
    await prisma.pickWaveOrder.delete({ where: { id: waveOrder.id } });
    return;
  }

  const allocations = await prisma.pickWaveAllocation.findMany({
    where: {
      orderItemId: { in: itemIds },
      waveLine: { waveId },
    },
    include: { waveLine: true, orderItem: true },
  });

  for (const alloc of allocations) {
    if (alloc.quantitySorted > 0) {
      throw new PickWaveError("Pedido já teve itens separados no packing", 409);
    }
    if (alloc.orderItem.quantityPicked > 0) {
      throw new PickWaveError("Pedido já teve itens separados", 409);
    }
    if (
      alloc.waveLine.sortStatus !== PickWaveLineSortStatus.PENDING ||
      alloc.waveLine.quantityPicked > 0
    ) {
      throw new PickWaveError(
        "Pedido já teve itens separados na linha da onda",
        409,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const lineAdjustments = new Map<string, number>();
    for (const alloc of allocations) {
      lineAdjustments.set(
        alloc.waveLineId,
        (lineAdjustments.get(alloc.waveLineId) ?? 0) + alloc.quantity,
      );
    }

    for (const alloc of allocations) {
      await tx.pickWaveAllocation.delete({ where: { id: alloc.id } });
    }

    for (const [lineId, decrement] of lineAdjustments) {
      const line = await tx.pickWaveLine.findUnique({ where: { id: lineId } });
      if (!line) continue;
      const newTotal = line.quantityTotal - decrement;
      if (newTotal <= 0) {
        await tx.pickWaveLine.delete({ where: { id: lineId } });
      } else {
        await tx.pickWaveLine.update({
          where: { id: lineId },
          data: { quantityTotal: newTotal },
        });
      }
    }

    await tx.pickWaveOrder.delete({ where: { id: waveOrder.id } });
  });
}

export async function acceptPickWave(
  waveId: string,
  userId: string,
): Promise<{ waveId: string; acceptedAt: string }> {
  const wave = await prisma.pickWave.findUnique({ where: { id: waveId } });
  if (!wave) throw new PickWaveError("Onda não encontrada", 404);
  if (wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está disponível para aceite");
  }
  if (wave.acceptedById && wave.acceptedById !== userId) {
    throw new PickWaveError(
      "Esta onda já foi aceita por outro operador",
      409,
    );
  }
  if (wave.acceptedById === userId) {
    return {
      waveId: wave.id,
      acceptedAt: wave.acceptedAt!.toISOString(),
    };
  }

  const updated = await prisma.pickWave.update({
    where: { id: waveId },
    data: { acceptedById: userId, acceptedAt: new Date() },
  });

  return {
    waveId: updated.id,
    acceptedAt: updated.acceptedAt!.toISOString(),
  };
}

export async function releasePickWaveAccept(
  waveId: string,
  userId: string,
): Promise<{ released: boolean }> {
  const wave = await prisma.pickWave.findUnique({
    where: { id: waveId },
    include: { lines: { select: { quantityPicked: true } } },
  });
  if (!wave) throw new PickWaveError("Onda não encontrada", 404);
  if (wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está disponível", 409);
  }
  if (!wave.acceptedById) {
    throw new PickWaveError("Onda não foi aceita", 409);
  }
  if (wave.acceptedById !== userId) {
    throw new PickWaveError(
      "Esta onda foi aceita por outro operador",
      403,
    );
  }
  const hasPicked = wave.lines.some((l) => l.quantityPicked > 0);
  if (hasPicked) {
    throw new PickWaveError(
      "Separação já iniciada — não é possível cancelar o aceite",
      409,
    );
  }

  await prisma.pickWave.update({
    where: { id: waveId },
    data: { acceptedById: null, acceptedAt: null },
  });

  return { released: true };
}

export async function assertWaveOperatorForMutation(
  waveId: string,
  userId: string,
): Promise<void> {
  const wave = await prisma.pickWave.findUnique({ where: { id: waveId } });
  if (!wave) throw new PickWaveError("Onda não encontrada", 404);
  if (wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está ativa");
  }
  if (!wave.acceptedById) {
    throw new PickWaveError(
      "Aceite a onda antes de registrar separação ou packing",
    );
  }
  if (wave.acceptedById !== userId) {
    throw new PickWaveError(
      "Esta onda está sendo executada por outro operador",
      403,
    );
  }
}

export async function getOrderIdsInActiveWave(tenantId: string): Promise<string[]> {
  const waves = await prisma.pickWave.findMany({
    where: { tenantId, status: PickWaveStatus.RELEASED },
    include: { orders: { select: { orderId: true } } },
  });
  const ids = new Set<string>();
  for (const w of waves) {
    for (const o of w.orders) ids.add(o.orderId);
  }
  return [...ids];
}

export async function listReleasedWaves(tenantId: string) {
  return prisma.pickWave.findMany({
    where: { tenantId, status: PickWaveStatus.RELEASED },
    orderBy: { releasedAt: "asc" },
    include: {
      acceptedBy: { select: { id: true, name: true } },
      _count: { select: { orders: true, lines: true } },
      orders: {
        include: {
          order: {
            select: {
              priority: true,
              collectionDeadline: true,
              marketplace: true,
            },
          },
        },
      },
    },
  });
}

export async function getReleasedWaveById(tenantId: string, waveId: string) {
  return prisma.pickWave.findFirst({
    where: { tenantId, id: waveId, status: PickWaveStatus.RELEASED },
    include: {
      acceptedBy: { select: { id: true, name: true } },
      lines: {
        include: {
          product: true,
          pickLocation: true,
          allocations: {
            include: {
              orderItem: {
                include: {
                  order: {
                    select: {
                      id: true,
                      erpOrderId: true,
                      collectionDeadline: true,
                      basket: { select: { code: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [
          { pickLocation: { corridor: "asc" } },
          { pickLocation: { row: "asc" } },
        ],
      },
      orders: {
        include: {
          order: {
            select: {
              id: true,
              erpOrderId: true,
              priority: true,
              collectionDeadline: true,
              marketplace: true,
            },
          },
        },
      },
    },
  });
}

export async function getCurrentReleasedWave(tenantId: string) {
  const waves = await listReleasedWaves(tenantId);
  if (waves.length === 0) return null;

  const { scorePackingUrgency } = await import("./packing-queue-sort.js");
  const sorted = [...waves].sort((a, b) => {
    const ordersA = a.orders.map((wo) => wo.order);
    const ordersB = b.orders.map((wo) => wo.order);
    const urgA = Math.max(
      ...ordersA.map((o) =>
        scorePackingUrgency({
          collectionDeadline: o.collectionDeadline,
          marketplace: o.marketplace,
          priority: o.priority,
        }),
      ),
      0,
    );
    const urgB = Math.max(
      ...ordersB.map((o) =>
        scorePackingUrgency({
          collectionDeadline: o.collectionDeadline,
          marketplace: o.marketplace,
          priority: o.priority,
        }),
      ),
      0,
    );
    return urgB - urgA;
  });

  return getReleasedWaveById(tenantId, sorted[0]!.id);
}

export function mapWaveLineSummary(
  line: Prisma.PickWaveLineGetPayload<{
    include: {
      product: true;
      pickLocation: true;
      allocations: {
        include: {
          orderItem: {
            include: {
              order: {
                select: {
                  id: true,
                  erpOrderId: true,
                  collectionDeadline: true,
                  basket: { select: { code: true } },
                },
              },
            },
          };
        };
      };
    };
  }>,
) {
  const remaining = line.quantityTotal - line.quantityPicked;
  const ordersMap = new Map<
    string,
    { orderId: string; erpOrderId: string; quantity: number; basketCode: string | null }
  >();

  let collectionDeadline: Date | null = null;

  for (const alloc of line.allocations) {
    const order = alloc.orderItem.order;
    if (order.collectionDeadline) {
      if (
        !collectionDeadline ||
        order.collectionDeadline.getTime() < collectionDeadline.getTime()
      ) {
        collectionDeadline = order.collectionDeadline;
      }
    }
    const prev = ordersMap.get(order.id);
    if (prev) {
      prev.quantity += alloc.quantity;
    } else {
      ordersMap.set(order.id, {
        orderId: order.id,
        erpOrderId: order.erpOrderId,
        quantity: alloc.quantity,
        basketCode: order.basket?.code ?? null,
      });
    }
  }

  return {
    id: line.id,
    sortStatus: line.sortStatus,
    product: {
      id: line.product.id,
      sku: line.product.sku,
      name: line.product.name,
      barcode: line.product.barcode,
      imageUrl: line.product.imageUrl,
    },
    pickLocation: {
      id: line.pickLocation.id,
      barcode: line.pickLocation.barcode,
      corridor: line.pickLocation.corridor,
      row: line.pickLocation.row,
      label: formatLocation(line.pickLocation),
      currentQuantity: line.pickLocation.currentQuantity,
      capacity: line.pickLocation.capacity,
      minThreshold: line.pickLocation.minThreshold,
    },
    quantityTotal: line.quantityTotal,
    quantityPicked: line.quantityPicked,
    remaining,
    ordersCount: ordersMap.size,
    orders: [...ordersMap.values()],
    collectionDeadline: collectionDeadline?.toISOString() ?? null,
    gondolaHint: `${ordersMap.size} pedido(s) · mesma gôndola · ${line.quantityTotal} un. total`,
  };
}

export async function getWaveLineDetail(lineId: string) {
  const line = await prisma.pickWaveLine.findUnique({
    where: { id: lineId },
    include: {
      product: true,
      pickLocation: true,
      wave: true,
      allocations: {
        include: {
          orderItem: {
            include: {
              order: { include: { basket: true } },
              product: true,
            },
          },
        },
      },
    },
  });

  if (!line) return null;
  if (line.wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está ativa");
  }

  return {
    ...mapWaveLineSummary(line),
    waveAcceptedById: line.wave.acceptedById,
    allocations: line.allocations.map((a) => ({
      id: a.id,
      quantity: a.quantity,
      quantitySorted: a.quantitySorted,
      remaining: a.quantity - a.quantitySorted,
      order: {
        id: a.orderItem.order.id,
        erpOrderId: a.orderItem.order.erpOrderId,
        priority: a.orderItem.order.priority,
        basketCode: a.orderItem.order.basket?.code ?? null,
        basketId: a.orderItem.order.basketId,
      },
    })),
  };
}

export async function closePickWave(waveId: string) {
  const wave = await prisma.pickWave.findUnique({ where: { id: waveId } });
  if (!wave) throw new PickWaveError("Onda não encontrada", 404);
  await prisma.pickWave.update({
    where: { id: waveId },
    data: { status: PickWaveStatus.CLOSED },
  });
}

export async function listPickWaves(tenantId: string) {
  return prisma.pickWave.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      _count: { select: { orders: true, lines: true } },
      releasedBy: { select: { name: true } },
      acceptedBy: { select: { name: true } },
    },
  });
}

export { PickWaveLineSortStatus, PickWaveStatus };
