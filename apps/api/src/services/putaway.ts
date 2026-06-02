import {
  InventoryMovementType,
  LocationType,
  Prisma,
  PutawaySessionStatus,
  PurchaseReceiptSessionStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  pickNextItemByRoute,
  sortPendingItemsByRoute,
} from "./location-route.js";

export async function listPutawayQueue(tenantId?: string) {
  const sessions = await prisma.purchaseReceiptSession.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      status: PurchaseReceiptSessionStatus.COMPLETED,
      OR: [
        { putaway: null },
        { putaway: { status: PutawaySessionStatus.PENDING } },
      ],
    },
    orderBy: { completedAt: "desc" },
    take: 50,
    include: {
      startedBy: { select: { name: true } },
      items: true,
      putaway: true,
    },
  });

  return sessions.map((s) => ({
    purchaseReceiptId: s.id,
    putawaySessionId: s.putaway?.id ?? null,
    invoiceNumber: s.invoiceNumber,
    supplierName: s.supplierName,
    completedAt: s.completedAt?.toISOString() ?? null,
    receiptOperator: s.startedBy.name,
    itemCount: s.items.length,
    status: s.putaway?.status ?? PutawaySessionStatus.PENDING,
  }));
}

async function ensurePutawaySession(purchaseReceiptId: string, userId: string) {
  const receipt = await prisma.purchaseReceiptSession.findUnique({
    where: { id: purchaseReceiptId },
    include: { items: true, putaway: { include: { items: true } } },
  });
  if (!receipt || receipt.status !== PurchaseReceiptSessionStatus.COMPLETED) {
    throw new Error("NF não está conferida");
  }

  if (receipt.putaway) {
    if (receipt.putaway.status === PutawaySessionStatus.PENDING) {
      const startedAt = new Date();
      await prisma.putawaySession.update({
        where: { id: receipt.putaway.id },
        data: {
          status: PutawaySessionStatus.IN_PROGRESS,
          assignedToId: userId,
          startedAt,
        },
      });
      await prisma.putawayTimeLog.create({
        data: { sessionId: receipt.putaway.id, userId, event: "START" },
      });
    }
    return prisma.putawaySession.findUnique({
      where: { id: receipt.putaway.id },
      include: {
        items: {
          include: {
            location: {
              select: { barcode: true, corridor: true, row: true },
            },
          },
        },
        purchaseReceipt: { include: { items: true } },
      },
    });
  }

  const startedAt = new Date();
  const session = await prisma.putawaySession.create({
    data: {
      purchaseReceiptId,
      status: PutawaySessionStatus.IN_PROGRESS,
      assignedToId: userId,
      startedAt,
      items: {
        create: receipt.items.map((it) => ({
          receiptItemId: it.id,
          productCode: it.productCode,
          description: it.description,
          barcode: it.barcode,
          quantityExpected: it.quantityChecked,
        })),
      },
    },
    include: {
      items: { include: { location: { select: { barcode: true } } } },
      purchaseReceipt: { include: { items: true } },
    },
  });
  await prisma.putawayTimeLog.create({
    data: { sessionId: session.id, userId, event: "START" },
  });
  return session;
}

function formatPutaway(session: NonNullable<Awaited<ReturnType<typeof ensurePutawaySession>>>) {
  const isPending = (it: (typeof session.items)[0]) =>
    Number(it.quantityStored) < Number(it.quantityExpected);

  const lastStoredLoc = [...session.items]
    .filter((it) => it.location && Number(it.quantityStored) > 0)
    .sort(
      (a, b) =>
        (b.location?.barcode ?? "").localeCompare(a.location?.barcode ?? ""),
    )[0]?.location;

  const pendingWithLoc = session.items.filter(isPending).map((it) => ({
    ...it,
    pickLocation: it.location ?? null,
  }));

  const next =
    pickNextItemByRoute(pendingWithLoc, isPending, lastStoredLoc) ??
    session.items.find(isPending);

  const routeQueue = sortPendingItemsByRoute(
    pendingWithLoc,
    isPending,
    lastStoredLoc,
  );
  return {
    session: {
      id: session.id,
      purchaseReceiptId: session.purchaseReceiptId,
      status: session.status,
      startedAt: session.startedAt?.toISOString() ?? null,
    },
    items: session.items.map((it) => ({
      id: it.id,
      productCode: it.productCode,
      description: it.description,
      barcode: it.barcode,
      quantityExpected: Number(it.quantityExpected),
      quantityStored: Number(it.quantityStored),
      locationBarcode: it.location?.barcode ?? null,
      completed: Number(it.quantityStored) >= Number(it.quantityExpected),
    })),
    nextItem: next
      ? {
          id: next.id,
          productCode: next.productCode,
          description: next.description,
          barcode: next.barcode,
          remaining:
            Number(next.quantityExpected) - Number(next.quantityStored),
        }
      : null,
    allStored: session.items.every(
      (it) => Number(it.quantityStored) >= Number(it.quantityExpected),
    ),
    routeQueue: routeQueue.slice(0, 5).map((it) => ({
      id: it.id,
      productCode: it.productCode,
      locationBarcode: it.location?.barcode ?? null,
    })),
  };
}

