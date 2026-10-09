import {
  InventoryMovementType,
  OrderStatus,
  OrderTimeLogEvent,
  PickWaveLineSortStatus,
  PickWaveStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createNotification, notifyUsersWithPermission } from "./notifications.js";
import { Permission, productMatchesCode } from "@wms/shared";
import { getWaveLineDetail } from "./pick-wave.js";
import { confirmSortAllocation } from "./pick-wave-sort.js";
import {
  allocateQuantityAcrossPickFaces,
  buildMultiGondolaHint,
  type PickSegment,
} from "./pick-allocation.js";
import {
  aggregateWaveUrgency,
  formatRouteLabel,
  orderRouteAnchor,
  scorePackingUrgency,
  sortPackingOrders,
  sortWavePackingLines,
} from "./packing-queue-sort.js";
import { getRouteEngine } from "./route-engine/index.js";
import { sortPendingItemsByEngine } from "./route-engine/route-helpers.js";
import { detectLabelFormat } from "./tiny-shipping-labels.js";
import { restoreFaceOnReturn } from "./location-level.js";
import { recordOrderStageChange } from "./order-stage-log.js";
import { loadApproachWaveDefs } from "./approach-waves/store.js";
import { matchLocation, sequenceKeyIn, type ZoneLocation } from "./approach-waves/matching.js";
import { NO_ZONE, packingZoneFor, sortByUrgencyThenSequence } from "./approach-waves/parts.js";

export class PackingSessionError extends Error {
  constructor(
    message: string,
    public statusCode = 422,
  ) {
    super(message);
    this.name = "PackingSessionError";
  }
}

async function orderHasPackedProgress(orderId: string): Promise<boolean> {
  const agg = await prisma.orderItem.aggregate({
    where: { orderId },
    _sum: { quantityPacked: true },
  });
  return (agg._sum.quantityPacked ?? 0) > 0;
}

async function getPackingOperationalState(orderId: string) {
  const logs = await prisma.orderTimeLog.findMany({
    where: {
      orderId,
      event: {
        in: [
          OrderTimeLogEvent.PACK_START,
          OrderTimeLogEvent.PACK_END,
          OrderTimeLogEvent.PACK_CANCEL,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });

  let activeStart: (typeof logs)[0] | null = null;
  for (const log of logs) {
    if (log.event === OrderTimeLogEvent.PACK_START) {
      activeStart = log;
    } else if (
      log.event === OrderTimeLogEvent.PACK_END ||
      log.event === OrderTimeLogEvent.PACK_CANCEL
    ) {
      activeStart = null;
    }
  }

  const hasPackedProgress = await orderHasPackedProgress(orderId);

  return {
    packingInProgress: activeStart != null,
    packingOperatorId: activeStart?.userId ?? null,
    packingOperatorName: activeStart?.user.name ?? null,
    hasPackedProgress,
  };
}

const orderInclude = {
  basket: { select: { id: true, code: true, barcode: true } },
  assignedPicker: { select: { name: true } },
  items: {
    orderBy: { lineNumber: "asc" as const },
    include: {
      pickLocation: {
        select: { id: true, corridor: true, row: true, barcode: true, estanteId: true, face: true },
      },
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          barcode: true,
          imageUrl: true,
          unit: true,
          weight: true,
        },
      },
    },
  },
} as const;

type OrderRow = {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  shippingLabel: string | null;
  status: OrderStatus;
  priority: number;
  collectionDeadline: Date | null;
  marketplace: string | null;
  tenantId: string;
  basket: { id: string; code: string; barcode: string } | null;
  assignedPicker: { name: string } | null;
  items: Array<{
    id: string;
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    quantityPacked: number;
    productId: string | null;
    pickLocation: {
      id: string;
      corridor: string;
      row: string;
      barcode: string;
      estanteId?: string | null;
      face?: string | null;
    } | null;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
      imageUrl: string | null;
      unit: string | null;
      weight: unknown;
    } | null;
  }>;
};

