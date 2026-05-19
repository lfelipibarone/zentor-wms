import {
  PurchaseReceiptSessionStatus,
  PutawaySessionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getTinyApiClient, TinyApiError } from "./tiny-api-v3-client.js";
import { logIntegrationEvent } from "./tiny-integration.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Extrai chave de acesso NF-e (44 dígitos) do código de barras do DANFE. */
async function logReceiptEvent(
  sessionId: string,
  userId: string,
  event: string,
) {
  await prisma.purchaseReceiptTimeLog.create({
    data: { sessionId, userId, event },
  });
}

export async function markConferenceStarted(sessionId: string, userId: string) {
  const session = await prisma.purchaseReceiptSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new Error("Sessão não encontrada");
  if (!session.conferenceStartedAt) {
    await prisma.purchaseReceiptSession.update({
      where: { id: sessionId },
      data: { conferenceStartedAt: new Date() },
    });
    await logReceiptEvent(sessionId, userId, "CONFERENCE_START");
  }
}

export function parseNfeAccessKeyFromBarcode(barcode: string): string | null {
  const digits = barcode.replace(/\D/g, "");
  if (digits.length === 44) return digits;
  const match = digits.match(/\d{44}/);
  return match ? match[0] : null;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function findEntryInvoiceByAccessKey(
  tenantId: string,
  accessKey: string,
) {
  const client = await getTinyApiClient(tenantId);
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 120);

  const limit = 100;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await client.listEntryInvoices({
      dataInicial: formatDate(start),
      dataFinal: formatDate(end),
      limit,
      offset,
    });

    for (const raw of page.items) {
      const row = asRecord(raw);
      if (!row) continue;
      const key = str(row.chaveAcesso)?.replace(/\D/g, "");
      if (key === accessKey) {
        return row;
      }
    }

    const pag = asRecord(page.pagination);
    total = num(pag?.total) || page.items.length;
    if (page.items.length < limit) break;
    offset += limit;
    if (offset > 5000) break;
  }

  return null;
}

function mapInvoiceItems(nota: Record<string, unknown>) {
  const rawItems =
    asArray(nota.itens) ||
    asArray(nota.items) ||
    asArray(asRecord(nota.data)?.itens);

  const items: Array<{
    lineNumber: number;
    tinyItemId?: string;
    productCode?: string;
    description?: string;
    barcode?: string;
    quantityExpected: number;
  }> = [];

  let line = 0;
  for (const raw of rawItems) {
    const row = asRecord(raw) ?? asRecord(asRecord(raw)?.item);
    if (!row) continue;
    line += 1;
    const prod = asRecord(row.produto) ?? asRecord(row.product);
    const qty = num(row.quantidade ?? row.qty ?? row.quantity) || 0;
    if (qty <= 0) continue;

    items.push({
      lineNumber: line,
      tinyItemId: str(row.id ?? row.idItem),
      productCode:
        str(prod?.codigo) ?? str(row.codigo) ?? str(prod?.sku),
      description: str(row.descricao) ?? str(prod?.nome) ?? str(row.nome),
      barcode:
        str(prod?.gtin) ??
        str(row.gtin) ??
        str(prod?.codigoBarras) ??
        str(row.codigoBarras),
      quantityExpected: qty,
    });
  }

  return items;
}

export async function listPurchaseReceiptQueue(tenantId: string) {
  const client = await getTinyApiClient(tenantId);
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const activeSessions = await prisma.purchaseReceiptSession.findMany({
    where: {
      tenantId,
      status: {
        in: [
          PurchaseReceiptSessionStatus.WAITING_ENTRY,
          PurchaseReceiptSessionStatus.READY_TO_CHECK,
          PurchaseReceiptSessionStatus.IN_CHECK,
        ],
      },
    },
    select: { accessKey: true, tinyNotaId: true },
  });
  const busyKeys = new Set(activeSessions.map((s) => s.accessKey));

  const page = await client.listEntryInvoices({
    dataInicial: formatDate(start),
    dataFinal: formatDate(end),
    limit: 100,
    offset: 0,
  });

  const queue: Array<{
    tinyNotaId: number;
    accessKey: string | null;
    invoiceNumber: string | null;
    supplierName: string | null;
    issueDate: string | null;
    value: number | null;
  }> = [];

  for (const raw of page.items) {
    const row = asRecord(raw);
    if (!row) continue;
    const id = num(row.id);
    if (!id) continue;
    const accessKey = str(row.chaveAcesso)?.replace(/\D/g, "") ?? null;
    if (accessKey && busyKeys.has(accessKey)) continue;

    const cliente = asRecord(row.cliente);
    queue.push({
      tinyNotaId: id,
      accessKey,
      invoiceNumber: str(row.numero) ?? null,
      supplierName: str(cliente?.nome) ?? str(cliente?.fantasia) ?? null,
      issueDate: str(row.dataEmissao) ?? null,
      value: row.valor != null ? num(row.valor) : null,
    });
  }

  return queue;
}

