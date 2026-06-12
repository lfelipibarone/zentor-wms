import { LocationType, OrderStatus } from "@prisma/client";
import { Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import {
  detectMarketplaceFromTiny,
  enrichOrderPriority,
} from "./marketplace-priority.js";
import { notifyUsersWithPermission } from "./notifications.js";
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

/** Situações Tiny elegíveis para ingestão no WMS (API v3). */
export const TINY_ORDER_SITUACOES_SYNC = new Set([0, 1, 3, 4, 7]);

/** Situação cancelada no Tiny. */
export const TINY_ORDER_SITUACAO_CANCELADA = 2;

const DEMO_ERP_PREFIXES = ["ERP-DEMO-", "ERP-MOB-"] as const;

export function isDemoErpOrderId(erpOrderId: string): boolean {
  if (erpOrderId === "ERP-10042") return true;
  return DEMO_ERP_PREFIXES.some((p) => erpOrderId.startsWith(p));
}

export function parseTinyPedidoSituacao(pedido: Record<string, unknown>): number | null {
  if (pedido.situacao === null || pedido.situacao === undefined) {
    return null;
  }
  const n = num(pedido.situacao);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function isTinyOrderSituacaoSyncable(situacao: number | null): boolean {
  if (situacao === null) return false;
  return TINY_ORDER_SITUACOES_SYNC.has(situacao);
}

function parseDateField(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Mapeia resposta GET /pedidos/{id} (API v3) para payload de upsert. */
export function parseTinyApiPedido(
  pedido: Record<string, unknown>,
): TinyOrderPayload | null {
  const id = num(pedido.id);
  if (!id) return null;

  const situacao = parseTinyPedidoSituacao(pedido);
  if (!isTinyOrderSituacaoSyncable(situacao)) return null;

  const rawItems = asArray(pedido.itens);
  const items: TinyLineItem[] = [];
  for (const raw of rawItems) {
    const row = asRecord(raw);
    if (!row) continue;
    const prod = asRecord(row.produto);
    const sku = str(prod?.sku) ?? str(row.sku) ?? str(row.codigo);
    const quantity = num(row.quantidade) || 1;
    if (!sku) continue;
    items.push({
      sku,
      quantity: Math.max(1, Math.floor(quantity)),
      description: str(prod?.descricao) ?? str(row.descricao),
    });
  }

  if (items.length === 0) return null;

  const cliente = asRecord(pedido.cliente);
  const ecommerce = asRecord(pedido.ecommerce);
  const natureza = asRecord(pedido.naturezaOperacao);

  const collectionDeadline =
    parseDateField(str(pedido.dataPrevista)) ??
    parseDateField(str(pedido.dataEntrega));

  return {
    erpOrderId: `TINY-${id}`,
    customerName: str(cliente?.nome) ?? str(cliente?.fantasia),
    marketplace: detectMarketplaceFromTiny(
      str(ecommerce?.nome),
      str(ecommerce?.canalVenda),
      str(natureza?.nome) ?? null,
    ),
    collectionDeadline,
    tinyPriorityRaw: extractTinyPriorityFromRecord(pedido),
    items,
  };
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

type ResolvedOrderLine = {
  lineNumber: number;
  productId?: string;
  erpSku?: string;
  erpDescription?: string;
  qty: number;
};

type ResolvedOrderLines = {
  lines: ResolvedOrderLine[];
  missingProducts: string[];
  missingLocations: string[];
};

async function resolveOrderLinesFromTiny(
  tenantId: string,
  items: TinyLineItem[],
): Promise<ResolvedOrderLines> {
  const lines: ResolvedOrderLine[] = [];
  const missingProducts: string[] = [];
  const missingLocations: string[] = [];
  let lineNum = 0;

  for (const item of items) {
    lineNum += 1;
    const sku = item.sku.trim();
    const product = await prisma.product.findFirst({
      where: {
        tenantId,
        active: true,
        sku: { equals: sku, mode: "insensitive" },
      },
    });

    if (!product) {
      missingProducts.push(sku);
      lines.push({
        lineNumber: lineNum,
        erpSku: sku,
        erpDescription: item.description,
        qty: item.quantity,
      });
      continue;
    }

    const pickFaceCount = await prisma.location.count({
      where: {
        tenantId,
        productId: product.id,
        type: LocationType.PICK_FACE,
        active: true,
      },
    });
    if (pickFaceCount === 0) {
      missingLocations.push(product.sku);
    }

    lines.push({
      lineNumber: lineNum,
      productId: product.id,
      qty: item.quantity,
    });
  }

  return { lines, missingProducts, missingLocations };
}

function mapLinesToCreateInput(lines: ResolvedOrderLine[]) {
  return lines.map((line) => ({
    lineNumber: line.lineNumber,
    quantityOrdered: line.qty,
    ...(line.productId
      ? { productId: line.productId }
      : {
          erpSku: line.erpSku,
          erpDescription: line.erpDescription ?? null,
        }),
  }));
}

export type UpsertOrderFromTinyResult = {
  orderId: string;
  created: boolean;
  missingProducts: string[];
  missingLocations: string[];
  hasIntegrationIssues: boolean;
};

async function notifyOrderIntegrationIssues(params: {
  tenantId: string;
  orderId: string;
  erpOrderId: string;
  missingProducts: string[];
  missingLocations: string[];
}): Promise<void> {
  const parts: string[] = [];
  if (params.missingProducts.length > 0) {
    parts.push(
      `Produto não cadastrado: ${params.missingProducts.join(", ")}`,
    );
  }
  if (params.missingLocations.length > 0) {
    parts.push(
      `Sem localização cadastrada: ${params.missingLocations.join(", ")}`,
    );
  }
  if (parts.length === 0) return;

  await notifyUsersWithPermission(
    Permission.SALES_VIEW,
    {
      title: `Pedido ${params.erpOrderId} com pendências`,
      body: parts.join(". "),
      category: "ORDER",
      data: {
        orderId: params.orderId,
        erpOrderId: params.erpOrderId,
        missingProducts: params.missingProducts,
        missingLocations: params.missingLocations,
      },
    },
    params.tenantId,
  );

  await notifyUsersWithPermission(
    Permission.REGISTERS_VIEW,
    {
      title: `Cadastro pendente — ${params.erpOrderId}`,
      body: parts.join(". "),
      category: "ORDER",
      data: {
        orderId: params.orderId,
        erpOrderId: params.erpOrderId,
        missingProducts: params.missingProducts,
        missingLocations: params.missingLocations,
      },
    },
    params.tenantId,
  );
}

export async function upsertOrderFromTiny(
  tenantId: string,
  payload: TinyOrderPayload,
): Promise<UpsertOrderFromTinyResult> {
  const existing = await prisma.order.findFirst({
    where: { tenantId, erpOrderId: payload.erpOrderId },
    include: { items: true },
  });

  if (
    existing &&
    existing.status !== OrderStatus.PENDING &&
    existing.status !== OrderStatus.PAUSED_ISSUE
  ) {
    return {
      orderId: existing.id,
      created: false,
      missingProducts: [],
      missingLocations: [],
      hasIntegrationIssues: false,
    };
  }

  if (payload.items.length === 0) {
    throw new Error(`Pedido ${payload.erpOrderId} sem itens no ERP`);
  }

  const resolved = await resolveOrderLinesFromTiny(tenantId, payload.items);
  const hasIntegrationIssues =
    resolved.missingProducts.length > 0 ||
    resolved.missingLocations.length > 0;
  const targetStatus = hasIntegrationIssues
    ? OrderStatus.PAUSED_ISSUE
    : OrderStatus.PENDING;

  const erpPriority = await resolveErpPriorityForPayload(tenantId, payload);
  const itemCreates = mapLinesToCreateInput(resolved.lines);

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
        status: targetStatus,
        ...(erpPriority !== null ? { erpPriority } : {}),
        items: { create: itemCreates },
      },
    });
    await enrichOrderPriority(existing.id);
    if (hasIntegrationIssues) {
      await notifyOrderIntegrationIssues({
        tenantId,
        orderId: existing.id,
        erpOrderId: payload.erpOrderId,
        missingProducts: resolved.missingProducts,
        missingLocations: resolved.missingLocations,
      });
    }
    return {
      orderId: existing.id,
      created: false,
      missingProducts: resolved.missingProducts,
      missingLocations: resolved.missingLocations,
      hasIntegrationIssues,
    };
  }

  const order = await prisma.order.create({
    data: {
      tenantId,
      erpOrderId: payload.erpOrderId,
      customerName: payload.customerName,
      marketplace: payload.marketplace,
      collectionDeadline: payload.collectionDeadline,
      erpSource: "TINY",
      status: targetStatus,
      ...(erpPriority !== null ? { erpPriority } : {}),
      items: { create: itemCreates },
    },
  });

  await enrichOrderPriority(order.id);
  if (hasIntegrationIssues) {
    await notifyOrderIntegrationIssues({
      tenantId,
      orderId: order.id,
      erpOrderId: payload.erpOrderId,
      missingProducts: resolved.missingProducts,
      missingLocations: resolved.missingLocations,
    });
  }

  return {
    orderId: order.id,
    created: true,
    missingProducts: resolved.missingProducts,
    missingLocations: resolved.missingLocations,
    hasIntegrationIssues,
  };
}

/** Reaplica prioridade Tiny + WMS em pedidos PENDING do tenant. */
export async function syncPendingOrderPrioritiesFromTiny(
  tenantId: string,
  userId?: string,
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
    const erpPriority = await fetchTinyOrderPriority(
      tenantId,
      o.erpOrderId,
      userId,
    );
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
