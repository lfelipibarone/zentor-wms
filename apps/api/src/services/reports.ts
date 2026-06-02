import {
  InventoryMovementType,
  LocationType,
  OrderStatus,
  OrderTimeLogEvent,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { PACKING_ISSUE_TYPE_LABEL, type PackingIssueType } from "./order-packing.js";
import { marketplaceWhereClause } from "./marketplace-filter.js";
import { marketplaceDisplayLabel } from "./marketplace-priority.js";

import {
  buildOperationTimeReport,
  OPERATION_TIME_REPORT_IDS,
} from "./operation-time-reports.js";
import {
  fmtDateBr,
  type ReportColumn,
  type ReportResult as BaseReportResult,
} from "./report-types.js";

export { fmtDateBr, type ReportColumn } from "./report-types.js";

export const REPORT_IDS = [
  "dispatched",
  "orders",
  "picking",
  "movements",
  "low_stock",
  "packing_issues",
  "volume_by_marketplace",
  ...OPERATION_TIME_REPORT_IDS,
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

export const REPORTS_WITH_MARKETPLACE_FILTER = new Set<ReportId>([
  "dispatched",
  "orders",
  "packing_issues",
  "picking_time_by_order",
  "packing_time_by_order",
]);

function withMarketplaceFilter(
  base: Prisma.OrderWhereInput,
  marketplace?: string,
): Prisma.OrderWhereInput {
  const mp = marketplaceWhereClause(marketplace);
  if (!mp) return base;
  return { AND: [base, mp] };
}

export interface ReportResult extends Omit<BaseReportResult, "report"> {
  report: ReportId;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function parseDateRange(
  fromStr?: string,
  toStr?: string,
): { from: Date; to: Date } {
  const now = new Date();
  const from = fromStr ? startOfDay(new Date(fromStr)) : startOfDay(now);
  const to = toStr ? endOfDay(new Date(toStr)) : endOfDay(now);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Datas inválidas");
  }
  if (from > to) {
    throw new Error("Data inicial não pode ser maior que a data final");
  }
  return { from, to };
}

function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Aguardando separação",
  PICKING: "Em separação",
  PAUSED_ISSUE: "Pausado (problema)",
  PICKED_AWAITING_CONFERENCE: "Aguardando conferência",
  PACKING_RETURNED_TO_PICKING: "Retorno do packing",
  DISPATCHING: "Pronto para expedir",
  DISPATCHED: "Expedido",
};

const MOVEMENT_LABEL: Record<InventoryMovementType, string> = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  TRANSFER: "Transferência",
  ADJUSTMENT: "Ajuste",
  PICK_ALLOCATION: "Separação",
  REPLENISHMENT: "Reabastecimento",
};

export function reportTitle(id: ReportId): string {
  const titles: Record<ReportId, string> = {
    dispatched: "Pedidos expedidos",
    orders: "Pedidos no período",
    picking: "Separação (movimentações)",
    movements: "Movimentações de estoque",
    low_stock: "Gôndolas abaixo do mínimo",
    packing_issues: "Incidentes no packing",
    volume_by_marketplace: "Volume por marketplace",
    picking_time_by_order: "Tempo de picking por pedido",
    picking_time_by_user: "Tempo de picking por operador",
    packing_time_by_order: "Tempo de packing por pedido",
    packing_time_by_user: "Tempo de packing por operador",
  };
  return titles[id];
}

export async function runReport(params: {
  tenantId: string;
  report: ReportId;
  from?: string;
  to?: string;
  status?: string;
  movementType?: string;
  marketplace?: string;
}): Promise<ReportResult> {
  const {
    tenantId,
    report,
    from: fromStr,
    to: toStr,
    status,
    movementType,
    marketplace,
  } = params;

  if (report === "low_stock") {
    return buildLowStockReport(tenantId);
  }

  const { from, to } = parseDateRange(fromStr, toStr);

  switch (report) {
    case "dispatched":
      return buildDispatchedReport(tenantId, from, to, marketplace);
    case "orders":
      return buildOrdersReport(tenantId, from, to, status, marketplace);
    case "picking":
      return buildPickingReport(tenantId, from, to);
    case "movements":
      return buildMovementsReport(tenantId, from, to, movementType);
    case "packing_issues":
      return buildPackingIssuesReport(tenantId, from, to, marketplace);
    case "volume_by_marketplace":
      return buildVolumeByMarketplaceReport(tenantId, from, to);
    case "picking_time_by_order":
    case "picking_time_by_user":
    case "packing_time_by_order":
    case "packing_time_by_user":
      return (await buildOperationTimeReport(
        tenantId,
        report,
        from,
        to,
        marketplace,
      )) as ReportResult;
    default:
      throw new Error("Relatório desconhecido");
  }
}

