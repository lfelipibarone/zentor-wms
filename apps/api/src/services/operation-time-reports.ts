import { OrderTimeLogEvent } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  activePackingDurationMs,
  activePickingDurationMs,
  formatDuration,
  msToSeconds,
} from "./operation-duration.js";
import type { ReportColumn, ReportResult } from "./report-types.js";
import { fmtDateBr } from "./report-types.js";

export const OPERATION_TIME_REPORT_IDS = [
  "picking_time_by_order",
  "picking_time_by_user",
  "packing_time_by_order",
  "packing_time_by_user",
] as const;

export type OperationTimeReportId =
  (typeof OPERATION_TIME_REPORT_IDS)[number];

interface OrderTimeRow {
  pedidoErp: string;
  operador: string;
  origem: string;
  inicio: string | null;
  fim: string | null;
  duracaoSeg: number;
  duracaoFmt: string;
  onda: string | null;
}

interface UserTimeRow {
  operador: string;
  pedidos: number;
  tempoTotalSeg: number;
  tempoMedioSeg: number;
  tempoMinSeg: number;
  tempoMaxSeg: number;
}

function aggregateByUser(rows: OrderTimeRow[]): UserTimeRow[] {
  const map = new Map<
    string,
    { pedidos: number; total: number; min: number; max: number }
  >();

  for (const r of rows) {
    const cur = map.get(r.operador) ?? {
      pedidos: 0,
      total: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
    };
    cur.pedidos += 1;
    cur.total += r.duracaoSeg;
    cur.min = Math.min(cur.min, r.duracaoSeg);
    cur.max = Math.max(cur.max, r.duracaoSeg);
    map.set(r.operador, cur);
  }

  return [...map.entries()]
    .map(([operador, v]) => ({
      operador,
      pedidos: v.pedidos,
      tempoTotalSeg: v.total,
      tempoMedioSeg: v.pedidos > 0 ? Math.round(v.total / v.pedidos) : 0,
      tempoMinSeg: v.min === Number.POSITIVE_INFINITY ? 0 : v.min,
      tempoMaxSeg: v.max,
    }))
    .sort((a, b) => b.tempoTotalSeg - a.tempoTotalSeg);
}

async function fetchIndividualPickingRows(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<OrderTimeRow[]> {
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
    include: {
      user: { select: { name: true } },
      order: { select: { id: true, erpOrderId: true } },
    },
  });

  const byOrder = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = byOrder.get(log.orderId) ?? [];
    list.push(log);
    byOrder.set(log.orderId, list);
  }

  const rows: OrderTimeRow[] = [];

  for (const [, orderLogs] of byOrder) {
    const hasStart = orderLogs.some((l) => l.event === OrderTimeLogEvent.START);
    const endLog = orderLogs.find((l) => l.event === OrderTimeLogEvent.END);
    if (!hasStart || !endLog) continue;
    if (endLog.createdAt < from || endLog.createdAt > to) continue;

    const startLog = orderLogs.find((l) => l.event === OrderTimeLogEvent.START)!;
    const durationMs = activePickingDurationMs(orderLogs);

    rows.push({
      pedidoErp: endLog.order.erpOrderId,
      operador: startLog.user.name,
      origem: "INDIVIDUAL",
      inicio: fmtDateBr(startLog.createdAt),
      fim: fmtDateBr(endLog.createdAt),
      duracaoSeg: msToSeconds(durationMs),
      duracaoFmt: formatDuration(msToSeconds(durationMs)),
      onda: null,
    });
  }

  return rows;
}

