import {
  OrderStatus,
  PickWaveStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildPaginationMeta } from "../lib/pagination.js";

export type BoardKind = "all" | "order" | "wave";

const orderListInclude = {
  assignedPicker: { select: { name: true } },
  basket: { select: { code: true } },
  _count: { select: { items: true } },
  items: { select: { quantityOrdered: true, quantityPicked: true } },
} as const;

function mapOrderRow(o: {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: OrderStatus;
  priority: number;
  collectionDeadline: Date | null;
  marketplace: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedPicker: { name: string } | null;
  basket: { code: string } | null;
  _count: { items: number };
  items: Array<{ quantityOrdered: number; quantityPicked: number }>;
}) {
  return {
    kind: "order" as const,
    id: o.id,
    erpOrderId: o.erpOrderId,
    customerName: o.customerName,
    status: o.status,
    priority: o.priority,
    collectionDeadline: o.collectionDeadline?.toISOString() ?? null,
    marketplace: o.marketplace,
    pickerName: o.assignedPicker?.name ?? null,
    basketCode: o.basket?.code ?? null,
    itemCount: o._count.items,
    qtyOrdered: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
    qtyPicked: o.items.reduce((s, i) => s + i.quantityPicked, 0),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function mapWaveRow(w: {
  id: string;
  name: string;
  status: PickWaveStatus;
  releasedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  _count: { orders: number; lines: number };
  lines: Array<{ quantityPicked: number; quantityTotal: number }>;
}) {
  return {
    kind: "wave" as const,
    id: w.id,
    name: w.name,
    status: w.status,
    orderCount: w._count.orders,
    lineCount: w._count.lines,
    qtyPicked: w.lines.reduce((s, l) => s + l.quantityPicked, 0),
    qtyTotal: w.lines.reduce((s, l) => s + l.quantityTotal, 0),
    releasedAt: w.releasedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function buildOrderWhere(
  tenantId: string,
  opts: {
    status?: OrderStatus;
    q?: string;
  },
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { tenantId };
  if (opts.status) where.status = opts.status;
  if (opts.q) {
    where.OR = [
      { erpOrderId: { contains: opts.q, mode: "insensitive" } },
      { customerName: { contains: opts.q, mode: "insensitive" } },
    ];
  }
  return where;
}

function buildWaveWhere(
  tenantId: string,
  q?: string,
): Prisma.PickWaveWhereInput {
  const where: Prisma.PickWaveWhereInput = {
    tenantId,
    status: PickWaveStatus.RELEASED,
  };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      {
        orders: {
          some: {
            order: {
              OR: [
                { erpOrderId: { contains: q, mode: "insensitive" } },
                { customerName: { contains: q, mode: "insensitive" } },
              ],
            },
          },
        },
      },
    ];
  }
  return where;
}

export async function getOrderDetail(tenantId: string, orderId: string) {
  const o = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: {
      assignedPicker: { select: { name: true } },
      basket: { select: { code: true } },
      items: {
        orderBy: { lineNumber: "asc" },
        include: {
          product: { select: { sku: true, name: true } },
        },
      },
    },
  });
  if (!o) return null;

  return {
    id: o.id,
    erpOrderId: o.erpOrderId,
    customerName: o.customerName,
    status: o.status,
    priority: o.priority,
    collectionDeadline: o.collectionDeadline?.toISOString() ?? null,
    marketplace: o.marketplace,
    pickerName: o.assignedPicker?.name ?? null,
    basketCode: o.basket?.code ?? null,
    updatedAt: o.updatedAt.toISOString(),
    items: o.items.map((i) => ({
      lineNumber: i.lineNumber,
      quantityOrdered: i.quantityOrdered,
      quantityPicked: i.quantityPicked,
      product: i.product,
    })),
  };
}