async function buildDispatchedReport(
  tenantId: string,
  from: Date,
  to: Date,
  marketplace?: string,
): Promise<ReportResult> {
  const orders = await prisma.order.findMany({
    where: withMarketplaceFilter(
      {
        tenantId,
        status: OrderStatus.DISPATCHED,
        OR: [
          { dispatchedAt: { gte: from, lte: to } },
          {
            dispatchedAt: null,
            updatedAt: { gte: from, lte: to },
          },
        ],
      },
      marketplace,
    ),
    orderBy: [{ dispatchedAt: "desc" }, { updatedAt: "desc" }],
    include: {
      basket: { select: { code: true } },
      assignedPicker: { select: { name: true } },
      items: {
        include: { product: { select: { sku: true, name: true } } },
      },
    },
  });

  const rows = orders.map((o) => {
    const units = o.items.reduce((s, i) => s + i.quantityPicked, 0);
    const expedidoEm = o.dispatchedAt ?? o.updatedAt;
    return {
      erpOrderId: o.erpOrderId,
      customerName: o.customerName,
      marketplace: marketplaceDisplayLabel(o.marketplace),
      shippingLabel: o.shippingLabel,
      pickerName: o.assignedPicker?.name ?? null,
      basketCode: o.basket?.code ?? null,
      lineCount: o.items.length,
      unitsPicked: units,
      expedidoEm: fmtDateBr(expedidoEm),
      expedidoEmIso: fmtDate(expedidoEm),
      criadoEm: fmtDateBr(o.createdAt),
    };
  });

  return {
    report: "dispatched",
    title: reportTitle("dispatched"),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: [
      { key: "erpOrderId", header: "Pedido ERP" },
      { key: "customerName", header: "Cliente" },
      { key: "marketplace", header: "Marketplace" },
      { key: "shippingLabel", header: "Etiqueta envio" },
      { key: "pickerName", header: "Separador" },
      { key: "basketCode", header: "Cesta" },
      { key: "lineCount", header: "Linhas" },
      { key: "unitsPicked", header: "Unidades" },
      { key: "expedidoEm", header: "Expedido em" },
      { key: "criadoEm", header: "Criado em" },
    ],
    rows,
    totalRows: rows.length,
  };
}

async function buildOrdersReport(
  tenantId: string,
  from: Date,
  to: Date,
  statusFilter?: string,
  marketplace?: string,
): Promise<ReportResult> {
  const status =
    statusFilter && statusFilter in OrderStatus
      ? (statusFilter as OrderStatus)
      : undefined;

  const orders = await prisma.order.findMany({
    where: withMarketplaceFilter(
      {
        tenantId,
        ...(status ? { status } : {}),
        OR: [
          { createdAt: { gte: from, lte: to } },
          { updatedAt: { gte: from, lte: to } },
        ],
      },
      marketplace,
    ),
    orderBy: { updatedAt: "desc" },
    include: {
      basket: { select: { code: true } },
      assignedPicker: { select: { name: true } },
      items: true,
    },
  });

  const rows = orders.map((o) => {
    const ordered = o.items.reduce((s, i) => s + i.quantityOrdered, 0);
    const picked = o.items.reduce((s, i) => s + i.quantityPicked, 0);
    return {
      erpOrderId: o.erpOrderId,
      customerName: o.customerName,
      marketplace: marketplaceDisplayLabel(o.marketplace),
      status: STATUS_LABEL[o.status],
      statusCode: o.status,
      pickerName: o.assignedPicker?.name ?? null,
      basketCode: o.basket?.code ?? null,
      lineCount: o.items.length,
      unitsOrdered: ordered,
      unitsPicked: picked,
      priority: o.priority,
      criadoEm: fmtDateBr(o.createdAt),
      atualizadoEm: fmtDateBr(o.updatedAt),
      expedidoEm: o.dispatchedAt ? fmtDateBr(o.dispatchedAt) : null,
    };
  });

  return {
    report: "orders",
    title: reportTitle("orders"),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: [
      { key: "erpOrderId", header: "Pedido ERP" },
      { key: "customerName", header: "Cliente" },
      { key: "marketplace", header: "Marketplace" },
      { key: "status", header: "Status" },
      { key: "pickerName", header: "Separador" },
      { key: "basketCode", header: "Cesta" },
      { key: "lineCount", header: "Linhas" },
      { key: "unitsOrdered", header: "Qtd pedida" },
      { key: "unitsPicked", header: "Qtd separada" },
      { key: "priority", header: "Prioridade" },
      { key: "criadoEm", header: "Criado em" },
      { key: "atualizadoEm", header: "Atualizado em" },
      { key: "expedidoEm", header: "Expedido em" },
    ],
    rows,
    totalRows: rows.length,
  };
}

