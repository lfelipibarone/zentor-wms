import {
  LocationType,
  PurchaseReceiptKind,
  PurchaseReceiptSessionStatus,
  Prisma,
  type Product,
  type PurchaseReceiptItem,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";
import { assertResourceTenant } from "../lib/tenant-context.js";
import { resolvePickFaceForProduct, PickFaceError } from "./pick-face-resolve.js";
import { formatPurchaseReceiptSession } from "./tiny-purchase-receipt.js";

function durationMs(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  return end.getTime() - start.getTime();
}

const STATUS_TAB_KEYS: PurchaseReceiptSessionStatus[] = [
  PurchaseReceiptSessionStatus.WAITING_ENTRY,
  PurchaseReceiptSessionStatus.READY_TO_CHECK,
  PurchaseReceiptSessionStatus.IN_CHECK,
  PurchaseReceiptSessionStatus.COMPLETED,
  PurchaseReceiptSessionStatus.ISSUE,
];

function buildProductLookup(products: Product[]) {
  const bySku = new Map<string, Product>();
  const byBarcode = new Map<string, Product>();
  for (const p of products) {
    bySku.set(p.sku.toLowerCase(), p);
    if (p.barcode) byBarcode.set(p.barcode.toLowerCase(), p);
  }
  return { bySku, byBarcode };
}

function matchProduct(
  item: PurchaseReceiptItem,
  lookup: ReturnType<typeof buildProductLookup>,
): Product | null {
  const code = item.productCode?.trim().toLowerCase();
  const bc = item.barcode?.trim().toLowerCase();
  if (code && lookup.bySku.has(code)) return lookup.bySku.get(code)!;
  if (code && lookup.byBarcode.has(code)) return lookup.byBarcode.get(code)!;
  if (bc && lookup.byBarcode.has(bc)) return lookup.byBarcode.get(bc)!;
  if (bc && lookup.bySku.has(bc)) return lookup.bySku.get(bc)!;
  return null;
}

async function resolveSuggestedLocation(
  tenantId: string,
  productId: string,
): Promise<string | null> {
  try {
    const loc = await resolvePickFaceForProduct(productId, tenantId);
    return loc.barcode;
  } catch (e) {
    if (e instanceof PickFaceError) {
      const fallback = await prisma.location.findFirst({
        where: {
          tenantId,
          productId,
          type: LocationType.PICK_FACE,
          active: true,
        },
        select: { barcode: true },
        orderBy: { barcode: "asc" },
      });
      return fallback?.barcode ?? null;
    }
    return null;
  }
}

async function enrichReceiptItems(
  tenantId: string,
  items: PurchaseReceiptItem[],
  putawayItems: Array<{
    receiptItemId: string | null;
    location: { barcode: string } | null;
  }>,
) {
  const codes = new Set<string>();
  for (const it of items) {
    if (it.productCode?.trim()) codes.add(it.productCode.trim());
    if (it.barcode?.trim()) codes.add(it.barcode.trim());
  }

  const products =
    codes.size > 0
      ? await prisma.product.findMany({
          where: {
            tenantId,
            active: true,
            OR: [
              { sku: { in: [...codes] } },
              { barcode: { in: [...codes] } },
            ],
          },
        })
      : [];

  const lookup = buildProductLookup(products);
  const putawayByReceiptItem = new Map(
    putawayItems
      .filter((p) => p.receiptItemId && p.location)
      .map((p) => [p.receiptItemId!, p.location!.barcode]),
  );

  const suggestedCache = new Map<string, string | null>();

  return Promise.all(
    items.map(async (it) => {
      const product = matchProduct(it, lookup);
      let suggestedLocation: string | null = null;
      if (product) {
        if (!suggestedCache.has(product.id)) {
          suggestedCache.set(
            product.id,
            await resolveSuggestedLocation(tenantId, product.id),
          );
        }
        suggestedLocation = suggestedCache.get(product.id) ?? null;
      }

      return {
        id: it.id,
        lineNumber: it.lineNumber,
        description: it.description,
        barcode: it.barcode,
        supplierSku: it.productCode,
        sku: product?.sku ?? null,
        imageUrl: product?.imageUrl ?? null,
        quantityExpected: Number(it.quantityExpected),
        quantityChecked: Number(it.quantityChecked),
        completed: Number(it.quantityChecked) >= Number(it.quantityExpected),
        suggestedLocation,
        putawayLocation: putawayByReceiptItem.get(it.id) ?? null,
      };
    }),
  );
}

export async function listPurchaseReceiptsForWeb(params: {
  tenantId: string;
  page?: number;
  pageSize?: number;
  status?: string;
  kind?: PurchaseReceiptKind;
  userId?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: "asc" | "desc";
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
  if (params.kind) where.kind = params.kind;

  if (params.q?.trim()) {
    const q = params.q.trim();
    where.OR = [
      { supplierName: { contains: q, mode: "insensitive" } },
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { accessKey: { contains: q.replace(/\D/g, "") } },
    ];
  }

  if (params.from || params.to) {
    const startedAt: Prisma.DateTimeFilter = {};
    if (params.from) {
      const d = new Date(params.from);
      if (!Number.isNaN(d.getTime())) startedAt.gte = d;
    }
    if (params.to) {
      const d = new Date(params.to);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        startedAt.lte = d;
      }
    }
    if (Object.keys(startedAt).length > 0) where.startedAt = startedAt;
  }

  const orderBy: Prisma.PurchaseReceiptSessionOrderByWithRelationInput = {
    startedAt: params.sort === "asc" ? "asc" : "desc",
  };

  const kindFilter = params.kind ?? PurchaseReceiptKind.ENTRY;

  const [rows, total, statusGroups] = await Promise.all([
    prisma.purchaseReceiptSession.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        startedBy: { select: { id: true, name: true } },
        items: {
          select: { id: true, quantityExpected: true, quantityChecked: true },
        },
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
    prisma.purchaseReceiptSession.groupBy({
      by: ["status"],
      where: {
        tenantId: params.tenantId,
        kind: kindFilter,
      },
      _count: { _all: true },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const key of STATUS_TAB_KEYS) {
    statusCounts[key] = 0;
  }
  for (const g of statusGroups) {
    statusCounts[g.status] = g._count._all;
  }

  return {
    sessions: rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      tinyNotaId: s.tinyNotaId,
      accessKey: s.accessKey,
      reference: s.reference,
      invoiceNumber: s.invoiceNumber,
      supplierName: s.supplierName,
      status: s.status,
      tinySyncStatus: s.tinySyncStatus,
      operatorName: s.startedBy.name,
      startedAt: s.startedAt.toISOString(),
      conferenceStartedAt: s.conferenceStartedAt?.toISOString() ?? null,
      conferenceEndedAt: s.conferenceEndedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      receiptDurationMs: durationMs(
        s.startedAt,
        s.conferenceStartedAt ?? s.completedAt,
      ),
      conferenceDurationMs: durationMs(
        s.conferenceStartedAt,
        s.conferenceEndedAt,
      ),
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
    statusCounts,
  };
}

export async function getPurchaseReceiptDetailForWeb(
  id: string,
  tenantId: string,
) {
  const s = await prisma.purchaseReceiptSession.findUnique({
    where: { id },
    include: {
      startedBy: { select: { name: true } },
      items: { orderBy: { lineNumber: "asc" } },
      putaway: {
        include: {
          assignedTo: { select: { name: true } },
          items: {
            include: { location: { select: { barcode: true } } },
          },
        },
      },
      timeLogs: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (!s) return null;
  await assertResourceTenant(s.tenantId, tenantId);

  const putawayItems = s.putaway?.items ?? [];
  const enrichedItems = await enrichReceiptItems(
    s.tenantId,
    s.items,
    putawayItems,
  );

  const next = enrichedItems.find((it) => !it.completed);
  const allChecked = enrichedItems.every((it) => it.completed);

  return {
    id: s.id,
    kind: s.kind,
    reference: s.reference,
    invoiceNumber: s.invoiceNumber,
    supplierName: s.supplierName,
    accessKey: s.accessKey,
    tinyNotaId: s.tinyNotaId,
    status: s.status,
    tinySyncStatus: s.tinySyncStatus,
    tinySyncMessage: s.tinySyncMessage,
    operatorName: s.startedBy.name,
    startedAt: s.startedAt.toISOString(),
    conferenceStartedAt: s.conferenceStartedAt?.toISOString() ?? null,
    conferenceEndedAt: s.conferenceEndedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    items: enrichedItems,
    nextItem: next
      ? {
          id: next.id,
          lineNumber: next.lineNumber,
          description: next.description,
          supplierSku: next.supplierSku,
          barcode: next.barcode,
          quantityExpected: next.quantityExpected,
          quantityChecked: next.quantityChecked,
          remaining: next.quantityExpected - next.quantityChecked,
        }
      : null,
    allChecked,
    timeLogs: s.timeLogs.map((l) => ({
      event: l.event,
      at: l.createdAt.toISOString(),
      userName: l.user.name,
    })),
    putaway: s.putaway
      ? {
          id: s.putaway.id,
          status: s.putaway.status,
          operatorName: s.putaway.assignedTo?.name ?? null,
          startedAt: s.putaway.startedAt?.toISOString() ?? null,
          completedAt: s.putaway.completedAt?.toISOString() ?? null,
          items: s.putaway.items.map((pi) => ({
            id: pi.id,
            productCode: pi.productCode,
            description: pi.description,
            quantityExpected: Number(pi.quantityExpected),
            quantityStored: Number(pi.quantityStored),
            locationBarcode: pi.location?.barcode ?? null,
          })),
        }
      : null,
  };
}

export { formatPurchaseReceiptSession };