async function resolvePickSegmentsForItem(
  item: OrderRow["items"][number],
  tenantId: string,
): Promise<PickSegment[]> {
  const qty = item.quantityPicked > 0 ? item.quantityPicked : item.quantityOrdered;
  if (qty <= 0) return [];

  if (item.pickLocation) {
    return [
      {
        locationId: item.pickLocation.id,
        barcode: item.pickLocation.barcode,
        corridor: item.pickLocation.corridor,
        row: item.pickLocation.row,
        quantity: qty,
        label: formatRouteLabel(item.pickLocation),
      },
    ];
  }

  if (!item.productId) return [];

  try {
    const { segments } = await allocateQuantityAcrossPickFaces(
      item.productId,
      tenantId,
      qty,
    );
    return segments;
  } catch {
    return [];
  }
}

async function mapPackingOrder(
  order: OrderRow,
  packingState?: Awaited<ReturnType<typeof getPackingOperationalState>>,
) {
  const state = packingState ?? (await getPackingOperationalState(order.id));
  const allPacked = order.items.every(
    (i) => i.quantityPacked >= i.quantityPicked && i.quantityPicked > 0,
  );
  const anchor = orderRouteAnchor(
    order.items.map((i) => ({
      quantityPicked: i.quantityPicked,
      pickLocation: i.pickLocation,
    })),
    await getRouteEngine(order.tenantId),
  );

  const items = await Promise.all(
    order.items.map(async (i) => {
      const pickSegments = await resolvePickSegmentsForItem(i, order.tenantId);
      return {
        id: i.id,
        lineNumber: i.lineNumber,
        quantityOrdered: i.quantityOrdered,
        quantityPicked: i.quantityPicked,
        quantityPacked: i.quantityPacked,
        remaining: Math.max(0, i.quantityPicked - i.quantityPacked),
        product: i.product,
        pickLocation: i.pickLocation,
        pickSegments,
        multiGondolaHint: buildMultiGondolaHint(pickSegments),
      };
    }),
  );

  return {
    id: order.id,
    erpOrderId: order.erpOrderId,
    customerName: order.customerName,
    shippingLabel: order.shippingLabel,
    status: order.status,
    priority: order.priority,
    collectionDeadline: order.collectionDeadline?.toISOString() ?? null,
    packingUrgency: scorePackingUrgency(order),
    routeLabel: anchor?.label ?? null,
    basket: order.basket,
    assignedPicker: order.assignedPicker,
    allPacked,
    packingInProgress: state.packingInProgress,
    packingOperatorName: state.packingOperatorName,
    items,
  };
}

export async function listPackingQueue(tenantId: string) {
  const orders = await prisma.order.findMany({
    where: { tenantId, status: OrderStatus.PICKED_AWAITING_CONFERENCE },
    take: 100,
    include: orderInclude,
  });

  const sorted = sortPackingOrders(
    orders.map((o) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      priority: o.priority,
      collectionDeadline: o.collectionDeadline,
      marketplace: o.marketplace,
      items: o.items.map((i) => ({
        quantityPicked: i.quantityPicked,
        pickLocation: i.pickLocation,
      })),
    })),
    new Date(),
    await getRouteEngine(tenantId),
  );

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const result = [];
  for (const s of sorted) {
    const o = orderMap.get(s.id);
    if (o) result.push(await mapPackingOrder(o));
  }
  return { orders: result };
}

/** Filtro da fila por onda de aproximação do packing (`none` = fora de todas as áreas). */
async function packingZoneFilter(tenantId: string, approachWaveId: string) {
  const defs = await loadApproachWaveDefs(tenantId, "PACKING");
  const def = approachWaveId === NO_ZONE ? null : defs.find((d) => d.id === approachWaveId) ?? null;
  if (approachWaveId !== NO_ZONE && !def) {
    throw new PackingSessionError("Onda de aproximação do packing não encontrada", 404);
  }
  const target = def?.id ?? null;
  const key = (loc: ZoneLocation | null) => (def && loc ? sequenceKeyIn(def, loc) : null);
  const minKey = (keys: Array<number | null>) => {
    const valid = keys.filter((k): k is number => k != null);
    return valid.length > 0 ? Math.min(...valid) : null;
  };
  return {
    lines<T extends { waveUrgency: number; pickLocation: ZoneLocation }>(lines: T[]): T[] {
      const own = lines.filter((l) => (matchLocation(defs, l.pickLocation)?.waveId ?? null) === target);
      return sortByUrgencyThenSequence(own, (l) => l.waveUrgency, (l) => key(l.pickLocation));
    },
    orders<
      T extends {
        packingUrgency: number;
        items: Array<{ quantityPicked: number; quantityOrdered: number; pickLocation: ZoneLocation | null }>;
      },
    >(orders: T[]): T[] {
      const own = orders.filter(
        (o) =>
          packingZoneFor(
            o.items.map((i) => ({ quantity: i.quantityPicked || i.quantityOrdered, location: i.pickLocation })),
            defs,
          ) === target,
      );
      return sortByUrgencyThenSequence(
        own,
        (o) => o.packingUrgency,
        (o) => minKey(o.items.map((i) => key(i.pickLocation))),
      );
    },
  };
}