async function buildPickingReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ReportResult> {
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      tenantId,
      type: InventoryMovementType.PICK_ALLOCATION,
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
      product: { select: { sku: true, name: true } },
      order: { select: { erpOrderId: true } },
      fromLocation: { select: { barcode: true } },
    },
  });

  const rows = movements.map((m) => ({
    dataHora: fmtDateBr(m.createdAt),
    operador: m.user.name,
    pedidoErp: m.order?.erpOrderId ?? null,
    sku: m.product.sku,
    produto: m.product.name,
    quantidade: m.quantity,
    localOrigem: m.fromLocation?.barcode ?? null,
    referencia: m.reference,
  }));

  return {
    report: "picking",
    title: reportTitle("picking"),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: [
      { key: "dataHora", header: "Data/hora" },
      { key: "operador", header: "Operador" },
      { key: "pedidoErp", header: "Pedido ERP" },
      { key: "sku", header: "SKU" },
      { key: "produto", header: "Produto" },
      { key: "quantidade", header: "Quantidade" },
      { key: "localOrigem", header: "Local origem" },
      { key: "referencia", header: "Referência" },
    ],
    rows,
    totalRows: rows.length,
  };
}

async function buildPackingIssuesReport(
  tenantId: string,
  from: Date,
  to: Date,
  marketplace?: string,
): Promise<ReportResult> {
  const mp = marketplaceWhereClause(marketplace);
  const logs = await prisma.orderTimeLog.findMany({
    where: {
      event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
      createdAt: { gte: from, lte: to },
      order: { tenantId, ...(mp ?? {}) },
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
      order: {
        select: { erpOrderId: true, customerName: true, marketplace: true },
      },
    },
  });

  const rows = logs.map((log) => {
    let parsed: {
      sku?: string;
      productName?: string;
      type?: PackingIssueType;
      quantity?: number;
      description?: string;
    } = {};
    if (log.reason) {
      try {
        parsed = JSON.parse(log.reason);
      } catch {
        parsed = {};
      }
    }
    const typeLabel = parsed.type
      ? PACKING_ISSUE_TYPE_LABEL[parsed.type] ?? parsed.type
      : null;
    return {
      dataHora: fmtDateBr(log.createdAt),
      pedidoErp: log.order?.erpOrderId ?? null,
      cliente: log.order?.customerName ?? null,
      marketplace: marketplaceDisplayLabel(log.order?.marketplace),
      sku: parsed.sku ?? null,
      produto: parsed.productName ?? null,
      tipo: typeLabel,
      quantidade: parsed.quantity ?? null,
      descricao: parsed.description || null,
      reportadoPor: log.user.name,
    };
  });

  return {
    report: "packing_issues",
    title: reportTitle("packing_issues"),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: [
      { key: "dataHora", header: "Data/hora" },
      { key: "pedidoErp", header: "Pedido ERP" },
      { key: "cliente", header: "Cliente" },
      { key: "marketplace", header: "Marketplace" },
      { key: "sku", header: "SKU" },
      { key: "produto", header: "Produto" },
      { key: "tipo", header: "Tipo" },
      { key: "quantidade", header: "Qtd" },
      { key: "descricao", header: "Descrição" },
      { key: "reportadoPor", header: "Reportado por" },
    ],
    rows,
    totalRows: rows.length,
  };
}

async function buildVolumeByMarketplaceReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ReportResult> {
  const periodWhere: Prisma.OrderWhereInput = {
    tenantId,
    OR: [
      { createdAt: { gte: from, lte: to } },
      { updatedAt: { gte: from, lte: to } },
    ],
  };

  const orders = await prisma.order.findMany({
    where: periodWhere,
    select: {
      id: true,
      marketplace: true,
      status: true,
      dispatchedAt: true,
      updatedAt: true,
    },
  });

  const issueLogs = await prisma.orderTimeLog.findMany({
    where: {
      event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
      createdAt: { gte: from, lte: to },
      order: { tenantId },
    },
    select: { order: { select: { marketplace: true } } },
  });

  const agg = new Map<
    string,
    { label: string; orders: number; dispatched: number; issues: number }
  >();

  const keyOf = (raw: string | null) =>
    raw?.trim() ? raw.trim() : "__SEM__";

  for (const o of orders) {
    const key = keyOf(o.marketplace);
    const cur = agg.get(key) ?? {
      label: marketplaceDisplayLabel(o.marketplace),
      orders: 0,
      dispatched: 0,
      issues: 0,
    };
    cur.orders += 1;
    if (o.status === OrderStatus.DISPATCHED) {
      const exp = o.dispatchedAt ?? o.updatedAt;
      if (exp >= from && exp <= to) cur.dispatched += 1;
    }
    agg.set(key, cur);
  }

  for (const log of issueLogs) {
    const key = keyOf(log.order.marketplace);
    const cur = agg.get(key) ?? {
      label: marketplaceDisplayLabel(log.order.marketplace),
      orders: 0,
      dispatched: 0,
      issues: 0,
    };
    cur.issues += 1;
    agg.set(key, cur);
  }

  const totalOrders = orders.length;
  const rows = [...agg.values()]
    .sort((a, b) => b.orders - a.orders)
    .map((r) => ({
      marketplace: r.label,
      pedidosNoPeriodo: r.orders,
      expedidos: r.dispatched,
      pctDoTotal:
        totalOrders > 0
          ? `${Math.round((r.orders / totalOrders) * 1000) / 10}%`
          : "0%",
      incidentesPacking: r.issues,
    }));

  return {
    report: "volume_by_marketplace",
    title: reportTitle("volume_by_marketplace"),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: [
      { key: "marketplace", header: "Marketplace" },
      { key: "pedidosNoPeriodo", header: "Pedidos no período" },
      { key: "expedidos", header: "Expedidos" },
      { key: "pctDoTotal", header: "% do total" },
      { key: "incidentesPacking", header: "Incidentes packing" },
    ],
    rows,
    totalRows: rows.length,
  };
}

async function buildMovementsReport(
  tenantId: string,
  from: Date,
  to: Date,
  movementType?: string,
): Promise<ReportResult> {
  const type =
    movementType && movementType in InventoryMovementType
      ? (movementType as InventoryMovementType)
      : undefined;

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
      product: { select: { sku: true, name: true } },
      order: { select: { erpOrderId: true } },
      fromLocation: { select: { barcode: true } },
      toLocation: { select: { barcode: true } },
      cargoTransfer: {
        select: {
          withdrawnBy: { select: { name: true } },
          depositedBy: { select: { name: true } },
        },
      },
    },
  });

  const rows = movements.map((m) => ({
    dataHora: fmtDateBr(m.createdAt),
    tipo: MOVEMENT_LABEL[m.type],
    tipoCodigo: m.type,
    sku: m.product.sku,
    produto: m.product.name,
    quantidade: m.quantity,
    operador: m.user.name,
    localOrigem: m.fromLocation?.barcode ?? null,
    localDestino: m.toLocation?.barcode ?? null,
    pedidoErp: m.order?.erpOrderId ?? null,
    referencia: m.reference,
    observacao: m.notes,
    duracaoSegundos:
      m.startedAt && m.completedAt
        ? Math.round(
            (m.completedAt.getTime() - m.startedAt.getTime()) / 1000,
          )
        : null,
    transporteRetirada: m.cargoTransfer?.withdrawnBy.name ?? null,
    transporteDeposito: m.cargoTransfer?.depositedBy?.name ?? null,
  }));

  return {
    report: "movements",
    title: reportTitle("movements"),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: [
      { key: "dataHora", header: "Data/hora" },
      { key: "tipo", header: "Tipo" },
      { key: "sku", header: "SKU" },
      { key: "produto", header: "Produto" },
      { key: "quantidade", header: "Quantidade" },
      { key: "operador", header: "Operador" },
      { key: "localOrigem", header: "Origem" },
      { key: "localDestino", header: "Destino" },
      { key: "pedidoErp", header: "Pedido ERP" },
      { key: "referencia", header: "Referência" },
      { key: "observacao", header: "Observação" },
      { key: "duracaoSegundos", header: "Duração (s)" },
      { key: "transporteRetirada", header: "Retirada por" },
      { key: "transporteDeposito", header: "Depósito por" },
    ],
    rows,
    totalRows: rows.length,
  };
}