async function fetchWavePickingRows(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<OrderTimeRow[]> {
  const lines = await prisma.pickWaveLine.findMany({
    where: {
      wave: { tenantId },
      pickCompletedAt: { gte: from, lte: to },
      pickStartedAt: { not: null },
    },
    include: {
      pickedBy: { select: { name: true } },
      product: { select: { sku: true } },
      wave: { select: { name: true } },
      allocations: {
        include: {
          orderItem: {
            include: { order: { select: { id: true, erpOrderId: true } } },
          },
        },
      },
    },
  });

  const aggregated = new Map<
    string,
    {
      pedidoErp: string;
      operador: string;
      onda: string;
      inicio: Date;
      fim: Date;
      duracaoMs: number;
    }
  >();

  for (const line of lines) {
    if (!line.pickStartedAt || !line.pickCompletedAt) continue;
    const lineMs =
      line.pickCompletedAt.getTime() - line.pickStartedAt.getTime();
    const operador = line.pickedBy?.name ?? "—";

    for (const alloc of line.allocations) {
      if (line.quantityTotal <= 0) continue;
      const shareMs = (lineMs * alloc.quantity) / line.quantityTotal;
      const orderId = alloc.orderItem.orderId;
      const key = `${orderId}:${line.waveId}`;
      const existing = aggregated.get(key);
      const start = line.pickStartedAt;
      const end = line.pickCompletedAt;

      if (existing) {
        existing.duracaoMs += shareMs;
        if (start < existing.inicio) existing.inicio = start;
        if (end > existing.fim) existing.fim = end;
      } else {
        aggregated.set(key, {
          pedidoErp: alloc.orderItem.order.erpOrderId,
          operador,
          onda: line.wave.name,
          inicio: start,
          fim: end,
          duracaoMs: shareMs,
        });
      }
    }
  }

  return [...aggregated.values()].map((v) => ({
    pedidoErp: v.pedidoErp,
    operador: v.operador,
    origem: "ONDA",
    inicio: fmtDateBr(v.inicio),
    fim: fmtDateBr(v.fim),
    duracaoSeg: msToSeconds(v.duracaoMs),
    duracaoFmt: formatDuration(msToSeconds(v.duracaoMs)),
    onda: v.onda,
  }));
}

async function fetchIndividualPackingRows(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<OrderTimeRow[]> {
  const logs = await prisma.orderTimeLog.findMany({
    where: {
      order: { tenantId },
      event: {
        in: [OrderTimeLogEvent.PACK_START, OrderTimeLogEvent.PACK_END],
      },
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { name: true } },
      order: { select: { erpOrderId: true } },
    },
  });

  const byOrder = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = byOrder.get(log.orderId) ?? [];
    list.push(log);
    byOrder.set(log.orderId, list);
  }

  const rows: OrderTimeRow[] = [];

  for (const [, orderLogs] of byOrder) {
    const hasStart = orderLogs.some(
      (l) => l.event === OrderTimeLogEvent.PACK_START,
    );
    const endLog = orderLogs.find((l) => l.event === OrderTimeLogEvent.PACK_END);
    if (!hasStart || !endLog) continue;
    if (endLog.createdAt < from || endLog.createdAt > to) continue;

    const startLog = orderLogs.find(
      (l) => l.event === OrderTimeLogEvent.PACK_START,
    )!;
    const durationMs = activePackingDurationMs(orderLogs);

    rows.push({
      pedidoErp: endLog.order.erpOrderId,
      operador: startLog.user.name,
      origem: "INDIVIDUAL",
      inicio: fmtDateBr(startLog.createdAt),
      fim: fmtDateBr(endLog.createdAt),
      duracaoSeg: msToSeconds(durationMs),
      duracaoFmt: formatDuration(msToSeconds(durationMs)),
      onda: null,
    });
  }

  return rows;
}

