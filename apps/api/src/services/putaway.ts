import {
  InventoryMovementType,
  LocationType,
  Prisma,
  PutawaySessionStatus,
  PurchaseReceiptSessionStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findNfItemByScannedCode } from "./location-stock.js";
import { formatRouteLabel } from "./packing-queue-sort.js";
import { setPulmaoSkuPercent } from "./pulmao-inventory.js";
import { parsePercent } from "./stock-percent.js";
import {
  getRouteEngine,
  LegacyRouteEngine,
  pickNextItemByEngine,
  sortPendingItemsByEngine,
} from "./route-engine/index.js";
import {
  OPEN_SHARE_STATUSES,
  assertItemShareStarted,
  finishShareIfDone,
  getWorkForRef,
  hasShares,
} from "./work-share.js";

const putawayLocationSelect = {
  id: true,
  barcode: true,
  corridor: true,
  row: true,
  estanteId: true,
  face: true,
} satisfies Prisma.LocationSelect;

export const putawayItemInclude = {
  location: { select: putawayLocationSelect },
  movements: {
    where: { type: InventoryMovementType.ENTRY },
    orderBy: { createdAt: "asc" },
    select: { quantity: true, toLocation: { select: putawayLocationSelect } },
  },
} satisfies Prisma.PutawayItemInclude;

type PutawayLocation = Prisma.LocationGetPayload<{ select: typeof putawayLocationSelect }>;

export type PutawayStoredLocation = {
  locationId: string;
  barcode: string;
  label: string;
  quantity: number;
};

/** Pulmões onde o item foi guardado (na ordem da primeira guarda), somando as guardas no mesmo pulmão. */
export function summarizeStoredLocations(
  movements: Array<{ quantity: number; toLocation: PutawayLocation | null }>,
): PutawayStoredLocation[] {
  const byLocation = new Map<string, PutawayStoredLocation>();
  for (const m of movements) {
    if (!m.toLocation) continue;
    const current = byLocation.get(m.toLocation.id);
    if (current) {
      current.quantity += m.quantity;
    } else {
      byLocation.set(m.toLocation.id, {
        locationId: m.toLocation.id,
        barcode: m.toLocation.barcode,
        label: formatRouteLabel(m.toLocation),
        quantity: m.quantity,
      });
    }
  }
  return [...byLocation.values()];
}

/** Pulmões do item; guardas de antes do vínculo com o item só registraram o último pulmão. */
export function storedLocationsOf(
  item: Prisma.PutawayItemGetPayload<{ include: typeof putawayItemInclude }>,
): PutawayStoredLocation[] {
  const stored = summarizeStoredLocations(item.movements);
  if (stored.length === 0 && item.location && Number(item.quantityStored) > 0) {
    stored.push({
      locationId: item.location.id,
      barcode: item.location.barcode,
      label: formatRouteLabel(item.location),
      quantity: Number(item.quantityStored),
    });
  }
  return stored;
}

export async function listPutawayQueue(tenantId?: string, userId?: string) {
  const sessions = await prisma.purchaseReceiptSession.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      status: PurchaseReceiptSessionStatus.COMPLETED,
      OR: [
        { putaway: null },
        { putaway: { status: PutawaySessionStatus.PENDING } },
        ...(userId
          ? [
              {
                putaway: {
                  status: PutawaySessionStatus.IN_PROGRESS,
                  workShares: {
                    some: { assignedToId: userId, status: { in: OPEN_SHARE_STATUSES } },
                  },
                },
              },
            ]
          : []),
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

export async function ensurePutawaySession(purchaseReceiptId: string, userId: string) {
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
        items: { include: putawayItemInclude },
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
      items: { include: putawayItemInclude },
      purchaseReceipt: { include: { items: true } },
    },
  });
  await prisma.putawayTimeLog.create({
    data: { sessionId: session.id, userId, event: "START" },
  });
  return session;
}

async function resolveProductImageUrl(
  tenantId: string,
  productCode: string,
  barcode: string | null,
) {
  const product = await prisma.product.findFirst({
    where: {
      tenantId,
      OR: [
        { sku: productCode },
        ...(barcode ? [{ barcode }] : []),
      ],
    },
    select: { imageUrl: true },
  });
  return product?.imageUrl ?? null;
}