export async function listUnifiedPackingQueue(tenantId: string, opts?: { approachWaveId?: string }) {
  const [waveRaw, ordersResult] = await Promise.all([
    listWavePackingLinesInternal(tenantId),
    listPackingQueue(tenantId),
  ]);
  const zone = opts?.approachWaveId ? await packingZoneFilter(tenantId, opts.approachWaveId) : null;
  const waveLines = zone ? zone.lines(waveRaw.lines) : waveRaw.lines;
  const queueOrders = zone ? zone.orders(ordersResult.orders) : ordersResult.orders;

  type WaveLineQueue = Omit<(typeof waveRaw.lines)[0], "collectionDeadline" | "pickLocation"> & {
    collectionDeadline: string | null;
  };

  type WaveQueue = {
    id: string;
    name: string;
    collectionDeadline: string | null;
    orderCount: number;
    pickerName: string | null;
    linesTotal: number;
    linesPicked: number;
    linesSorted: number;
    unitsTotal: number;
    unitsPicked: number;
    readyLines: WaveLineQueue[];
  };

  const items: Array<
    | { kind: "wave"; sortKey: number; wave: WaveQueue }
    | { kind: "order"; sortKey: number; order: (typeof ordersResult.orders)[0] }
  > = [];

  const waveIds = [...new Set(waveLines.map((l) => l.waveId))];
  const waveTotals = waveIds.length
    ? await prisma.pickWave.findMany({
        where: { id: { in: waveIds } },
        select: {
          id: true,
          acceptedBy: { select: { name: true } },
          _count: { select: { orders: true } },
          lines: { select: { quantityTotal: true, quantityPicked: true, sortStatus: true } },
        },
      })
    : [];
  const totalsById = new Map(waveTotals.map((w) => [w.id, w]));

  const waves = new Map<string, { sortKey: number; wave: WaveQueue }>();
  for (const line of waveLines) {
    const { collectionDeadline, pickLocation: _pick, ...lineRest } = line;
    const queueLine = { ...lineRest, collectionDeadline: collectionDeadline?.toISOString() ?? null };
    const existing = waves.get(line.waveId);
    if (existing) {
      existing.wave.readyLines.push(queueLine);
      continue;
    }
    const totals = totalsById.get(line.waveId);
    const allLines = totals?.lines ?? [];
    waves.set(line.waveId, {
      sortKey: line.waveUrgency,
      wave: {
        id: line.waveId,
        name: line.waveName,
        collectionDeadline: queueLine.collectionDeadline,
        orderCount: totals?._count.orders ?? 0,
        pickerName: totals?.acceptedBy?.name ?? null,
        linesTotal: allLines.length,
        linesPicked: allLines.filter((l) => l.quantityPicked >= l.quantityTotal).length,
        linesSorted: allLines.filter((l) => l.sortStatus === PickWaveLineSortStatus.SORTED).length,
        unitsTotal: allLines.reduce((sum, l) => sum + l.quantityTotal, 0),
        unitsPicked: allLines.reduce((sum, l) => sum + l.quantityPicked, 0),
        readyLines: [queueLine],
      },
    });
  }
  for (const { sortKey, wave } of waves.values()) {
    items.push({ kind: "wave", sortKey, wave });
  }
  for (const order of queueOrders) {
    items.push({ kind: "order", sortKey: order.packingUrgency ?? 0, order });
  }
  return { items };
}

export async function findPackingOrderByQuery(tenantId: string, q: string) {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const order = await prisma.order.findFirst({
    where: {
      tenantId,
      status: OrderStatus.PICKED_AWAITING_CONFERENCE,
      OR: [
        { erpOrderId: { equals: trimmed, mode: "insensitive" } },
        { basket: { code: { equals: trimmed, mode: "insensitive" } } },
        { basket: { barcode: { equals: trimmed, mode: "insensitive" } } },
      ],
    },
    include: orderInclude,
  });
  if (!order) return null;
  return mapPackingOrder(order);
}

