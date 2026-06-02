import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  detectMarketplaceFromTiny,
  enrichOrderPriority,
} from "./marketplace-priority.js";
import {
  extractTinyPriorityFromRecord,
  fetchTinyOrderPriority,
  normalizeTinyPriority,
} from "./tiny-order-priority.js";

export interface TinyLineItem {
  sku: string;
  quantity: number;
  description?: string;
}

export interface TinyOrderPayload {
  erpOrderId: string;
  customerName?: string;
  marketplace?: string | null;
  collectionDeadline?: Date | null;
  /** Prioridade bruta do Tiny (antes de normalizar para erpPriority). */
  tinyPriorityRaw?: number | null;
  items: TinyLineItem[];
}

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
  return String(v).trim() || undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Interpreta payloads comuns do webhook Tiny/Olist (notificação de vendas). */
export function parseTinyWebhookPayload(body: unknown): TinyOrderPayload | null {
  const root = asRecord(body);
  if (!root) return null;

  const dados = asRecord(root.dados) ?? asRecord(root.data) ?? root;
  const pedido =
    asRecord(dados.pedido) ??
    asRecord(dados.order) ??
    asRecord(dados.venda) ??
    dados;

  const erpOrderId =
    str(pedido.id) ??
    str(pedido.id_pedido) ??
    str(pedido.numero) ??
    str(pedido.numero_ecommerce) ??
    str(root.id);

  if (!erpOrderId) return null;

  let rawItems = asArray(pedido.itens);
  if (rawItems.length === 0) rawItems = asArray(pedido.items);
  if (rawItems.length === 0) rawItems = asArray(pedido.produtos);
  if (rawItems.length === 0) rawItems = asArray(dados.itens);

  const items: TinyLineItem[] = [];
  for (const raw of rawItems) {
    const row = asRecord(raw);
    if (!row) continue;
    const item = asRecord(row.item) ?? row;
    const sku =
      str(item.codigo) ??
      str(item.sku) ??
      str(item.codigo_produto) ??
      str(item.id_produto);
    const quantity = num(item.quantidade ?? item.qty ?? item.quantity) || 1;
    if (!sku) continue;
    items.push({
      sku,
      quantity: Math.max(1, Math.floor(quantity)),
      description: str(item.descricao) ?? str(item.nome),
    });
  }

  if (items.length === 0) {
    const sku = str(pedido.sku);
    if (sku) {
      items.push({ sku, quantity: num(pedido.quantidade) || 1 });
    }
  }

  if (items.length === 0) return null;

  const ecommerce =
    str(pedido.ecommerce) ??
    str(pedido.nome_ecommerce) ??
    str(pedido.loja) ??
    str(dados.ecommerce);
  const canalExtra = [
    str(pedido.tipo),
    str(pedido.naturezaOperacao),
    str(pedido.natureza_operacao),
    str(pedido.canalVenda),
    str(pedido.canal_venda),
  ]
    .filter(Boolean)
    .join(" ");

  const deadlineRaw =
    str(pedido.data_coleta) ??
    str(pedido.prazo_coleta) ??
    str(pedido.collection_deadline);
  let collectionDeadline: Date | null = null;
  if (deadlineRaw) {
    const d = new Date(deadlineRaw);
    if (!Number.isNaN(d.getTime())) collectionDeadline = d;
  }

  const tinyPriorityRaw = extractTinyPriorityFromRecord(dados);

  return {
    erpOrderId: `TINY-${erpOrderId}`,
    customerName:
      str(pedido.nome_cliente) ??
      str(pedido.cliente) ??
      str(pedido.nome),
    marketplace: detectMarketplaceFromTiny(
      ecommerce,
      str(pedido.loja),
      canalExtra || null,
    ),
    collectionDeadline,
    tinyPriorityRaw,
    items,
  };
}

async function resolveErpPriorityForPayload(
  tenantId: string,
  payload: TinyOrderPayload,
): Promise<number | null> {
  if (payload.tinyPriorityRaw !== null && payload.tinyPriorityRaw !== undefined) {
    return normalizeTinyPriority(payload.tinyPriorityRaw);
  }
  return fetchTinyOrderPriority(tenantId, payload.erpOrderId);
}