export async function startPurchaseReceiptByBarcode(params: {
  tenantId: string;
  barcode: string;
  userId: string;
}) {
  const accessKey = parseNfeAccessKeyFromBarcode(params.barcode);
  if (!accessKey) {
    throw new Error(
      "Código DANFE inválido. Bipe o código de barras da chave de acesso (44 dígitos).",
    );
  }

  const existing = await prisma.purchaseReceiptSession.findFirst({
    where: { tenantId: params.tenantId, accessKey },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });

  if (
    existing &&
    existing.status !== PurchaseReceiptSessionStatus.COMPLETED &&
    existing.status !== PurchaseReceiptSessionStatus.CANCELLED
  ) {
    if (
      existing.status === PurchaseReceiptSessionStatus.READY_TO_CHECK ||
      existing.status === PurchaseReceiptSessionStatus.WAITING_ENTRY
    ) {
      await prisma.purchaseReceiptSession.update({
        where: { id: existing.id },
        data: { status: PurchaseReceiptSessionStatus.IN_CHECK },
      });
    }
    return formatSession(existing.id);
  }

  let listRow = await findEntryInvoiceByAccessKey(params.tenantId, accessKey);
  const client = await getTinyApiClient(params.tenantId);

  if (!listRow) {
    throw new Error(
      "Nota de entrada não encontrada no Tiny para esta chave. Verifique se a NF está importada e enviada para conferência de compra.",
    );
  }

  const notaId = num(listRow.id);
  const fullNota = await client.getInvoice(notaId);
  const items = mapInvoiceItems(fullNota);
  if (items.length === 0) {
    throw new Error("Nota sem itens retornados pela API Tiny.");
  }

  const sync = await client.tryMarkReadyForConference(notaId);

  const cliente = asRecord(fullNota.cliente);
  const session = await prisma.purchaseReceiptSession.create({
    data: {
      tenantId: params.tenantId,
      tinyNotaId: notaId,
      accessKey,
      invoiceNumber: str(fullNota.numero) ?? str(listRow.numero),
      supplierName: str(cliente?.nome) ?? str(cliente?.fantasia),
      status: PurchaseReceiptSessionStatus.IN_CHECK,
      tinySyncStatus: sync.ok ? "OK" : "SKIPPED",
      tinySyncMessage: sync.ok
        ? `Tiny: ${sync.endpoint}`
        : sync.message ?? "Sem endpoint público de conferência",
      startedById: params.userId,
      items: {
        create: items.map((it) => ({
          lineNumber: it.lineNumber,
          tinyItemId: it.tinyItemId,
          productCode: it.productCode,
          description: it.description,
          barcode: it.barcode,
          quantityExpected: new Prisma.Decimal(it.quantityExpected),
        })),
      },
    },
  });

  await logReceiptEvent(session.id, params.userId, "RECEIPT_START");

  await logIntegrationEvent({
    tenantId: params.tenantId,
    source: "TINY",
    eventType: "purchase_receipt.start",
    externalId: accessKey,
    status: sync.ok ? "OK" : "PARTIAL",
    message: sync.message,
    payload: { notaId, sessionId: session.id },
  });

  return formatSession(session.id);
}

