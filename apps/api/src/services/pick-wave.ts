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

export async function resolvePickLocation(
  productId: string,
): Promise<Location> {
  const loc = await prisma.location.findFirst({
    where: {
      type: "PICK_FACE",
      active: true,
      productId,
    },
    orderBy: { currentQuantity: "desc" },
  });
  if (!loc) {
    throw new PickWaveError(
      "Nenhuma gôndola ativa encontrada para este produto. Cadastre ou abasteça a pick face.",
    );
  }
  return loc;
}

type OrderWithItems = Order & { items: OrderItem[] };

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
): Promise<WaveLineBuild[]> {
  const lineMap = new Map<string, WaveLineBuild>();

  for (const order of orders) {
    for (const item of order.items) {
      const remaining = item.quantityOrdered - item.quantityPicked;
      if (remaining <= 0) continue;

      let pickLocationId = item.pickLocationId;
      let locationBarcode = "";
      let locationLabel = "";

      if (!pickLocationId) {
        const loc = await resolvePickLocation(item.productId);
        pickLocationId = loc.id;
        locationBarcode = loc.barcode;
        locationLabel = formatLocation(loc);
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { pickLocationId: loc.id },
        });
      } else {
        const loc = await prisma.location.findUnique({
          where: { id: pickLocationId },
        });
        if (loc) {
          locationBarcode = loc.barcode;
          locationLabel = formatLocation(loc);
        }
      }

      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { sku: true, name: true },
      });

      const key = `${item.productId}:${pickLocationId}`;
      const existing = lineMap.get(key);
      if (existing) {
        existing.quantityTotal += remaining;
        existing.allocations.push({
          orderItemId: item.id,
          quantity: remaining,
          erpOrderId: order.erpOrderId,
        });
        existing.orderCount = new Set(
          existing.allocations.map((a) => a.erpOrderId),
        ).size;
      } else {
        lineMap.set(key, {
          productId: item.productId,
          pickLocationId,
          productSku: product?.sku ?? "—",
          productName: product?.name ?? "—",
          locationBarcode,
          locationLabel,
          quantityTotal: remaining,
          orderCount: 1,
          allocations: [
            {
              orderItemId: item.id,
              quantity: remaining,
              erpOrderId: order.erpOrderId,
            },
          ],
        });
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
  const orders = await buildWaveCandidateOrders(tenantId, opts);
  const lines = await buildWaveLinesFromOrders(orders);
  return {
    orderCount: orders.length,
    lineCount: lines.length,
    gondolaPasses: lines.length,
    orders: orders.map((o) => ({
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
}

export async function releasePickWave(
  tenantId: string,
  releasedById: string,
  opts?: { orderIds?: string[]; auto?: boolean },
): Promise<{ waveId: string; orderCount: number; lineCount: number }> {
  const enabled = await import("./wave-settings.js").then((m) =>
    m.isWaveEnabled(tenantId),
  );
  if (!enabled) {
    throw new PickWaveError("Separação em onda está desabilitada nas configurações");
  }

  const active = await prisma.pickWave.findFirst({
    where: { tenantId, status: PickWaveStatus.RELEASED },
  });
  if (active) {
    throw new PickWaveError(
      `Já existe uma onda ativa: ${active.name}. Feche-a antes de liberar outra.`,
    );
  }

  const orders = await buildWaveCandidateOrders(tenantId, {
    orderIds: opts?.orderIds,
  });

  if (orders.length === 0) {
    throw new PickWaveError("Nenhum pedido pendente disponível para a onda");
  }

  const lineBuilds = await buildWaveLinesFromOrders(orders);
  if (lineBuilds.length === 0) {
    throw new PickWaveError("Pedidos sem itens pendentes para separar");
  }

  const waveName = `Onda ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

  const wave = await prisma.$transaction(async (tx) => {
    const w = await tx.pickWave.create({
      data: {
        tenantId,
        name: waveName,
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

    return w;
  });

  return {
    waveId: wave.id,
    orderCount: orders.length,
    lineCount: lineBuilds.length,
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
  const wave = await prisma.pickWave.findFirst({
    where: { tenantId, status: PickWaveStatus.RELEASED },
    include: { orders: { select: { orderId: true } } },
  });
  if (!wave) return [];
  return wave.orders.map((o) => o.orderId);
}

export async function getCurrentReleasedWave(tenantId: string) {
  return prisma.pickWave.findFirst({
    where: { tenantId, status: PickWaveStatus.RELEASED },
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
                  order: { include: { basket: true } },
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
            },
          },
        },
      },
    },
  });
}

export function mapWaveLineSummary(
  line: Prisma.PickWaveLineGetPayload<{
    include: {
      product: true;
      pickLocation: true;
      allocations: {
        include: {
          orderItem: { include: { order: { include: { basket: true } } } };
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

  for (const alloc of line.allocations) {
    const order = alloc.orderItem.order;
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
    },
    quantityTotal: line.quantityTotal,
    quantityPicked: line.quantityPicked,
    remaining,
    ordersCount: ordersMap.size,
    orders: [...ordersMap.values()],
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