export async function getPackingSession(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: orderInclude,
  });
  if (!order) throw new Error("Pedido não encontrado");
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new Error("Pedido não está aguardando packing");
  }
  return mapPackingOrder(order);
}

export async function startPacking(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new PackingSessionError("Pedido não encontrado", 404);
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new PackingSessionError("Pedido não está aguardando packing");
  }

  const state = await getPackingOperationalState(orderId);
  if (state.packingInProgress) {
    if (
      state.packingOperatorId !== userId &&
      !state.hasPackedProgress
    ) {
      throw new PackingSessionError(
        `Pedido em conferência por ${state.packingOperatorName ?? "outro operador"}`,
        409,
      );
    }
  } else {
    await prisma.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_START },
    });
  }

  return getPackingSession(orderId);
}

export async function cancelPacking(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new PackingSessionError("Pedido não encontrado", 404);
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new PackingSessionError("Pedido não está aguardando packing");
  }

  const state = await getPackingOperationalState(orderId);
  if (!state.packingInProgress) {
    return { cancelled: false, reason: "no_active_session" };
  }

  if (state.hasPackedProgress) {
    throw new PackingSessionError(
      "Não é possível cancelar: já há itens conferidos",
      409,
    );
  }

  if (state.packingOperatorId && state.packingOperatorId !== userId) {
    throw new PackingSessionError(
      "Apenas quem iniciou a conferência pode cancelar",
      403,
    );
  }

  await prisma.orderTimeLog.create({
    data: { orderId, userId, event: OrderTimeLogEvent.PACK_CANCEL },
  });

  return { cancelled: true };
}

async function applyPackingQuantity(
  orderId: string,
  itemId: string,
  quantity: number,
) {
  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, orderId },
  });
  if (!item) throw new Error("Item não pertence ao pedido");

  const qty = Math.max(1, Math.floor(quantity));
  const remaining = item.quantityPicked - item.quantityPacked;
  if (remaining <= 0) throw new Error("Item já conferido no packing");

  const increment = Math.min(qty, remaining);
  await prisma.orderItem.update({
    where: { id: item.id },
    data: { quantityPacked: { increment } },
  });
}

export async function confirmPackingItem(
  orderId: string,
  userId: string,
  itemId: string,
  quantity: number,
) {
  await startPacking(orderId, userId);
  await applyPackingQuantity(orderId, itemId, quantity);
  return getPackingSession(orderId);
}

export async function scanPackingItem(
  orderId: string,
  userId: string,
  barcode: string,
  quantity = 1,
) {
  await startPacking(orderId, userId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) throw new Error("Pedido não encontrado");

  const item = order.items.find((i) => i.product && productMatchesCode(i.product, barcode));
  if (!item) throw new Error("Produto não pertence ao pedido");

  await applyPackingQuantity(orderId, item.id, quantity);
  return getPackingSession(orderId);
}

export async function completePacking(orderId: string, userId: string) {
  const session = await getPackingSession(orderId);
  if (!session.allPacked) {
    throw new Error("Ainda há itens pendentes de conferência no packing");
  }

  const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
  if (!orderBefore) throw new Error("Pedido não encontrado");

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DISPATCHING },
    });
    await recordOrderStageChange(tx, {
      tenantId: orderBefore.tenantId,
      orderId,
      fromStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
      toStatus: OrderStatus.DISPATCHING,
      userId,
    });
    await tx.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_END },
    });
    const { ensureDispatchStartLog } = await import(
      "./order-time-log-helpers.js"
    );
    await ensureDispatchStartLog(tx, orderId, userId);
  });

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order) {
    await notifyUsersWithPermission(Permission.SHIPPING_VIEW, {
      title: "Pedido pronto para expedir",
      body: `${order.erpOrderId} aguarda despacho.`,
      category: "SHIPPING",
      data: { orderId: order.id, erpOrderId: order.erpOrderId },
    });
  }

  return { orderId, status: OrderStatus.DISPATCHING, completed: true };
}

