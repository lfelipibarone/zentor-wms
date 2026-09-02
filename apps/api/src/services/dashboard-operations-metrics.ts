import { OrderStatus, OrderTimeLogEvent } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  activePackingDurationMs,
  activePickingDurationMs,
  msToSeconds,
} from "./operation-duration.js";
import {
  PACKING_ISSUE_TYPE_LABEL,
  type PackingIssueType,
} from "./order-packing.js";

export interface StageMetrics {
  avgDurationSec: number;
  medianDurationSec: number;
  ordersCount: number;
  deltaVsYesterday?: number;
}

export interface ReturnReasonCount {
  type: string;
  label: string;
  count: number;
}

export interface PackingReturnMetrics {
  countToday: number;
  inQueue: number;
  avgResolutionSec: number;
  deltaVsYesterday?: number;
  byReason: ReturnReasonCount[];
}

export interface DashboardStageMetrics {
  picking: StageMetrics;
  packing: StageMetrics;
  packingReturns: PackingReturnMetrics;
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function aggregateStageMetrics(
  durationsSec: number[],
  countToday: number,
  countYesterday: number,
): StageMetrics {
  const avgDurationSec =
    durationsSec.length > 0
      ? Math.round(
          durationsSec.reduce((sum, value) => sum + value, 0) /
            durationsSec.length,
        )
      : 0;
  return {
    avgDurationSec,
    medianDurationSec: median(durationsSec),
    ordersCount: countToday,
    deltaVsYesterday: pctDelta(countToday, countYesterday),
  };
}

async function fetchIndividualPickingDurations(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<number[]> {
  const logs = await prisma.orderTimeLog.findMany({
    where: {
      order: { tenantId },
      event: {
        in: [
          OrderTimeLogEvent.START,
          OrderTimeLogEvent.PAUSE,
          OrderTimeLogEvent.RESUME,
          OrderTimeLogEvent.END,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const byOrder = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = byOrder.get(log.orderId) ?? [];
    list.push(log);
    byOrder.set(log.orderId, list);
  }

  const durations: number[] = [];
  for (const [, orderLogs] of byOrder) {
    const endLog = orderLogs.find((l) => l.event === OrderTimeLogEvent.END);
    if (!endLog || endLog.createdAt < from || endLog.createdAt > to) continue;
    const hasStart = orderLogs.some(
      (l) => l.event === OrderTimeLogEvent.START,
    );
    if (!hasStart) continue;
    durations.push(msToSeconds(activePickingDurationMs(orderLogs)));
  }
  return durations;
}

async function fetchPickingDurations(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<number[]> {
  const individual = await fetchIndividualPickingDurations(tenantId, from, to);
  const endLogs = await prisma.orderTimeLog.findMany({
    where: {
      order: { tenantId },
      event: OrderTimeLogEvent.END,
      createdAt: { gte: from, lte: to },
    },
    select: { orderId: true },
  });
  const ordersWithIndividualEnd = new Set(endLogs.map((l) => l.orderId));

  const waveLines = await prisma.pickWaveLine.findMany({
    where: {
      wave: { tenantId },
      pickCompletedAt: { gte: from, lte: to },
      pickStartedAt: { not: null },
    },
    include: {
      allocations: {
        include: { orderItem: { select: { orderId: true } } },
      },
    },
  });

  const waveByOrder = new Map<string, number>();
  for (const line of waveLines) {
    if (!line.pickStartedAt || !line.pickCompletedAt) continue;
    const lineMs =
      line.pickCompletedAt.getTime() - line.pickStartedAt.getTime();
    for (const alloc of line.allocations) {
      if (line.quantityTotal <= 0) continue;
      const shareMs = (lineMs * alloc.quantity) / line.quantityTotal;
      const orderId = alloc.orderItem.orderId;
      waveByOrder.set(orderId, (waveByOrder.get(orderId) ?? 0) + shareMs);
    }
  }

  const waveDurations: number[] = [];
  for (const [orderId, ms] of waveByOrder) {
    if (!ordersWithIndividualEnd.has(orderId)) {
      waveDurations.push(msToSeconds(ms));
    }
  }

  return [...individual, ...waveDurations];
}

async function fetchIndividualPackingDurations(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<number[]> {
  const logs = await prisma.orderTimeLog.findMany({
    where: {
      order: { tenantId },
      event: {
        in: [OrderTimeLogEvent.PACK_START, OrderTimeLogEvent.PACK_END],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const byOrder = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = byOrder.get(log.orderId) ?? [];
    list.push(log);
    byOrder.set(log.orderId, list);
  }

  const durations: number[] = [];
  for (const [, orderLogs] of byOrder) {
    const endLog = orderLogs.find(
      (l) => l.event === OrderTimeLogEvent.PACK_END,
    );
    if (!endLog || endLog.createdAt < from || endLog.createdAt > to) continue;
    const hasStart = orderLogs.some(
      (l) => l.event === OrderTimeLogEvent.PACK_START,
    );
    if (!hasStart) continue;
    durations.push(msToSeconds(activePackingDurationMs(orderLogs)));
  }
  return durations;
}

async function fetchWavePackingDurations(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const allocations = await prisma.pickWaveAllocation.findMany({
    where: {
      waveLine: { wave: { tenantId } },
      sortCompletedAt: { gte: from, lte: to },
      sortStartedAt: { not: null },
    },
    include: {
      orderItem: { select: { orderId: true } },
    },
  });

  const byOrder = new Map<string, { starts: Date[]; ends: Date[] }>();
  for (const alloc of allocations) {
    if (!alloc.sortStartedAt || !alloc.sortCompletedAt) continue;
    if (alloc.quantitySorted < alloc.quantity) continue;
    const orderId = alloc.orderItem.orderId;
    const existing = byOrder.get(orderId) ?? { starts: [], ends: [] };
    existing.starts.push(alloc.sortStartedAt);
    existing.ends.push(alloc.sortCompletedAt);
    byOrder.set(orderId, existing);
  }

  const result = new Map<string, number>();
  for (const [orderId, v] of byOrder) {
    const inicio = Math.min(...v.starts.map((d) => d.getTime()));
    const fim = Math.max(...v.ends.map((d) => d.getTime()));
    result.set(orderId, msToSeconds(fim - inicio));
  }
  return result;
}

async function fetchPackingDurations(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<number[]> {
  const individual = await fetchIndividualPackingDurations(tenantId, from, to);
  const packEndLogs = await prisma.orderTimeLog.findMany({
    where: {
      order: { tenantId },
      event: OrderTimeLogEvent.PACK_END,
      createdAt: { gte: from, lte: to },
    },
    select: { orderId: true },
  });
  const ordersWithIndividualEnd = new Set(packEndLogs.map((l) => l.orderId));

  const waveByOrder = await fetchWavePackingDurations(tenantId, from, to);
  const waveOnly: number[] = [];
  for (const [orderId, sec] of waveByOrder) {
    if (!ordersWithIndividualEnd.has(orderId)) {
      waveOnly.push(sec);
    }
  }

  return [...individual, ...waveOnly];
}

async function countCompletedInPeriod(
  tenantId: string,
  event: OrderTimeLogEvent,
  from: Date,
  to: Date,
): Promise<number> {
  return prisma.orderTimeLog.count({
    where: {
      order: { tenantId },
      event,
      createdAt: { gte: from, lte: to },
    },
  });
}

function parseIssueType(reason: string | null): PackingIssueType | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason) as { type?: PackingIssueType };
    return parsed.type ?? null;
  } catch {
    return null;
  }
}

async function fetchPackingReturnMetrics(
  tenantId: string,
  todayStart: Date,
  todayEnd: Date,
  yesterdayStart: Date,
  yesterdayEnd: Date,
): Promise<PackingReturnMetrics> {
  const [returnsToday, returnsYesterday, inQueue, issueLogs] =
    await Promise.all([
      prisma.orderTimeLog.count({
        where: {
          order: { tenantId },
          event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.orderTimeLog.count({
        where: {
          order: { tenantId },
          event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
          createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
        },
      }),
      prisma.order.count({
        where: {
          tenantId,
          status: OrderStatus.PACKING_RETURNED_TO_PICKING,
        },
      }),
      prisma.orderTimeLog.findMany({
        where: {
          order: { tenantId },
          event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        select: { orderId: true, reason: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  const reasonCounts = new Map<string, number>();
  for (const log of issueLogs) {
    const type = parseIssueType(log.reason) ?? "UNKNOWN";
    reasonCounts.set(type, (reasonCounts.get(type) ?? 0) + 1);
  }

  const byReason: ReturnReasonCount[] = [...reasonCounts.entries()]
    .map(([type, count]) => ({
      type,
      label:
        type in PACKING_ISSUE_TYPE_LABEL
          ? PACKING_ISSUE_TYPE_LABEL[type as PackingIssueType]
          : "Outro",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const issueOrderIds = [...new Set(issueLogs.map((l) => l.orderId))];
  let resolutionTotalSec = 0;
  let resolutionCount = 0;

  if (issueOrderIds.length > 0) {
    const packEndLogs = await prisma.orderTimeLog.findMany({
      where: {
        orderId: { in: issueOrderIds },
        event: OrderTimeLogEvent.PACK_END,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { createdAt: "asc" },
    });

    const endByOrder = new Map<string, Date[]>();
    for (const log of packEndLogs) {
      const list = endByOrder.get(log.orderId) ?? [];
      list.push(log.createdAt);
      endByOrder.set(log.orderId, list);
    }

    for (const issue of issueLogs) {
      const ends = endByOrder.get(issue.orderId) ?? [];
      const nextEnd = ends.find((d) => d.getTime() > issue.createdAt.getTime());
      if (nextEnd) {
        resolutionTotalSec += msToSeconds(
          nextEnd.getTime() - issue.createdAt.getTime(),
        );
        resolutionCount += 1;
      }
    }
  }

  return {
    countToday: returnsToday,
    inQueue,
    avgResolutionSec:
      resolutionCount > 0
        ? Math.round(resolutionTotalSec / resolutionCount)
        : 0,
    deltaVsYesterday: pctDelta(returnsToday, returnsYesterday),
    byReason,
  };
}

export async function getDashboardStageMetrics(
  tenantId: string,
): Promise<DashboardStageMetrics> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = startOfDay(yesterday);
  const yesterdayEnd = endOfDay(yesterday);

  const [
    pickingDurationsToday,
    pickingDurationsYesterday,
    packingDurationsToday,
    packingDurationsYesterday,
    pickingCountToday,
    pickingCountYesterday,
    packingCountToday,
    packingCountYesterday,
    packingReturns,
  ] = await Promise.all([
    fetchPickingDurations(tenantId, todayStart, todayEnd),
    fetchPickingDurations(tenantId, yesterdayStart, yesterdayEnd),
    fetchPackingDurations(tenantId, todayStart, todayEnd),
    fetchPackingDurations(tenantId, yesterdayStart, yesterdayEnd),
    countCompletedInPeriod(
      tenantId,
      OrderTimeLogEvent.END,
      todayStart,
      todayEnd,
    ),
    countCompletedInPeriod(
      tenantId,
      OrderTimeLogEvent.END,
      yesterdayStart,
      yesterdayEnd,
    ),
    countCompletedInPeriod(
      tenantId,
      OrderTimeLogEvent.PACK_END,
      todayStart,
      todayEnd,
    ),
    countCompletedInPeriod(
      tenantId,
      OrderTimeLogEvent.PACK_END,
      yesterdayStart,
      yesterdayEnd,
    ),
    fetchPackingReturnMetrics(
      tenantId,
      todayStart,
      todayEnd,
      yesterdayStart,
      yesterdayEnd,
    ),
  ]);

  return {
    picking: aggregateStageMetrics(
      pickingDurationsToday,
      pickingCountToday,
      pickingCountYesterday,
    ),
    packing: aggregateStageMetrics(
      packingDurationsToday,
      packingCountToday,
      packingCountYesterday,
    ),
    packingReturns,
  };
}