export async function upsertOrderFromTiny(
  tenantId: string,
  payload: TinyOrderPayload,
): Promise<{ orderId: string; created: boolean }> {
  const existing = await prisma.order.findFirst({
    where: { tenantId, erpOrderId: payload.erpOrderId },
    include: { items: true },
  });

  if (
    existing &&
    existing.status !== OrderStatus.PENDING &&
    existing.status !== OrderStatus.PAUSED_ISSUE
  ) {
    return { orderId: existing.id, created: false };
  }

  const productIds: { lineNumber: number; productId: string; qty: number }[] =
    [];
  let lineNum = 0;
  for (const item of payload.items) {
    const product = await prisma.product.findFirst({
      where: { tenantId, sku: item.sku, active: true },
    });
    if (!product) continue;
    lineNum += 1;
    productIds.push({
      lineNumber: lineNum,
      productId: product.id,
      qty: item.quantity,
    });
  }

  if (productIds.length === 0) {
    throw new Error(
      `Nenhum SKU do pedido ${payload.erpOrderId} encontrado no cadastro`,
    );
  }

  const erpPriority = await resolveErpPriorityForPayload(tenantId, payload);

  if (existing) {
    await prisma.orderItem.deleteMany({ where: { orderId: existing.id } });
    await prisma.order.update({
      where: { id: existing.id },
      data: {
        customerName: payload.customerName ?? existing.customerName,
        marketplace: payload.marketplace ?? existing.marketplace,
        collectionDeadline:
          payload.collectionDeadline ?? existing.collectionDeadline,
        erpSource: "TINY",
        ...(erpPriority !== null ? { erpPriority } : {}),
        items: {
          create: productIds.map((p) => ({
            lineNumber: p.lineNumber,
            productId: p.productId,
            quantityOrdered: p.qty,
          })),
        },
      },
    });
    await enrichOrderPriority(existing.id);
    return { orderId: existing.id, created: false };
  }

  const order = await prisma.order.create({
    data: {
      tenantId,
      erpOrderId: payload.erpOrderId,
      customerName: payload.customerName,
      marketplace: payload.marketplace,
      collectionDeadline: payload.collectionDeadline,
      erpSource: "TINY",
      status: OrderStatus.PENDING,
      ...(erpPriority !== null ? { erpPriority } : {}),
      items: {
        create: productIds.map((p) => ({
          lineNumber: p.lineNumber,
          productId: p.productId,
          quantityOrdered: p.qty,
        })),
      },
    },
  });

  await enrichOrderPriority(order.id);
  return { orderId: order.id, created: true };
}

/** Reaplica prioridade Tiny + WMS em pedidos PENDING do tenant. */
export async function syncPendingOrderPrioritiesFromTiny(
  tenantId: string,
): Promise<{ updated: number; skipped: number }> {
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: OrderStatus.PENDING,
      erpSource: "TINY",
    },
    select: { id: true, erpOrderId: true },
    take: 200,
  });

  let updated = 0;
  let skipped = 0;

  for (const o of orders) {
    const erpPriority = await fetchTinyOrderPriority(tenantId, o.erpOrderId);
    if (erpPriority === null) {
      skipped += 1;
      continue;
    }
    await prisma.order.update({
      where: { id: o.id },
      data: { erpPriority },
    });
    await enrichOrderPriority(o.id);
    updated += 1;
  }

  return { updated, skipped };
}

export async function logIntegrationEvent(params: {
  tenantId: string;
  source: string;
  eventType: string;
  externalId?: string;
  status: string;
  message?: string;
  payload?: unknown;
}) {
  await prisma.integrationEventLog.create({
    data: {
      tenantId: params.tenantId,
      source: params.source,
      eventType: params.eventType,
      externalId: params.externalId,
      status: params.status,
      message: params.message,
      payload: params.payload as object | undefined,
    },
  });
}

export async function getTinyWebhookSecret(tenantId: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { tenantId_key: { tenantId, key: "tiny.webhook.secret" } },
  });
  return row?.value?.trim() || null;
}