export async function getWaveDetail(tenantId: string, waveId: string) {
  const wave = await prisma.pickWave.findFirst({
    where: { id: waveId, tenantId },
    include: {
      lines: {
        orderBy: [{ pickLocation: { corridor: "asc" } }, { pickLocation: { row: "asc" } }],
        include: {
          product: { select: { sku: true, name: true } },
          pickLocation: { select: { barcode: true } },
        },
      },
      orders: {
        include: {
          order: {
            select: {
              id: true,
              erpOrderId: true,
              customerName: true,
              status: true,
            },
          },
        },
      },
    },
  });
  if (!wave) return null;

  return {
    id: wave.id,
    name: wave.name,
    status: wave.status,
    releasedAt: wave.releasedAt?.toISOString() ?? null,
    updatedAt: wave.updatedAt.toISOString(),
    lines: wave.lines.map((l) => ({
      id: l.id,
      sku: l.product.sku,
      productName: l.product.name,
      locationBarcode: l.pickLocation.barcode,
      quantityPicked: l.quantityPicked,
      quantityTotal: l.quantityTotal,
      sortStatus: l.sortStatus,
    })),
    orders: wave.orders.map((wo) => ({
      id: wo.order.id,
      erpOrderId: wo.order.erpOrderId,
      customerName: wo.order.customerName,
      status: wo.order.status,
    })),
  };
}

export async function getOrdersBoard(
  tenantId: string,
  opts: {
    kind?: BoardKind;
    status?: OrderStatus;
    q?: string;
    page: number;
    pageSize: number;
  },
) {
  const kind = opts.kind ?? "all";
  const page = opts.page;
  const pageSize = opts.pageSize;
  const skip = (page - 1) * pageSize;

  const [counts] = await Promise.all([getBoardCounts(tenantId)]);

  if (kind === "order") {
    const orderWhere = buildOrderWhere(tenantId, opts);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: orderWhere,
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        skip,
        take: pageSize,
        include: orderListInclude,
      }),
      prisma.order.count({ where: orderWhere }),
    ]);
    return {
      entries: orders.map(mapOrderRow),
      pagination: buildPaginationMeta(total, page, pageSize),
      counts,
    };
  }

  if (kind === "wave") {
    const waveWhere = buildWaveWhere(tenantId, opts.q);
    const [waves, total] = await Promise.all([
      prisma.pickWave.findMany({
        where: waveWhere,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
        include: {
          _count: { select: { orders: true, lines: true } },
          lines: { select: { quantityPicked: true, quantityTotal: true } },
        },
      }),
      prisma.pickWave.count({ where: waveWhere }),
    ]);
    return {
      entries: waves.map(mapWaveRow),
      pagination: buildPaginationMeta(total, page, pageSize),
      counts,
    };
  }

  const orderWhere = buildOrderWhere(tenantId, opts);
  const waveWhere = buildWaveWhere(tenantId, opts.q);

  const [orders, waves] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 500,
      include: orderListInclude,
    }),
    prisma.pickWave.findMany({
      where: waveWhere,
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        _count: { select: { orders: true, lines: true } },
        lines: { select: { quantityPicked: true, quantityTotal: true } },
      },
    }),
  ]);

  type Merged = ReturnType<typeof mapOrderRow> | ReturnType<typeof mapWaveRow>;
  const merged: Merged[] = [
    ...orders.map(mapOrderRow),
    ...waves.map(mapWaveRow),
  ].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const total = merged.length;
  const entries = merged.slice(skip, skip + pageSize);

  return {
    entries,
    pagination: buildPaginationMeta(total, page, pageSize),
    counts,
  };
}

async function getBoardCounts(tenantId: string) {
  const [
    pending,
    picking,
    paused,
    separated,
    dispatching,
    waves,
  ] = await Promise.all([
    prisma.order.count({ where: { tenantId, status: OrderStatus.PENDING } }),
    prisma.order.count({ where: { tenantId, status: OrderStatus.PICKING } }),
    prisma.order.count({ where: { tenantId, status: OrderStatus.PAUSED_ISSUE } }),
    prisma.order.count({
      where: { tenantId, status: OrderStatus.PICKED_AWAITING_CONFERENCE },
    }),
    prisma.order.count({ where: { tenantId, status: OrderStatus.DISPATCHING } }),
    prisma.pickWave.count({
      where: { tenantId, status: PickWaveStatus.RELEASED },
    }),
  ]);

  return {
    pending,
    picking,
    paused,
    separated,
    dispatching,
    waves,
    all: pending + picking + paused + separated + dispatching + waves,
  };
}
