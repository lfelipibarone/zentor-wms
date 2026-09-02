import {
  OrderStatus,
  OrderTimeLogEvent,
  PickWaveStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { formatMarketplace } from "@wms/shared";
import { PACKING_ISSUE_TYPE_LABEL, type PackingIssueType } from "./order-packing.js";

const PROBLEM_STATUSES: OrderStatus[] = [
  OrderStatus.PACKING_RETURNED_TO_PICKING,
  OrderStatus.PAUSED_ISSUE,
];

export type IssueDetail = {
  source: "PACKING" | "PAUSE";
  typeLabel: string;
  sku: string;
  productName: string | null;
  quantity: number;
  description: string | null;
  summary: string;
};

function parsePackingIssueLog(reason: string | null): IssueDetail | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason) as {
      sku?: string;
      productName?: string;
      type?: PackingIssueType;
      quantity?: number;
      description?: string;
    };
    const typeLabel =
      parsed.type && PACKING_ISSUE_TYPE_LABEL[parsed.type]
        ? PACKING_ISSUE_TYPE_LABEL[parsed.type]
        : "Problema";
    const sku = parsed.sku ?? "";
    const quantity = parsed.quantity ?? 0;
    const description = parsed.description?.trim() || null;
    const productName = parsed.productName?.trim() || null;
    const summaryParts = [
      sku,
      typeLabel,
      `${quantity} un.`,
      description,
    ].filter(Boolean);
    return {
      source: "PACKING",
      typeLabel,
      sku,
      productName,
      quantity,
      description,
      summary: summaryParts.join(" · "),
    };
  } catch {
    return {
      source: "PACKING",
      typeLabel: "Problema",
      sku: "",
      productName: null,
      quantity: 0,
      description: null,
      summary: "Problema reportado no packing",
    };
  }
}

function parsePauseIssueLog(reason: string | null): IssueDetail {
  const description = reason?.trim().slice(0, 280) || null;
  return {
    source: "PAUSE",
    typeLabel: "Pausado na separação",
    sku: "",
    productName: null,
    quantity: 0,
    description,
    summary: description ?? "Pausado por problema",
  };
}

