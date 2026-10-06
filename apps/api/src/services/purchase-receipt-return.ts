import {
  InventoryMovementType,
  LocationType,
  Prisma,
  PurchaseReceiptKind,
  PurchaseReceiptSessionStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode } from "./location-stock.js";
import { setPulmaoSkuPercent } from "./pulmao-inventory.js";
import { parsePercent } from "./stock-percent.js";

export async function startReturnReceiptSession(params: {
  tenantId: string;
  userId: string;
  reference?: string;
}) {
  const session = await prisma.purchaseReceiptSession.create({
    data: {
      tenantId: params.tenantId,
      kind: PurchaseReceiptKind.RETURN,
      status: PurchaseReceiptSessionStatus.IN_CHECK,
      startedById: params.userId,
      reference: params.reference?.trim() || null,
      conferenceStartedAt: new Date(),
    },
    include: { items: true },
  });

  return formatReturnSession(session.id);
}

async function formatReturnSession(sessionId: string) {
  const session = await prisma.purchaseReceiptSession.findUnique({
    where: { id: sessionId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  if (!session || session.kind !== PurchaseReceiptKind.RETURN) {
    throw new Error("Sessão de devolução não encontrada");
  }

  const totalLines = session.items.reduce(
    (s, it) => s + Number(it.quantityChecked),
    0,
  );

  return {
    session: {
      id: session.id,
      kind: session.kind,
      reference: session.reference,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      conferenceStartedAt: session.conferenceStartedAt?.toISOString() ?? null,
    },
    items: session.items.map((it) => ({
      id: it.id,
      lineNumber: it.lineNumber,
      productCode: it.productCode,
      description: it.description,
      barcode: it.barcode,
      quantityExpected: Number(it.quantityExpected),
      quantityChecked: Number(it.quantityChecked),
    })),
    totalUnits: totalLines,
    hasItems: session.items.length > 0,
  };
}

export async function getReturnReceiptSession(sessionId: string) {
  return formatReturnSession(sessionId);
}

export async function scanReturnReceiptProduct(params: {
  sessionId: string;
  barcode: string;
  quantity?: number;
}) {
  const session = await prisma.purchaseReceiptSession.findUnique({
    where: { id: params.sessionId },
    include: { items: true },
  });
  if (!session || session.kind !== PurchaseReceiptKind.RETURN) {
    throw new Error("Sessão de devolução não encontrada");
  }
  if (session.status === PurchaseReceiptSessionStatus.COMPLETED) {
    throw new Error("Devolução já finalizada");
  }

  const product = await findProductByBarcode(session.tenantId, params.barcode);
  if (!product) {
    throw new Error("Produto não cadastrado");
  }

  const qty = Math.max(1, Math.floor(params.quantity ?? 1));
  const code = product.barcode ?? product.sku;

  let item = session.items.find(
    (it) => it.productCode === product.sku || it.barcode === code,
  );

  if (item) {
    const newQty =
      Number(item.quantityChecked) + qty;
    await prisma.purchaseReceiptItem.update({
      where: { id: item.id },
      data: {
        quantityChecked: new Prisma.Decimal(newQty),
        quantityExpected: new Prisma.Decimal(newQty),
      },
    });
  } else {
    const lineNumber =
      session.items.reduce((m, it) => Math.max(m, it.lineNumber), 0) + 1;
    await prisma.purchaseReceiptItem.create({
      data: {
        sessionId: session.id,
        lineNumber,
        productCode: product.sku,
        description: product.name,
        barcode: product.barcode,
        quantityExpected: new Prisma.Decimal(qty),
        quantityChecked: new Prisma.Decimal(qty),
      },
    });
  }

  return formatReturnSession(params.sessionId);
}

export async function completeReturnReceipt(params: {
  sessionId: string;
  userId: string;
  pulmaoLocationBarcode: string;
  /** % que cada item (id do item da devolução) passa a ocupar no pulmão */
  percents: Array<{ itemId: string; percent: unknown }>;
}) {
  const session = await prisma.purchaseReceiptSession.findUnique({
    where: { id: params.sessionId },
    include: { items: true },
  });
  if (!session || session.kind !== PurchaseReceiptKind.RETURN) {
    throw new Error("Sessão de devolução não encontrada");
  }
  if (session.items.length === 0) {
    throw new Error("Bipe ao menos um produto antes de finalizar");
  }

  const percentByItem = new Map<string, number>();
  for (const it of session.items) {
    if (Math.floor(Number(it.quantityChecked)) <= 0) continue;
    const informed = params.percents?.find((p) => p.itemId === it.id);
    const percent = parsePercent(informed?.percent, `% de ${it.productCode ?? "item"} no pulmão`);
    if (percent <= 0) {
      throw new Error(`Informe quanto ${it.productCode ?? "o item"} ocupa no pulmão (mínimo 1%)`);
    }
    percentByItem.set(it.id, percent);
  }

  const loc = await prisma.location.findFirst({
    where: {
      tenantId: session.tenantId,
      barcode: params.pulmaoLocationBarcode.trim().toUpperCase(),
      type: LocationType.PULMAO,
      active: true,
    },
  });
  if (!loc) {
    throw new Error("Local de pulmão não encontrado");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const it of session.items) {
      const qty = Math.floor(Number(it.quantityChecked));
      if (qty <= 0) continue;

      const product = await tx.product.findFirst({
        where: {
          tenantId: session.tenantId,
          OR: [
            { sku: it.productCode ?? "" },
            ...(it.barcode ? [{ barcode: it.barcode }] : []),
          ],
        },
      });
      if (!product) continue;

      const percent = percentByItem.get(it.id)!;
      const { previous } = await setPulmaoSkuPercent(
        tx,
        { tenantId: session.tenantId, locationId: loc.id, productId: product.id },
        percent,
      );

      await tx.inventoryMovement.create({
        data: {
          tenantId: session.tenantId,
          type: InventoryMovementType.ENTRY,
          quantity: qty,
          percentBefore: previous,
          percentAfter: percent,
          userId: params.userId,
          productId: product.id,
          toLocationId: loc.id,
          purchaseReceiptSessionId: session.id,
          reference: session.reference,
          notes: "Devolução de cliente",
          completedAt: now,
        },
      });
    }

    await tx.purchaseReceiptSession.update({
      where: { id: session.id },
      data: {
        status: PurchaseReceiptSessionStatus.COMPLETED,
        conferenceEndedAt: now,
        completedAt: now,
      },
    });
  });

  return formatReturnSession(session.id);
}