export type PackingIssueType =
  | "MISSING"
  | "DAMAGED"
  | "WRONG_ITEM"
  | "WRONG_QUANTITY";

export const PACKING_ISSUE_TYPE_LABEL: Record<PackingIssueType, string> = {
  MISSING: "Item faltando",
  DAMAGED: "Avaria no produto",
  WRONG_ITEM: "Item separado errado",
  WRONG_QUANTITY: "Quantidade divergente",
};

export interface PackingIssuePayload {
  itemId: string;
  quantity: number;
  type: PackingIssueType;
  description?: string;
}

/** Quem coletou o item: separador da linha da onda, quem aceitou a onda ou quem separou o pedido avulso. */
async function findItemPicker(
  tenantId: string,
  orderId: string,
  orderItemId: string,
  assignedPickerId: string | null,
) {
  const alloc = await prisma.pickWaveAllocation.findFirst({
    where: { orderItemId },
    select: { waveLine: { select: { pickedById: true, wave: { select: { acceptedById: true } } } } },
  });
  let pickerId = alloc?.waveLine.pickedById ?? alloc?.waveLine.wave.acceptedById ?? assignedPickerId;
  if (!pickerId) {
    const lastPick = await prisma.orderTimeLog.findFirst({
      where: { orderId, event: { in: [OrderTimeLogEvent.START, OrderTimeLogEvent.END] } },
      orderBy: { createdAt: "desc" },
      select: { userId: true },
    });
    pickerId = lastPick?.userId ?? null;
  }
  if (!pickerId) return null;
  return prisma.user.findFirst({
    where: { id: pickerId, tenantId, active: true },
    select: { id: true, name: true },
  });
}

export async function reportPackingIssue(
  orderId: string,
  userId: string,
  input: PackingIssuePayload,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { sku: true, name: true } } } },
    },
  });
  if (!order) throw new PackingSessionError("Pedido não encontrado", 404);
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new PackingSessionError("Pedido não está em conferência de packing");
  }

  const item = order.items.find((i) => i.id === input.itemId);
  if (!item) {
    throw new PackingSessionError("Item não pertence ao pedido", 404);
  }

  if (!PACKING_ISSUE_TYPE_LABEL[input.type]) {
    throw new PackingSessionError("Tipo de problema inválido");
  }

  const qty = Math.floor(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new PackingSessionError("Quantidade inválida");
  }
  if (qty > item.quantityPicked) {
    throw new PackingSessionError(
      "Quantidade reportada maior que a quantidade separada",
    );
  }

  const description = input.description?.trim().slice(0, 280) ?? "";

  if (!item.product) {
    throw new PackingSessionError("Produto do item não encontrado");
  }
  const product = item.product;

  const reasonPayload = {
    itemId: item.id,
    productId: item.productId,
    sku: product.sku,
    productName: product.name,
    type: input.type,
    quantity: qty,
    description,
  };

  const newPicked = Math.max(0, item.quantityPicked - qty);
  const newPacked = Math.min(item.quantityPacked, newPicked);

  const packingState = await getPackingOperationalState(orderId);
  const picker = await findItemPicker(order.tenantId, orderId, item.id, order.assignedPickerId);

  await prisma.$transaction(async (tx) => {
    const { detachOrderFromWaveForPackingReturn } = await import(
      "./pick-wave.js"
    );
    await detachOrderFromWaveForPackingReturn(
      tx,
      order.tenantId,
      orderId,
      item.id,
      qty,
    );

    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        quantityPicked: newPicked,
        quantityPacked: newPacked,
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.PACKING_RETURNED_TO_PICKING,
        assignedPickerId: picker?.id ?? null,
      },
    });
    await recordOrderStageChange(tx, {
      tenantId: order.tenantId,
      orderId,
      fromStatus: order.status,
      toStatus: OrderStatus.PACKING_RETURNED_TO_PICKING,
      userId,
      reason: JSON.stringify(reasonPayload),
    });
    await tx.orderTimeLog.create({
      data: {
        orderId,
        userId,
        event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
        reason: JSON.stringify(reasonPayload),
      },
    });
    if (packingState.packingInProgress) {
      await tx.orderTimeLog.create({
        data: { orderId, userId, event: OrderTimeLogEvent.PACK_CANCEL },
      });
    }
  });

  const summary = `${product.sku} · ${PACKING_ISSUE_TYPE_LABEL[input.type]} · ${qty} un.`;
  const notification = {
    title: picker ? "Pedido voltou para você corrigir" : "Pedido retornou do packing",
    body: `${order.erpOrderId} — ${summary}`,
    category: "PICKING",
    data: {
      orderId: order.id,
      erpOrderId: order.erpOrderId,
      issueType: input.type,
      sku: product.sku,
    },
  };
  if (picker) await createNotification({ userId: picker.id, ...notification });
  else await notifyUsersWithPermission(Permission.MOBILE_ACCESS, notification, order.tenantId);

  return {
    orderId,
    status: OrderStatus.PACKING_RETURNED_TO_PICKING,
    reported: true,
    summary,
    returnedToName: picker?.name ?? null,
  };
}