async function formatPutaway(
  session: NonNullable<Awaited<ReturnType<typeof ensurePutawaySession>>>,
  viewerId?: string,
) {
  const work = viewerId
    ? await getWorkForRef({ kind: "PUTAWAY", putawaySessionId: session.id }, viewerId)
    : null;
  const myShareIds = new Set(
    (work?.shares ?? []).filter((s) => s.assignedTo.id === viewerId).map((s) => s.id),
  );
  const isMine = (it: (typeof session.items)[0]) =>
    !work || work.shares.length === 0 || (!!it.workShareId && myShareIds.has(it.workShareId));
  const isPending = (it: (typeof session.items)[0]) =>
    isMine(it) && Number(it.quantityStored) < Number(it.quantityExpected);

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

  const tenantId = session.purchaseReceipt?.tenantId;
  const engine = tenantId ? await getRouteEngine(tenantId) : new LegacyRouteEngine();

  // A carga sai conferida da área de recebimento; sem item guardado ainda, a rota parte de lá.
  const next =
    pickNextItemByEngine(engine, pendingWithLoc, isPending, lastStoredLoc, "RECEIVING") ??
    session.items.find(isPending);


  const routeQueue = sortPendingItemsByEngine(
    engine,
    pendingWithLoc,
    isPending,
    lastStoredLoc,
    "RECEIVING",
  );

  let nextImageUrl: string | null = null;
  if (next && tenantId && next.productCode) {
    nextImageUrl = await resolveProductImageUrl(
      tenantId,
      next.productCode,
      next.barcode,
    );
  }

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
      storedLocations: storedLocationsOf(it),
      completed: Number(it.quantityStored) >= Number(it.quantityExpected),
      workShareId: it.workShareId,
    })),
    nextItem: next
      ? {
          id: next.id,
          productCode: next.productCode,
          description: next.description,
          barcode: next.barcode,
          imageUrl: nextImageUrl,
          remaining:
            Number(next.quantityExpected) - Number(next.quantityStored),
        }
      : null,
    allStored: session.items.every(
      (it) => Number(it.quantityStored) >= Number(it.quantityExpected),
    ),
    /** Itens da minha parte guardados (sem divisão: a NF toda) */
    myAllStored: !session.items.some(isPending),
    work,
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
  return await formatPutaway(session, userId);
}

export async function getPutawaySession(sessionId: string, viewerId?: string) {
  const session = await prisma.putawaySession.findUnique({
    where: { id: sessionId },
    include: {
      items: { include: putawayItemInclude },
      purchaseReceipt: { include: { items: true } },
    },
  });
  if (!session) throw new Error("Sessão não encontrada");
  return await formatPutaway(session, viewerId);
}

export async function storePutawayItem(params: {
  sessionId: string;
  itemId: string;
  locationBarcode: string;
  productBarcode?: string;
  quantity: number;
  /** % que o SKU ocupa no pulmão depois de guardar */
  pulmaoPercent: unknown;
  userId: string;
}) {
  const pulmaoPercent = parsePercent(params.pulmaoPercent, "% do SKU no pulmão");
  if (pulmaoPercent <= 0) throw new Error("Informe quanto o SKU ocupa no pulmão (mínimo 1%)");

  const session = await prisma.putawaySession.findUnique({
    where: { id: params.sessionId },
    include: {
      purchaseReceipt: { select: { tenantId: true } },
      items: true,
    },
  });
  if (!session) throw new Error("Sessão não encontrada");
  if (session.status === PutawaySessionStatus.COMPLETED) {
    throw new Error("Armazenagem já finalizada");
  }
  const tenantId = session.purchaseReceipt.tenantId;

  const location = await prisma.location.findFirst({
    where: {
      tenantId,
      barcode: { equals: params.locationBarcode.trim(), mode: "insensitive" },
      type: LocationType.PULMAO,
      active: true,
    },
  });
  if (!location) throw new Error("Local de pulmão não encontrado");

  const item = session.items.find((i) => i.id === params.itemId);
  if (!item) throw new Error("Item não encontrado");
  const shareId = await assertItemShareStarted(item.workShareId, params.userId);

  const code = params.productBarcode?.trim() ?? "";
  if (
    code &&
    item.barcode &&
    item.productCode &&
    !(await findNfItemByScannedCode(tenantId, [item], code))
  ) {
    throw new Error("Produto não confere com o item da NF");
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

  const productId = product.id;
  await prisma.$transaction(async (tx) => {
    await tx.putawayItem.update({
      where: { id: item.id },
      data: {
        quantityStored: { increment: qty },
        locationId: location.id,
      },
    });
    const { previous } = await setPulmaoSkuPercent(
      tx,
      { tenantId, locationId: location.id, productId },
      pulmaoPercent,
    );
    await tx.inventoryMovement.create({
      data: {
        tenantId,
        type: InventoryMovementType.ENTRY,
        quantity: qty,
        percentBefore: previous,
        percentAfter: pulmaoPercent,
        userId: params.userId,
        productId,
        toLocationId: location.id,
        putawaySessionId: params.sessionId,
        putawayItemId: item.id,
        purchaseReceiptSessionId: session.purchaseReceiptId,
        startedAt: storeStartedAt,
        completedAt: storeStartedAt,
        reference: session.purchaseReceiptId,
        notes: "Armazenagem pós-recebimento",
      },
    });
    await tx.putawayTimeLog.create({
      data: {
        sessionId: params.sessionId,
        userId: params.userId,
        event: "STORE_ITEM",
      },
    });
  });

  if (shareId && (await finishShareIfDone(shareId))) {
    await completePutawayWhenAllSharesDone(params.sessionId);
  }

  return getPutawaySession(params.sessionId, params.userId);
}

/** Armazenagem dividida: quem termina a última parte fecha a armazenagem. */
async function completePutawayWhenAllSharesDone(sessionId: string) {
  if (!(await hasShares({ putawaySessionId: sessionId }))) return;
  const session = await prisma.putawaySession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session || session.status === PutawaySessionStatus.COMPLETED) return;
  if (session.items.every((it) => Number(it.quantityStored) >= Number(it.quantityExpected))) {
    await completePutaway(sessionId);
  }
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