export async function loadLastIssues(orderIds: string[]) {
  const lastIssueByOrder = new Map<string, IssueDetail>();
  if (orderIds.length === 0) return lastIssueByOrder;

  const logs = await prisma.orderTimeLog.findMany({
    where: {
      orderId: { in: orderIds },
      event: {
        in: [OrderTimeLogEvent.PACK_REPORT_ISSUE, OrderTimeLogEvent.PAUSE],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  for (const log of logs) {
    if (lastIssueByOrder.has(log.orderId)) continue;
    if (log.event === OrderTimeLogEvent.PACK_REPORT_ISSUE) {
      const parsed = parsePackingIssueLog(log.reason);
      if (parsed) lastIssueByOrder.set(log.orderId, parsed);
    } else {
      lastIssueByOrder.set(log.orderId, parsePauseIssueLog(log.reason));
    }
  }
  return lastIssueByOrder;
}

function mapOrderIssueFields(issue: IssueDetail | undefined) {
  return {
    issueSummary: issue?.summary ?? null,
    issueDetail: issue ?? null,
  };
}

export function buildIntegrationIssueSummary(
  items: Array<{
    productId: string | null;
    erpSku: string | null;
    product: { sku: string } | null;
  }>,
): string | null {
  const missingSkus = items
    .filter((i) => !i.productId)
    .map((i) => i.erpSku ?? "SKU desconhecido");
  if (missingSkus.length > 0) {
    const preview = missingSkus.slice(0, 3).join(", ");
    const suffix =
      missingSkus.length > 3 ? ` (+${missingSkus.length - 3})` : "";
    return `Produto não cadastrado: ${preview}${suffix}`;
  }
  return "Sem gôndola (pick face) cadastrada para o SKU";
}

export async function listProblemOrders(tenantId: string) {
  const orders = await prisma.order.findMany({
    where: { tenantId, status: { in: PROBLEM_STATUSES } },
    orderBy: [
      { priority: "desc" },
      { collectionDeadline: { sort: "asc", nulls: "last" } },
      { updatedAt: "desc" },
    ],
    include: {
      items: { include: { product: { select: { sku: true, name: true } } } },
      waveOrders: {
        include: { wave: { select: { id: true, name: true, status: true } } },
      },
    },
  });

  const issueMap = await loadLastIssues(orders.map((o) => o.id));

  return {
    orders: orders.map((o) => {
      const issue = issueMap.get(o.id);
      const integrationSummary =
        o.status === OrderStatus.PAUSED_ISSUE && !issue
          ? buildIntegrationIssueSummary(o.items)
          : null;
      const activeWave = o.waveOrders.find(
        (wo) => wo.wave.status === PickWaveStatus.RELEASED,
      );
      return {
        id: o.id,
        erpOrderId: o.erpOrderId,
        status: o.status,
        priority: o.priority,
        customerName: o.customerName,
        marketplace: o.marketplace,
        marketplaceLabel: formatMarketplace(o.marketplace),
        collectionDeadline: o.collectionDeadline?.toISOString() ?? null,
        returnedFromPacking:
          o.status === OrderStatus.PACKING_RETURNED_TO_PICKING,
        pausedIssue: o.status === OrderStatus.PAUSED_ISSUE,
        ...mapOrderIssueFields(issue),
        issueSummary: issue?.summary ?? integrationSummary,
        waveId: activeWave?.wave.id ?? null,
        waveName: activeWave?.wave.name ?? null,
        itemCount: o.items.length,
        totalUnits: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
        qtyPicked: o.items.reduce((s, i) => s + i.quantityPicked, 0),
        items: o.items.map((i) => ({
          id: i.id,
          sku: i.product?.sku ?? i.erpSku ?? "SKU pendente",
          name: i.product?.name ?? i.erpDescription ?? null,
          quantityOrdered: i.quantityOrdered,
          quantityPicked: i.quantityPicked,
          remaining: Math.max(0, i.quantityOrdered - i.quantityPicked),
        })),
      };
    }),
  };
}

export async function listProblemWaves(tenantId: string) {
  const waves = await prisma.pickWave.findMany({
    where: {
      tenantId,
      status: PickWaveStatus.RELEASED,
      orders: {
        some: {
          order: { status: { in: PROBLEM_STATUSES } },
        },
      },
    },
    orderBy: { releasedAt: "asc" },
    include: {
      acceptedBy: { select: { id: true, name: true } },
      orders: {
        include: {
          order: {
            select: {
              id: true,
              erpOrderId: true,
              status: true,
              customerName: true,
              marketplace: true,
            },
          },
        },
      },
      lines: {
        select: {
          id: true,
          quantityPicked: true,
          quantityTotal: true,
          sortStatus: true,
          pickLocation: { select: { barcode: true, corridor: true, row: true } },
          product: { select: { sku: true } },
        },
      },
    },
  });

  const problemOrderIds = waves.flatMap((w) =>
    w.orders
      .filter((wo) => PROBLEM_STATUSES.includes(wo.order.status))
      .map((wo) => wo.order.id),
  );
  const issueMap = await loadLastIssues(problemOrderIds);

  return {
    waves: waves.map((w) => ({
      id: w.id,
      name: w.name,
      releasedAt: w.releasedAt?.toISOString() ?? null,
      acceptedByName: w.acceptedBy?.name ?? null,
      orderCount: w.orders.length,
      lineCount: w.lines.length,
      problemOrders: w.orders
        .filter((wo) => PROBLEM_STATUSES.includes(wo.order.status))
        .map((wo) => {
          const issue = issueMap.get(wo.order.id);
          return {
            id: wo.order.id,
            erpOrderId: wo.order.erpOrderId,
            status: wo.order.status,
            customerName: wo.order.customerName,
            marketplaceLabel: formatMarketplace(wo.order.marketplace),
            returnedFromPacking:
              wo.order.status === OrderStatus.PACKING_RETURNED_TO_PICKING,
            pausedIssue: wo.order.status === OrderStatus.PAUSED_ISSUE,
            ...mapOrderIssueFields(issue),
          };
        }),
      lines: w.lines.map((l) => ({
        id: l.id,
        sku: l.product.sku,
        locationBarcode: l.pickLocation.barcode,
        routeLabel: `${l.pickLocation.corridor}-${l.pickLocation.row}`,
        quantityPicked: l.quantityPicked,
        quantityTotal: l.quantityTotal,
        sortStatus: l.sortStatus,
      })),
    })),
  };
}
