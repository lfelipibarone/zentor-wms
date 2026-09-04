import { OrderStatus, OrderTimeLogEvent } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type TimestampedUser = {
  createdAt: Date;
  user: { id: string; name: string } | null;
};

/** Identifica o separador responsável antes de um evento (ex.: devolutiva do packing). */
export async function loadPickerNamesBeforeEvents(
  events: Array<{ orderId: string; before: Date }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (events.length === 0) return result;

  const orderIds = [...new Set(events.map((e) => e.orderId))];

  const [stageLogs, pickEndLogs] = await Promise.all([
    prisma.orderStageLog.findMany({
      where: {
        orderId: { in: orderIds },
        toStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
        userId: { not: null },
      },
      select: {
        orderId: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.orderTimeLog.findMany({
      where: {
        orderId: { in: orderIds },
        event: OrderTimeLogEvent.END,
      },
      select: {
        orderId: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const stageByOrder = groupByOrder(stageLogs);
  const endByOrder = groupByOrder(pickEndLogs);

  for (const { orderId, before } of events) {
    const name = resolvePickerBefore(orderId, before, stageByOrder, endByOrder);
    if (name) result.set(`${orderId}:${before.toISOString()}`, name);
  }

  return result;
}

function groupByOrder<T extends { orderId: string }>(
  logs: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const log of logs) {
    const list = map.get(log.orderId) ?? [];
    list.push(log);
    map.set(log.orderId, list);
  }
  return map;
}

function resolvePickerBefore(
  orderId: string,
  before: Date,
  stageByOrder: Map<string, TimestampedUser[]>,
  endByOrder: Map<string, TimestampedUser[]>,
): string | null {
  for (const stage of stageByOrder.get(orderId) ?? []) {
    if (stage.createdAt < before && stage.user?.name) return stage.user.name;
  }
  for (const end of endByOrder.get(orderId) ?? []) {
    if (end.createdAt < before && end.user?.name) return end.user.name;
  }
  return null;
}

export function pickerAttributionKey(orderId: string, before: Date): string {
  return `${orderId}:${before.toISOString()}`;
}