/** Conferência do item da onda achou erro: zera a coleta da linha e devolve para quem separou. */
export async function returnWaveLineToPicker(
  lineId: string,
  userId: string,
  input: { type: PackingIssueType; description?: string },
) {
  const line = await prisma.pickWaveLine.findUnique({
    where: { id: lineId },
    include: {
      wave: { select: { id: true, tenantId: true, name: true, status: true, acceptedById: true } },
      part: { select: { acceptedById: true } },
      product: { select: { sku: true, name: true } },
      pickLocation: true,
      allocations: { include: { orderItem: { select: { id: true, orderId: true, quantityPicked: true } } } },
    },
  });
  if (!line) throw new PackingSessionError("Item da onda não encontrado", 404);
  if (line.wave.status !== PickWaveStatus.RELEASED) {
    throw new PackingSessionError("Onda não está ativa");
  }
  if (!PACKING_ISSUE_TYPE_LABEL[input.type]) {
    throw new PackingSessionError("Tipo de problema inválido");
  }
  if (line.quantityPicked <= 0) {
    throw new PackingSessionError("Este item ainda não foi coletado");
  }
  if (line.allocations.some((a) => a.quantitySorted > 0)) {
    throw new PackingSessionError(
      "Parte deste item já foi conferida nos pedidos. Reporte o erro dentro do pedido.",
    );
  }

  const units = line.quantityPicked;
  const description = input.description?.trim().slice(0, 280) ?? "";
  const pickerId = line.pickedById ?? line.part?.acceptedById ?? line.wave.acceptedById;
  const picker = pickerId
    ? await prisma.user.findFirst({
        where: { id: pickerId, tenantId: line.wave.tenantId, active: true },
        select: { id: true, name: true },
      })
    : null;

  await prisma.$transaction(async (tx) => {
    for (const alloc of line.allocations) {
      const fromWave = Math.min(alloc.orderItem.quantityPicked, alloc.quantity);
      if (fromWave <= 0) continue;
      await tx.orderItem.update({
        where: { id: alloc.orderItem.id },
        data: { quantityPicked: alloc.orderItem.quantityPicked - fromWave },
      });
    }
    await tx.pickWaveLine.update({
      where: { id: line.id },
      data: {
        quantityPicked: 0,
        sortStatus: PickWaveLineSortStatus.PENDING,
        pickCompletedAt: null,
      },
    });
    const change = await restoreFaceOnReturn(tx, line.pickLocation, units);
    await tx.inventoryMovement.create({
      data: {
        tenantId: line.wave.tenantId,
        type: InventoryMovementType.ADJUSTMENT,
        quantity: units,
        userId,
        productId: line.productId,
        toLocationId: line.pickLocationId,
        pickWaveLineId: line.id,
        notes: `Devolvido pelo packing · ${PACKING_ISSUE_TYPE_LABEL[input.type]}${description ? ` · ${description}` : ""}`,
        ...(change ? { percentBefore: change.before, percentAfter: change.after } : {}),
      },
    });
  });

  const summary = `${line.product.sku} · ${PACKING_ISSUE_TYPE_LABEL[input.type]} · ${units} un.`;
  const notification = {
    title: picker ? "Item da onda voltou para você corrigir" : "Item da onda retornou do packing",
    body: `${line.wave.name} — ${summary}${description ? ` · ${description}` : ""}`,
    category: "PICKING",
    data: { waveId: line.wave.id, lineId: line.id, issueType: input.type, sku: line.product.sku },
  };
  if (picker) await createNotification({ userId: picker.id, ...notification });
  else await notifyUsersWithPermission(Permission.MOBILE_ACCESS, notification, line.wave.tenantId);

  return { lineId: line.id, waveId: line.wave.id, summary, returnedToName: picker?.name ?? null };
}

