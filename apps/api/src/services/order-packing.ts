import {
  OrderStatus,
  OrderTimeLogEvent,
  PickWaveLineSortStatus,
  PickWaveStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { notifyUsersWithPermission } from "./notifications.js";
import { Permission } from "@wms/shared";
import { getWaveLineDetail } from "./pick-wave.js";
import { confirmSortAllocation } from "./pick-wave-sort.js";

const orderInclude = {
  basket: { select: { id: true, code: true, barcode: true } },
  assignedPicker: { select: { name: true } },
  items: {
    orderBy: { lineNumber: "asc" as const },
    include: {
      product: { select: { id: true, sku: true, name: true, barcode: true } },
    },
  },
} as const;

function mapPackingOrder(order: {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: OrderStatus;
  basket: { id: string; code: string; barcode: string } | null;
  assignedPicker: { name: string } | null;
  items: Array<{
    id: string;
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    quantityPacked: number;
    product: { id: string; sku: string; name: string; barcode: string | null };
  }>;
}) {
  const allPacked = order.items.every(
    (i) => i.quantityPacked >= i.quantityPicked && i.quantityPicked > 0,
  );
  return {
    id: order.id,
    erpOrderId: order.erpOrderId,
    customerName: order.customerName,
    status: order.status,
    basket: order.basket,
    assignedPicker: order.assignedPicker,
    allPacked,
    items: order.items.map((i) => ({
      id: i.id,
      lineNumber: i.lineNumber,
      quantityOrdered: i.quantityOrdered,
      quantityPicked: i.quantityPicked,
      quantityPacked: i.quantityPacked,
      remaining: Math.max(0, i.quantityPicked - i.quantityPacked),
      product: i.product,
    })),
  };
}

export async function listPackingQueue(tenantId: string) {
  const orders = await prisma.order.findMany({
    where: { tenantId, status: OrderStatus.PICKED_AWAITING_CONFERENCE },
    orderBy: { updatedAt: "asc" },
    take: 100,
    include: orderInclude,
  });
  return { orders: orders.map(mapPackingOrder) };
}

export async function findPackingOrderByQuery(tenantId: string, q: string) {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const order = await prisma.order.findFirst({
    where: {
      tenantId,
      status: OrderStatus.PICKED_AWAITING_CONFERENCE,
      OR: [
        { erpOrderId: { equals: trimmed, mode: "insensitive" } },
        { basket: { code: { equals: trimmed, mode: "insensitive" } } },
        { basket: { barcode: trimmed } },
      ],
    },
    include: orderInclude,
  });
  if (!order) return null;
  return mapPackingOrder(order);
}

export async function getPackingSession(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: orderInclude,
  });
  if (!order) throw new Error("Pedido não encontrado");
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new Error("Pedido não está aguardando packing");
  }
  return mapPackingOrder(order);
}

export async function startPacking(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Pedido não encontrado");
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new Error("Pedido não está aguardando packing");
  }

  const existing = await prisma.orderTimeLog.findFirst({
    where: { orderId, event: OrderTimeLogEvent.PACK_START },
  });
  if (!existing) {
    await prisma.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_START },
    });
  }

  return getPackingSession(orderId);
}

async function applyPackingQuantity(
  orderId: string,
  itemId: string,
  quantity: number,
) {
  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, orderId },
  });
  if (!item) throw new Error("Item não pertence ao pedido");

  const qty = Math.max(1, Math.floor(quantity));
  const remaining = item.quantityPicked - item.quantityPacked;
  if (remaining <= 0) throw new Error("Item já conferido no packing");

  const increment = Math.min(qty, remaining);
  await prisma.orderItem.update({
    where: { id: item.id },
    data: { quantityPacked: { increment } },
  });
}

export async function confirmPackingItem(
  orderId: string,
  userId: string,
  itemId: string,
  quantity: number,
) {
  await startPacking(orderId, userId);
  await applyPackingQuantity(orderId, itemId, quantity);
  return getPackingSession(orderId);
}

export async function scanPackingItem(
  orderId: string,
  userId: string,
  barcode: string,
  quantity = 1,
) {
  await startPacking(orderId, userId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) throw new Error("Pedido não encontrado");

  const code = barcode.trim();
  const item = order.items.find(
    (i) =>
      i.product.sku === code ||
      i.product.barcode === code ||
      i.product.barcode?.toUpperCase() === code.toUpperCase(),
  );
  if (!item) throw new Error("Produto não pertence ao pedido");

  await applyPackingQuantity(orderId, item.id, quantity);
  return getPackingSession(orderId);
}

export async function completePacking(orderId: string, userId: string) {
  const session = await getPackingSession(orderId);
  if (!session.allPacked) {
    throw new Error("Ainda há itens pendentes de conferência no packing");
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DISPATCHING },
    }),
    prisma.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_END },
    }),
  ]);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order) {
    await notifyUsersWithPermission(Permission.SHIPPING_VIEW, {
      title: "Pedido pronto para expedir",
      body: `${order.erpOrderId} aguarda despacho.`,
      category: "SHIPPING",
      data: { orderId: order.id, erpOrderId: order.erpOrderId },
    });
  }

  return { orderId, status: OrderStatus.DISPATCHING, completed: true };
}

export async function listWavePackingLines(tenantId: string) {
  const lines = await prisma.pickWaveLine.findMany({
    where: {
      wave: { tenantId, status: PickWaveStatus.RELEASED },
      quantityPicked: { gt: 0 },
      sortStatus: { not: PickWaveLineSortStatus.SORTED },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      product: { select: { sku: true, name: true } },
      wave: { select: { id: true, name: true } },
      pickLocation: { select: { barcode: true } },
    },
  });

  return {
    lines: lines.map((l) => ({
      id: l.id,
      waveId: l.waveId,
      waveName: l.wave.name,
      sku: l.product.sku,
      productName: l.product.name,
      locationBarcode: l.pickLocation.barcode,
      quantityPicked: l.quantityPicked,
      quantityTotal: l.quantityTotal,
      sortStatus: l.sortStatus,
    })),
  };
}

export async function getWavePackingLine(lineId: string) {
  const line = await getWaveLineDetail(lineId);
  if (!line) throw new Error("Linha não encontrada");
  if (line.sortStatus === PickWaveLineSortStatus.SORTED) {
    throw new Error("Linha já finalizada no packing");
  }
  const meta = await prisma.pickWaveLine.findUnique({
    where: { id: lineId },
    select: { waveId: true, wave: { select: { name: true } } },
  });
  return {
    line: {
      ...line,
      waveId: meta?.waveId ?? "",
      waveName: meta?.wave.name ?? "",
    },
  };
}

export async function sortWaveAllocationWeb(
  lineId: string,
  userId: string,
  input: {
    allocationId: string;
    quantity: number;
    basketBarcode?: string;
  },
) {
  return confirmSortAllocation({
    lineId,
    allocationId: input.allocationId,
    quantity: input.quantity,
    basketBarcode: input.basketBarcode,
    userId,
    webPacking: true,
  });
}
