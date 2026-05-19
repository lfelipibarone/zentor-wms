import { PurchaseReceiptSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";

function durationMs(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  return end.getTime() - start.getTime();
}

export async function listPurchaseReceiptsForWeb(params: {
  tenantId: string;
  page?: number;
  pageSize?: number;
  status?: string;
  userId?: string;
}) {
  const { page, pageSize, skip, take } = parsePagination({
    page: params.page != null ? String(params.page) : undefined,
    pageSize: params.pageSize != null ? String(params.pageSize) : undefined,
  });
  const where: Prisma.PurchaseReceiptSessionWhereInput = {
    tenantId: params.tenantId,
  };
  if (
    params.status &&
    Object.values(PurchaseReceiptSessionStatus).includes(
      params.status as PurchaseReceiptSessionStatus,
    )
  ) {
    where.status = params.status as PurchaseReceiptSessionStatus;
  }
  if (params.userId) where.startedById = params.userId;

  const [rows, total] = await Promise.all([
    prisma.purchaseReceiptSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take,
      include: {
        startedBy: { select: { id: true, name: true } },
        items: { select: { id: true, quantityExpected: true, quantityChecked: true } },
        putaway: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            assignedTo: { select: { name: true } },
          },
        },
      },
    }),
    prisma.purchaseReceiptSession.count({ where }),
  ]);

  return {
    sessions: rows.map((s) => ({
      id: s.id,
      tinyNotaId: s.tinyNotaId,
      accessKey: s.accessKey,
      invoiceNumber: s.invoiceNumber,
      supplierName: s.supplierName,
      status: s.status,
      tinySyncStatus: s.tinySyncStatus,
      operatorName: s.startedBy.name,
      startedAt: s.startedAt.toISOString(),
      conferenceStartedAt: s.conferenceStartedAt?.toISOString() ?? null,
      conferenceEndedAt: s.conferenceEndedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      receiptDurationMs: durationMs(s.startedAt, s.conferenceStartedAt ?? s.completedAt),
      conferenceDurationMs: durationMs(s.conferenceStartedAt, s.conferenceEndedAt),
      itemCount: s.items.length,
      itemsChecked: s.items.filter(
        (i) => Number(i.quantityChecked) >= Number(i.quantityExpected),
      ).length,
      putaway: s.putaway
        ? {
            status: s.putaway.status,
            operatorName: s.putaway.assignedTo?.name ?? null,
            startedAt: s.putaway.startedAt?.toISOString() ?? null,
            completedAt: s.putaway.completedAt?.toISOString() ?? null,
            durationMs: durationMs(s.putaway.startedAt, s.putaway.completedAt),
          }
        : null,
    })),
    pagination: buildPaginationMeta(total, page, pageSize),
  };
}

export async function getPurchaseReceiptDetailForWeb(id: string) {
  const s = await prisma.purchaseReceiptSession.findUnique({
    where: { id },
    include: {
      startedBy: { select: { name: true } },
      items: { orderBy: { lineNumber: "asc" } },
      putaway: {
        include: {
          assignedTo: { select: { name: true } },
          items: { include: { location: { select: { barcode: true } } } },
        },
      },
      timeLogs: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
    },
  });
  if (!s) return null;
  return {
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    supplierName: s.supplierName,
    accessKey: s.accessKey,
    status: s.status,
    operatorName: s.startedBy.name,
    items: s.items.map((i) => ({
      lineNumber: i.lineNumber,
      productCode: i.productCode,
      description: i.description,
      quantityExpected: Number(i.quantityExpected),
      quantityChecked: Number(i.quantityChecked),
    })),
    timeLogs: s.timeLogs.map((l) => ({
      event: l.event,
      at: l.createdAt.toISOString(),
      userName: l.user.name,
    })),
    putaway: s.putaway,
  };
}
