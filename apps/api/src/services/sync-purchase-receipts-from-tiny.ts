import {
  PurchaseReceiptKind,
  PurchaseReceiptSessionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getTinyApiClient, TinyApiError } from "./tiny-api-v3-client.js";
import { isTinyConnectedError } from "./tiny-purchase-receipt.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
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

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapInvoiceItems(nota: Record<string, unknown>) {
  const rawItems = Array.isArray(nota.itens)
    ? nota.itens
    : Array.isArray(nota.items)
      ? nota.items
      : [];

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

export type SyncPurchaseReceiptsResult = {
  created: number;
  skipped: number;
  tinyConnected: boolean;
  warning?: string;
};

export async function syncPurchaseReceiptsFromTiny(params: {
  tenantId: string;
  userId: string;
}): Promise<SyncPurchaseReceiptsResult> {
  let client;
  try {
    client = await getTinyApiClient(params.tenantId);
  } catch (e) {
    if (isTinyConnectedError(e) || e instanceof TinyApiError) {
      return {
        created: 0,
        skipped: 0,
        tinyConnected: false,
        warning:
          "Tiny ERP não conectado. Exibindo apenas notas já registradas no WMS.",
      };
    }
    throw e;
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const existing = await prisma.purchaseReceiptSession.findMany({
    where: { tenantId: params.tenantId, kind: PurchaseReceiptKind.ENTRY },
    select: {
      id: true,
      accessKey: true,
      tinyNotaId: true,
      status: true,
    },
  });

  const byAccessKey = new Map(
    existing
      .filter((s) => s.accessKey)
      .map((s) => [s.accessKey!, s]),
  );
  const byTinyId = new Map(
    existing
      .filter((s) => s.tinyNotaId != null)
      .map((s) => [s.tinyNotaId!, s]),
  );

  const limit = 100;
  let offset = 0;
  let total = Infinity;
  let created = 0;
  let skipped = 0;

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
      const notaId = num(row.id);
      if (!notaId) continue;

      const accessKey = str(row.chaveAcesso)?.replace(/\D/g, "") ?? null;
      const prev =
        (accessKey && byAccessKey.get(accessKey)) ||
        byTinyId.get(notaId);

      if (prev) {
        if (
          prev.status === PurchaseReceiptSessionStatus.COMPLETED ||
          prev.status === PurchaseReceiptSessionStatus.CANCELLED
        ) {
          skipped += 1;
          continue;
        }
        skipped += 1;
        continue;
      }

      const fullNota = await client.getInvoice(notaId);
      const items = mapInvoiceItems(fullNota);
      if (items.length === 0) {
        skipped += 1;
        continue;
      }

      const cliente = asRecord(fullNota.cliente);
      const session = await prisma.purchaseReceiptSession.create({
        data: {
          tenantId: params.tenantId,
          kind: PurchaseReceiptKind.ENTRY,
          tinyNotaId: notaId,
          accessKey,
          invoiceNumber: str(fullNota.numero) ?? str(row.numero),
          supplierName: str(cliente?.nome) ?? str(cliente?.fantasia),
          status: PurchaseReceiptSessionStatus.READY_TO_CHECK,
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

      if (accessKey) byAccessKey.set(accessKey, session);
      byTinyId.set(notaId, session);
      created += 1;
    }

    const pag = asRecord(page.pagination);
    total = num(pag?.total) || page.items.length;
    if (page.items.length < limit) break;
    offset += limit;
    if (offset > 5000) break;
  }

  return { created, skipped, tinyConnected: true };
}