async function listWavePackingLinesInternal(tenantId: string) {
  const lines = await prisma.pickWaveLine.findMany({
    where: {
      wave: { tenantId, status: PickWaveStatus.RELEASED },
      quantityPicked: { gt: 0 },
      sortStatus: { not: PickWaveLineSortStatus.SORTED },
    },
    take: 100,
    include: {
      product: { select: { sku: true, name: true } },
      wave: {
        select: {
          id: true,
          name: true,
          releasedAt: true,
          orders: {
            include: {
              order: {
                select: {
                  priority: true,
                  collectionDeadline: true,
                  marketplace: true,
                },
              },
            },
          },
        },
      },
      pickLocation: { select: { corridor: true, row: true, barcode: true, estanteId: true, face: true } },
    },
  });

  const mapped = lines.map((l) => {
    const waveOrders = l.wave.orders.map((wo) => wo.order);
    const { waveUrgency, collectionDeadline } = aggregateWaveUrgency(waveOrders);
    return {
      id: l.id,
      waveId: l.waveId,
      waveName: l.wave.name,
      waveReleasedAt: l.wave.releasedAt?.toISOString() ?? null,
      waveUrgency,
      collectionDeadline,
      sku: l.product.sku,
      productName: l.product.name,
      locationBarcode: l.pickLocation.barcode,
      routeLabel: formatRouteLabel(l.pickLocation),
      quantityPicked: l.quantityPicked,
      quantityTotal: l.quantityTotal,
      sortStatus: l.sortStatus,
      pickLocation: l.pickLocation,
    };
  });

  const sorted = sortWavePackingLines(
    mapped.map((l) => ({
      ...l,
      waveUrgency: l.waveUrgency,
      collectionDeadline: l.collectionDeadline,
      pickLocation: l.pickLocation,
    })),
    await getRouteEngine(tenantId),
  );

  return { lines: sorted };
}

export async function listWavePackingLines(tenantId: string) {
  const { lines } = await listWavePackingLinesInternal(tenantId);
  return {
    lines: lines.map(
      ({ pickLocation: _p, collectionDeadline: _c, ...rest }) => rest,
    ),
  };
}

/** Pedidos já conferidos no packing, candidatos à etiqueta em lote. */
export async function listLabelBatchOrders(tenantId: string, opts?: { waveId?: string }) {
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: OrderStatus.DISPATCHING,
      ...(opts?.waveId ? { waveOrders: { some: { waveId: opts.waveId } } } : {}),
    },
    orderBy: [{ collectionDeadline: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 300,
    select: {
      id: true,
      erpOrderId: true,
      customerName: true,
      marketplace: true,
      collectionDeadline: true,
      shippingLabel: true,
      basket: { select: { code: true } },
      waveOrders: { take: 1, select: { wave: { select: { name: true } } } },
    },
  });
  const wave = opts?.waveId
    ? await prisma.pickWave.findFirst({ where: { id: opts.waveId, tenantId }, select: { id: true, name: true } })
    : null;

  return {
    wave,
    orders: orders.map((o) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      customerName: o.customerName,
      marketplace: o.marketplace,
      collectionDeadline: o.collectionDeadline?.toISOString() ?? null,
      hasLabel: Boolean(o.shippingLabel),
      basketCode: o.basket?.code ?? null,
      waveName: o.waveOrders[0]?.wave.name ?? null,
    })),
  };
}

