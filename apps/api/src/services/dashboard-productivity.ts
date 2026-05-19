import {
  InventoryMovementType,
  LocationType,
  OrderStatus,
  OrderTimeLogEvent,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export interface DashboardProductivityDto {
  kpis: {
    awaitingPicking: number;
    awaitingConference: number;
    readyToShip: number;
    deltaPicking?: number;
    deltaConference?: number;
    deltaShip?: number;
  };
  hourly: Array<{
    hour: string;
    itemsPicked: number;
    itemsConferenced: number;
  }>;
  pickerRanking: Array<{
    userId: string;
    userName: string;
    itemsPicked: number;
  }>;
  shelfAlerts: Array<{
    locationId: string;
    corridor: string;
    row: string;
    barcode: string;
    productSku: string | null;
    productName: string | null;
    currentQuantity: number;
    minThreshold: number;
    capacity: number;
  }>;
  updatedAt: string;
}

function startOfDay(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function pctDelta(today: number, yesterday: number): number | undefined {
  if (yesterday === 0) return today > 0 ? 100 : undefined;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

function hourKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

function emptyHourlyBuckets(): Map<string, { picked: number; conferenced: number }> {
  const map = new Map<string, { picked: number; conferenced: number }>();
  for (let h = 6; h <= 22; h++) {
    map.set(`${String(h).padStart(2, "0")}:00`, { picked: 0, conferenced: 0 });
  }
  return map;
}

export async function getDashboardProductivity(
  tenantId: string,
): Promise<DashboardProductivityDto> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = startOfDay(yesterday);
  const yesterdayEnd = endOfDay(yesterday);

  const [
    awaitingPicking,
    awaitingConference,
    readyToShip,
    pickMovementsToday,
    conferenceOrdersToday,
    pickerMovements,
    newOrdersToday,
    newOrdersYesterday,
    endLogsToday,
    endLogsYesterday,
    enteredDispatchToday,
    enteredDispatchYesterday,
  ] = await Promise.all([
    prisma.order.count({ where: { tenantId, status: OrderStatus.PENDING } }),
    prisma.order.count({
      where: { tenantId, status: OrderStatus.PICKED_AWAITING_CONFERENCE },
    }),
    prisma.order.count({ where: { tenantId, status: OrderStatus.DISPATCHING } }),

    prisma.inventoryMovement.findMany({
      where: {
        tenantId,
        type: InventoryMovementType.PICK_ALLOCATION,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      select: { createdAt: true, quantity: true },
    }),
    prisma.order.findMany({
      where: {
        tenantId,
        status: { in: [OrderStatus.DISPATCHING, OrderStatus.DISPATCHED] },
        updatedAt: { gte: todayStart, lte: todayEnd },
      },
      include: { items: true },
    }),
    prisma.inventoryMovement.groupBy({
      by: ["userId"],
      where: {
        tenantId,
        type: InventoryMovementType.PICK_ALLOCATION,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      _sum: { quantity: true },
    }),

    prisma.order.count({
      where: { tenantId, createdAt: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.order.count({
      where: {
        tenantId,
        createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
      },
    }),
    prisma.orderTimeLog.count({
      where: {
        order: { tenantId },
        event: OrderTimeLogEvent.END,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.orderTimeLog.count({
      where: {
        order: { tenantId },
        event: OrderTimeLogEvent.END,
        createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
      },
    }),
    prisma.order.count({
      where: {
        tenantId,
        status: OrderStatus.DISPATCHING,
        updatedAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.order.count({
      where: {
        tenantId,
        status: OrderStatus.DISPATCHING,
        updatedAt: { gte: yesterdayStart, lte: yesterdayEnd },
      },
    }),
  ]);

  // Prisma não suporta comparar duas colunas no where — filtro em memória
  const shelfAlerts = (
    await prisma.location.findMany({
      where: { tenantId, active: true, type: LocationType.PICK_FACE },
      include: { product: true },
    })
  )
    .filter((loc) => loc.currentQuantity <= loc.minThreshold)
    .map((loc) => ({
      locationId: loc.id,
      corridor: loc.corridor,
      row: loc.row,
      barcode: loc.barcode,
      productSku: loc.product?.sku ?? null,
      productName: loc.product?.name ?? null,
      currentQuantity: loc.currentQuantity,
      minThreshold: loc.minThreshold,
      capacity: loc.capacity,
    }));

  const hourlyMap = emptyHourlyBuckets();
  for (const m of pickMovementsToday) {
    const key = hourKey(m.createdAt);
    const bucket = hourlyMap.get(key) ?? { picked: 0, conferenced: 0 };
    bucket.picked += m.quantity;
    hourlyMap.set(key, bucket);
  }

  for (const order of conferenceOrdersToday) {
    const key = hourKey(order.updatedAt);
    const items = order.items.reduce((s, i) => s + i.quantityPicked, 0);
    const bucket = hourlyMap.get(key) ?? { picked: 0, conferenced: 0 };
    bucket.conferenced += items;
    hourlyMap.set(key, bucket);
  }

  const hourly = Array.from(hourlyMap.entries()).map(([hour, v]) => ({
    hour,
    itemsPicked: v.picked,
    itemsConferenced: v.conferenced,
  }));

  const pickerIds = pickerMovements.map((p) => p.userId);
  const pickers = await prisma.user.findMany({
    where: { id: { in: pickerIds } },
    select: { id: true, name: true },
  });
  const pickerNameById = new Map(pickers.map((u) => [u.id, u.name]));

  const pickerRanking = pickerMovements
    .map((p) => ({
      userId: p.userId,
      userName: pickerNameById.get(p.userId) ?? "Operador",
      itemsPicked: p._sum.quantity ?? 0,
    }))
    .sort((a, b) => b.itemsPicked - a.itemsPicked)
    .slice(0, 10);

  return {
    kpis: {
      awaitingPicking,
      awaitingConference,
      readyToShip,
      deltaPicking: pctDelta(newOrdersToday, newOrdersYesterday),
      deltaConference: pctDelta(endLogsToday, endLogsYesterday),
      deltaShip: pctDelta(enteredDispatchToday, enteredDispatchYesterday),
    },
    hourly,
    pickerRanking,
    shelfAlerts,
    updatedAt: now.toISOString(),
  };
}
