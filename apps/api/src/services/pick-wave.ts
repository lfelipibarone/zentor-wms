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
import {
  partitionOrdersIntoWaves,
  waveSettingsToPartition,
  type OrderWithItems,
} from "./pick-wave-partition.js";
import { getWaveSettings } from "./wave-settings.js";

export class PickWaveError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "PickWaveError";
  }
}

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
  },
): Promise<OrderWithItems[]> {
  if (opts?.orderIds?.length) {
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        id: { in: opts.orderIds },
        status: OrderStatus.PENDING,
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
  },
) {
  const settings = await getWaveSettings(tenantId);
  const orders = await buildWaveCandidateOrders(tenantId, opts);
  const groups = partitionOrdersIntoWaves(
    orders,
    waveSettingsToPartition(settings),
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
  opts?: { orderIds?: string[]; auto?: boolean },
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

  const orders = await buildWaveCandidateOrders(tenantId, {
    orderIds: opts?.orderIds,
  });

  if (orders.length === 0) {
    throw new PickWaveError("Nenhum pedido pendente disponível para a onda");
  }

  const settings = await getWaveSettings(tenantId);
  const groups = partitionOrdersIntoWaves(
    orders,
    waveSettingsToPartition(settings),
  );

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
  opts?: { orderIds?: string[]; auto?: boolean },
): Promise<{ waveId: string; orderCount: number; lineCount: number; waveCount?: number }> {
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