export async function startPutaway(purchaseReceiptId: string, userId: string) {
  const session = await ensurePutawaySession(purchaseReceiptId, userId);
  if (!session) throw new Error("Sessão de armazenagem não encontrada");
  return formatPutaway(session);
}

export async function getPutawaySession(sessionId: string) {
  const session = await prisma.putawaySession.findUnique({
    where: { id: sessionId },
    include: {
      items: { include: { location: { select: { barcode: true } } } },
      purchaseReceipt: { include: { items: true } },
    },
  });
  if (!session) throw new Error("Sessão não encontrada");
  return formatPutaway(session);
}

export async function storePutawayItem(params: {
  sessionId: string;
  itemId: string;
  locationBarcode: string;
  productBarcode?: string;
  quantity: number;
  userId: string;
}) {
  const session = await prisma.putawaySession.findUnique({
    where: { id: params.sessionId },
    include: {
      purchaseReceipt: { select: { tenantId: true } },
      items: { include: { location: { select: { barcode: true } } } },
    },
  });
  if (!session) throw new Error("Sessão não encontrada");
  const tenantId = session.purchaseReceipt.tenantId;

  const location = await prisma.location.findFirst({
    where: {
      tenantId,
      barcode: params.locationBarcode.trim(),
      type: LocationType.PULMAO,
      active: true,
    },
  });
  if (!location) throw new Error("Local de pulmão não encontrado");

  const item = session.items.find((i) => i.id === params.itemId);
  if (!item) throw new Error("Item não encontrado");

  const code = params.productBarcode?.trim() ?? "";
  if (code) {
    if (
      item.barcode &&
      item.barcode !== code &&
      item.productCode &&
      item.productCode !== code
    ) {
      throw new Error("Produto não confere com o item da NF");
    }
  }

  const sku = item.productCode ?? code;
  if (!sku) throw new Error("Item sem código de produto");

  let product = await prisma.product.findFirst({
    where: {
      tenantId,
      OR: [
        { sku },
        ...(code ? [{ barcode: code }] : []),
        ...(item.barcode ? [{ barcode: item.barcode }] : []),
      ],
      active: true,
    },
  });
  if (!product) {
    product = await prisma.product.create({
      data: {
        tenantId,
        sku,
        name: item.description ?? sku,
        barcode: item.barcode ?? (code || null),
      },
    });
  }

  const qty = Math.min(
    params.quantity,
    Number(item.quantityExpected) - Number(item.quantityStored),
  );
  if (qty <= 0) throw new Error("Quantidade já armazenada");

  const storeStartedAt = new Date();

  await prisma.$transaction([
    prisma.putawayItem.update({
      where: { id: item.id },
      data: {
        quantityStored: { increment: qty },
        locationId: location.id,
      },
    }),
    prisma.location.update({
      where: { id: location.id },
      data: {
        currentQuantity: { increment: qty },
        productId: product.id,
      },
    }),
    prisma.inventoryMovement.create({
      data: {
        tenantId,
        type: InventoryMovementType.ENTRY,
        quantity: qty,
        userId: params.userId,
        productId: product.id,
        toLocationId: location.id,
        putawaySessionId: params.sessionId,
        purchaseReceiptSessionId: session.purchaseReceiptId,
        startedAt: storeStartedAt,
        completedAt: storeStartedAt,
        reference: session.purchaseReceiptId,
        notes: "Armazenagem pós-recebimento",
      },
    }),
    prisma.putawayTimeLog.create({
      data: {
        sessionId: params.sessionId,
        userId: params.userId,
        event: "STORE_ITEM",
      },
    }),
  ]);

  return getPutawaySession(params.sessionId);
}

export async function completePutaway(sessionId: string) {
  const data = await getPutawaySession(sessionId);
  if (!data.allStored) {
    throw new Error("Ainda há itens pendentes de armazenagem");
  }
  const completedAt = new Date();
  await prisma.putawaySession.update({
    where: { id: sessionId },
    data: {
      status: PutawaySessionStatus.COMPLETED,
      completedAt,
    },
  });
  const session = await prisma.putawaySession.findUnique({
    where: { id: sessionId },
    select: { assignedToId: true },
  });
  if (session?.assignedToId) {
    await prisma.putawayTimeLog.create({
      data: {
        sessionId,
        userId: session.assignedToId,
        event: "COMPLETE",
      },
    });
  }
  return getPutawaySession(sessionId);
}