async function buildLowStockReport(tenantId: string): Promise<ReportResult> {
  const locations = await prisma.location.findMany({
    where: { tenantId, active: true, type: LocationType.PICK_FACE },
    include: { product: { select: { sku: true, name: true } } },
    orderBy: [{ corridor: "asc" }, { row: "asc" }],
  });

  const low = locations.filter((l) => l.currentQuantity <= l.minThreshold);

  const rows = low.map((l) => ({
    local: l.barcode,
    corredor: l.corridor,
    fileira: l.row,
    sku: l.product?.sku ?? null,
    produto: l.product?.name ?? null,
    quantidadeAtual: l.currentQuantity,
    minimo: l.minThreshold,
    capacidade: l.capacity,
    deficit: l.minThreshold - l.currentQuantity,
  }));

  return {
    report: "low_stock",
    title: reportTitle("low_stock"),
    from: null,
    to: null,
    columns: [
      { key: "local", header: "Local" },
      { key: "corredor", header: "Corredor" },
      { key: "fileira", header: "Fileira" },
      { key: "sku", header: "SKU" },
      { key: "produto", header: "Produto" },
      { key: "quantidadeAtual", header: "Qtd atual" },
      { key: "minimo", header: "Mínimo" },
      { key: "capacidade", header: "Capacidade" },
      { key: "deficit", header: "Déficit" },
    ],
    rows,
    totalRows: rows.length,
  };
}

export function reportToCsv(result: ReportResult): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = result.columns.map((c) => escape(c.header)).join(";");
  const lines = result.rows.map((row) =>
    result.columns.map((c) => escape(row[c.key])).join(";"),
  );
  return `\uFEFF${[header, ...lines].join("\r\n")}`;
}

export async function getReportsSummary(
  tenantId: string,
  fromStr?: string,
  toStr?: string,
) {
  const { from, to } = parseDateRange(fromStr, toStr);

  const [
    ordersByStatus,
    productsCount,
    locationsLow,
    movementsInRange,
    topPickers,
    dispatchedInRange,
  ] = await Promise.all([
    prisma.order.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { id: true },
    }),
    prisma.product.count({ where: { tenantId, active: true } }),
    prisma.location.findMany({
      where: { tenantId, active: true, type: LocationType.PICK_FACE },
      include: { product: { select: { sku: true } } },
    }),
    prisma.inventoryMovement.count({
      where: { tenantId, createdAt: { gte: from, lte: to } },
    }),
    prisma.inventoryMovement.groupBy({
      by: ["userId"],
      where: {
        tenantId,
        type: InventoryMovementType.PICK_ALLOCATION,
        createdAt: { gte: from, lte: to },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    prisma.order.count({
      where: {
        tenantId,
        status: OrderStatus.DISPATCHED,
        OR: [
          { dispatchedAt: { gte: from, lte: to } },
          { dispatchedAt: null, updatedAt: { gte: from, lte: to } },
        ],
      },
    }),
  ]);

  const lowStock = locationsLow.filter(
    (l) => l.currentQuantity <= l.minThreshold,
  );

  const pickerIds = topPickers.map((p) => p.userId);
  const pickers = await prisma.user.findMany({
    where: { id: { in: pickerIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(pickers.map((u) => [u.id, u.name]));

  const dispatchedByMarketplace = await prisma.order.groupBy({
    by: ["marketplace"],
    where: {
      tenantId,
      status: OrderStatus.DISPATCHED,
      OR: [
        { dispatchedAt: { gte: from, lte: to } },
        { dispatchedAt: null, updatedAt: { gte: from, lte: to } },
      ],
    },
    _count: { id: true },
  });

  return {
    periodFrom: from.toISOString().slice(0, 10),
    periodTo: to.toISOString().slice(0, 10),
    ordersByStatus: ordersByStatus.map((r) => ({
      status: r.status,
      count: r._count.id,
    })),
    dispatchedByMarketplace: dispatchedByMarketplace.map((r) => ({
      marketplace: marketplaceDisplayLabel(r.marketplace),
      count: r._count.id,
    })),
    productsCount,
    locationsCount: locationsLow.length,
    lowStockCount: lowStock.length,
    movementsInPeriod: movementsInRange,
    dispatchedInPeriod: dispatchedInRange,
    topPickers: topPickers.map((p) => ({
      userName: nameMap.get(p.userId) ?? "—",
      itemsPicked: p._sum.quantity ?? 0,
    })),
    lowStock: lowStock.slice(0, 10).map((l) => ({
      barcode: l.barcode,
      sku: l.product?.sku,
      currentQuantity: l.currentQuantity,
      minThreshold: l.minThreshold,
    })),
  };
}