async function fetchWavePackingRows(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<OrderTimeRow[]> {
  const allocations = await prisma.pickWaveAllocation.findMany({
    where: {
      waveLine: { wave: { tenantId } },
      sortCompletedAt: { gte: from, lte: to },
      sortStartedAt: { not: null },
    },
    include: {
      sortedBy: { select: { name: true } },
      orderItem: {
        include: {
          order: { select: { id: true, erpOrderId: true } },
        },
      },
      waveLine: {
        include: { wave: { select: { id: true, name: true } } },
      },
    },
  });

  const byOrderWave = new Map<
    string,
    {
      pedidoErp: string;
      onda: string;
      starts: Date[];
      ends: Date[];
      operador: string;
    }
  >();

  for (const alloc of allocations) {
    if (!alloc.sortStartedAt || !alloc.sortCompletedAt) continue;
    if (alloc.quantitySorted < alloc.quantity) continue;

    const orderId = alloc.orderItem.orderId;
    const waveId = alloc.waveLine.wave.id;
    const key = `${orderId}:${waveId}`;
    const existing = byOrderWave.get(key);

    if (existing) {
      existing.starts.push(alloc.sortStartedAt);
      existing.ends.push(alloc.sortCompletedAt);
      existing.operador = alloc.sortedBy?.name ?? existing.operador;
    } else {
      byOrderWave.set(key, {
        pedidoErp: alloc.orderItem.order.erpOrderId,
        onda: alloc.waveLine.wave.name,
        starts: [alloc.sortStartedAt],
        ends: [alloc.sortCompletedAt],
        operador: alloc.sortedBy?.name ?? "—",
      });
    }
  }

  return [...byOrderWave.values()].map((v) => {
    const inicio = new Date(Math.min(...v.starts.map((d) => d.getTime())));
    const fim = new Date(Math.max(...v.ends.map((d) => d.getTime())));
    const duracaoSeg = msToSeconds(fim.getTime() - inicio.getTime());
    return {
      pedidoErp: v.pedidoErp,
      operador: v.operador,
      origem: "ONDA",
      inicio: fmtDateBr(inicio),
      fim: fmtDateBr(fim),
      duracaoSeg,
      duracaoFmt: formatDuration(duracaoSeg),
      onda: v.onda,
    };
  });
}

const ORDER_COLUMNS: ReportColumn[] = [
  { key: "pedidoErp", header: "Pedido ERP" },
  { key: "operador", header: "Operador" },
  { key: "origem", header: "Origem" },
  { key: "inicio", header: "Início" },
  { key: "fim", header: "Fim" },
  { key: "duracaoSeg", header: "Duração (s)" },
  { key: "duracaoFmt", header: "Duração" },
  { key: "onda", header: "Onda" },
];

const USER_COLUMNS: ReportColumn[] = [
  { key: "operador", header: "Operador" },
  { key: "pedidos", header: "Pedidos" },
  { key: "tempoTotalSeg", header: "Tempo total (s)" },
  { key: "tempoMedioSeg", header: "Tempo médio (s)" },
  { key: "tempoMinSeg", header: "Tempo mín. (s)" },
  { key: "tempoMaxSeg", header: "Tempo máx. (s)" },
];

function toOrderResult(
  report: OperationTimeReportId,
  title: string,
  from: Date,
  to: Date,
  rows: OrderTimeRow[],
): ReportResult {
  return {
    report,
    title,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: ORDER_COLUMNS,
    rows: rows as unknown as Record<string, string | number | null>[],
    totalRows: rows.length,
  };
}

function toUserResult(
  report: OperationTimeReportId,
  title: string,
  from: Date,
  to: Date,
  rows: UserTimeRow[],
): ReportResult {
  return {
    report,
    title,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: USER_COLUMNS,
    rows: rows as unknown as Record<string, string | number | null>[],
    totalRows: rows.length,
  };
}

export async function buildOperationTimeReport(
  tenantId: string,
  report: OperationTimeReportId,
  from: Date,
  to: Date,
): Promise<ReportResult> {
  switch (report) {
    case "picking_time_by_order": {
      const rows = [
        ...(await fetchIndividualPickingRows(tenantId, from, to)),
        ...(await fetchWavePickingRows(tenantId, from, to)),
      ].sort((a, b) => (a.pedidoErp ?? "").localeCompare(b.pedidoErp ?? ""));
      return toOrderResult(
        report,
        "Tempo de picking por pedido",
        from,
        to,
        rows,
      );
    }
    case "picking_time_by_user": {
      const orderRows = [
        ...(await fetchIndividualPickingRows(tenantId, from, to)),
        ...(await fetchWavePickingRows(tenantId, from, to)),
      ];
      return toUserResult(
        report,
        "Tempo de picking por operador",
        from,
        to,
        aggregateByUser(orderRows),
      );
    }
    case "packing_time_by_order": {
      const rows = [
        ...(await fetchIndividualPackingRows(tenantId, from, to)),
        ...(await fetchWavePackingRows(tenantId, from, to)),
      ].sort((a, b) => (a.pedidoErp ?? "").localeCompare(b.pedidoErp ?? ""));
      return toOrderResult(
        report,
        "Tempo de packing por pedido",
        from,
        to,
        rows,
      );
    }
    case "packing_time_by_user": {
      const orderRows = [
        ...(await fetchIndividualPackingRows(tenantId, from, to)),
        ...(await fetchWavePackingRows(tenantId, from, to)),
      ];
      return toUserResult(
        report,
        "Tempo de packing por operador",
        from,
        to,
        aggregateByUser(orderRows),
      );
    }
  }
}