/** Onda inteira para o packing: todas as linhas (coletadas ou não) e o andamento de cada pedido. */
export async function getWavePackingOverview(tenantId: string, waveId: string) {
  const wave = await prisma.pickWave.findFirst({
    where: { id: waveId, tenantId },
    include: {
      acceptedBy: { select: { name: true } },
      lines: {
        include: {
          product: { select: { sku: true, name: true, imageUrl: true } },
          pickLocation: {
            select: { corridor: true, row: true, barcode: true, estanteId: true, face: true },
          },
          pickedBy: { select: { name: true } },
          allocations: {
            select: { quantity: true, quantitySorted: true, orderItem: { select: { orderId: true } } },
          },
        },
      },
      orders: {
        include: {
          order: {
            select: {
              id: true,
              erpOrderId: true,
              customerName: true,
              marketplace: true,
              status: true,
              priority: true,
              collectionDeadline: true,
              shippingLabel: true,
              basket: { select: { code: true } },
            },
          },
        },
      },
    },
  });
  if (!wave) throw new PackingSessionError("Onda não encontrada", 404);

  const { collectionDeadline } = aggregateWaveUrgency(wave.orders.map((wo) => wo.order));
  const engine = await getRouteEngine(tenantId);
  const lines = sortPendingItemsByEngine(engine, wave.lines, () => true).map((l) => ({
    id: l.id,
    sku: l.product.sku,
    productName: l.product.name,
    imageUrl: l.product.imageUrl,
    locationBarcode: l.pickLocation.barcode,
    routeLabel: formatRouteLabel(l.pickLocation),
    quantityTotal: l.quantityTotal,
    quantityPicked: l.quantityPicked,
    quantitySorted: l.allocations.reduce((sum, a) => sum + a.quantitySorted, 0),
    sortStatus: l.sortStatus,
    pickedByName: l.pickedBy?.name ?? null,
  }));

  const unitsByOrder = new Map<string, { total: number; sorted: number }>();
  for (const l of wave.lines) {
    for (const a of l.allocations) {
      const acc = unitsByOrder.get(a.orderItem.orderId) ?? { total: 0, sorted: 0 };
      acc.total += a.quantity;
      acc.sorted += a.quantitySorted;
      unitsByOrder.set(a.orderItem.orderId, acc);
    }
  }
  const orders = wave.orders
    .map(({ order: o }) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      customerName: o.customerName,
      marketplace: o.marketplace,
      status: o.status,
      priority: o.priority,
      collectionDeadline: o.collectionDeadline?.toISOString() ?? null,
      basketCode: o.basket?.code ?? null,
      hasLabel: Boolean(o.shippingLabel),
      labelFormat: o.shippingLabel ? detectLabelFormat(o.shippingLabel) : null,
      unitsTotal: unitsByOrder.get(o.id)?.total ?? 0,
      unitsSorted: unitsByOrder.get(o.id)?.sorted ?? 0,
    }))
    .sort((a, b) => b.priority - a.priority || a.erpOrderId.localeCompare(b.erpOrderId));

  return {
    wave: {
      id: wave.id,
      name: wave.name,
      status: wave.status,
      releasedAt: wave.releasedAt?.toISOString() ?? null,
      acceptedByName: wave.acceptedBy?.name ?? null,
      collectionDeadline: collectionDeadline?.toISOString() ?? null,
    },
    lines,
    orders,
  };
}

export async function getWavePackingLine(lineId: string) {
  const line = await getWaveLineDetail(lineId);
  if (!line) throw new Error("Linha não encontrada");
  if (line.sortStatus === PickWaveLineSortStatus.SORTED) {
    throw new Error("Linha já finalizada no packing");
  }
  const meta = await prisma.pickWaveLine.findUnique({
    where: { id: lineId },
    select: {
      waveId: true,
      wave: {
        select: {
          name: true,
          orders: {
            include: {
              order: {
                select: {
                  priority: true,
                  collectionDeadline: true,
                  marketplace: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const waveOrders =
    meta?.wave.orders.map((wo) => wo.order) ?? [];
  const { collectionDeadline } = aggregateWaveUrgency(waveOrders);
  return {
    collectionDeadline: collectionDeadline?.toISOString() ?? null,
    line: {
      ...line,
      waveId: meta?.waveId ?? "",
      waveName: meta?.wave.name ?? "",
    },
  };
}

export async function sortWaveAllocationWeb(
  lineId: string,
  userId: string,
  input: {
    allocationId: string;
    quantity: number;
    basketBarcode?: string;
  },
) {
  return confirmSortAllocation({
    lineId,
    allocationId: input.allocationId,
    quantity: input.quantity,
    basketBarcode: input.basketBarcode,
    userId,
    webPacking: true,
  });
}

export {
  fetchShippingLabelsForOrder,
  fetchShippingLabelFile,
  fetchShippingLabelPreview,
} from "./tiny-shipping-labels.js";