async function formatSession(sessionId: string) {
  const session = await prisma.purchaseReceiptSession.findUnique({
    where: { id: sessionId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  if (!session) throw new Error("Sessão não encontrada");

  const next = session.items.find(
    (it) => Number(it.quantityChecked) < Number(it.quantityExpected),
  );

  return {
    session: {
      id: session.id,
      tinyNotaId: session.tinyNotaId,
      accessKey: session.accessKey,
      invoiceNumber: session.invoiceNumber,
      supplierName: session.supplierName,
      status: session.status,
      tinySyncStatus: session.tinySyncStatus,
      tinySyncMessage: session.tinySyncMessage,
      startedAt: session.startedAt.toISOString(),
      conferenceStartedAt: session.conferenceStartedAt?.toISOString() ?? null,
      conferenceEndedAt: session.conferenceEndedAt?.toISOString() ?? null,
    },
    items: session.items.map((it) => ({
      id: it.id,
      lineNumber: it.lineNumber,
      productCode: it.productCode,
      description: it.description,
      barcode: it.barcode,
      quantityExpected: Number(it.quantityExpected),
      quantityChecked: Number(it.quantityChecked),
      completed: Number(it.quantityChecked) >= Number(it.quantityExpected),
    })),
    nextItem: next
      ? {
          id: next.id,
          lineNumber: next.lineNumber,
          productCode: next.productCode,
          description: next.description,
          barcode: next.barcode,
          quantityExpected: Number(next.quantityExpected),
          quantityChecked: Number(next.quantityChecked),
          remaining:
            Number(next.quantityExpected) - Number(next.quantityChecked),
        }
      : null,
    allChecked: session.items.every(
      (it) => Number(it.quantityChecked) >= Number(it.quantityExpected),
    ),
  };
}

export async function getPurchaseReceiptSession(sessionId: string) {
  return formatSession(sessionId);
}

export async function confirmReceiptItem(
  sessionId: string,
  itemId: string,
  quantity: number,
) {
  const session = await prisma.purchaseReceiptSession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session) throw new Error("Sessão não encontrada");
  if (session.status === PurchaseReceiptSessionStatus.COMPLETED) {
    throw new Error("Conferência já finalizada");
  }

  const item = session.items.find((it) => it.id === itemId);
  if (!item) throw new Error("Item não pertence a esta nota");

  const addQty = Math.max(1, Math.floor(quantity));
  const newChecked = Math.min(
    Number(item.quantityExpected),
    Number(item.quantityChecked) + addQty,
  );

  await prisma.purchaseReceiptItem.update({
    where: { id: item.id },
    data: { quantityChecked: new Prisma.Decimal(newChecked) },
  });

  return getPurchaseReceiptSession(sessionId);
}

export async function scanPurchaseReceiptItem(params: {
  sessionId: string;
  barcode: string;
  quantity?: number;
}) {
  const session = await prisma.purchaseReceiptSession.findUnique({
    where: { id: params.sessionId },
    include: { items: true },
  });
  if (!session) throw new Error("Sessão não encontrada");
  if (session.status === PurchaseReceiptSessionStatus.COMPLETED) {
    throw new Error("Conferência já finalizada");
  }

  const code = params.barcode.trim();
  const item = session.items.find(
    (it) =>
      (it.barcode && it.barcode === code) ||
      (it.productCode && it.productCode === code),
  );

  if (!item) {
    throw new Error("Produto não pertence a esta nota");
  }

  return confirmReceiptItem(
    params.sessionId,
    item.id,
    params.quantity ?? 1,
  );
}

export async function completePurchaseReceipt(sessionId: string, userId: string) {
  const data = await getPurchaseReceiptSession(sessionId);
  if (!data.allChecked) {
    throw new Error("Ainda há itens pendentes de conferência");
  }

  const receipt = await prisma.purchaseReceiptSession.findUnique({
    where: { id: sessionId },
    include: { items: true, putaway: true },
  });
  if (!receipt) throw new Error("Sessão não encontrada");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.purchaseReceiptSession.update({
      where: { id: sessionId },
      data: {
        status: PurchaseReceiptSessionStatus.COMPLETED,
        conferenceEndedAt: now,
        completedAt: now,
        conferenceStartedAt: receipt.conferenceStartedAt ?? now,
      },
    });

    if (!receipt.putaway) {
      await tx.putawaySession.create({
        data: {
          purchaseReceiptId: sessionId,
          status: PutawaySessionStatus.PENDING,
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
      });
    }
  });

  await logReceiptEvent(sessionId, userId, "CONFERENCE_END");

  return getPurchaseReceiptSession(sessionId);
}

export function isTinyConnectedError(e: unknown): boolean {
  return e instanceof TinyApiError && (e.code === "NOT_CONNECTED" || e.statusCode === 503);
}
