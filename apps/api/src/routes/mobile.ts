import type { FastifyInstance } from "fastify";
import { OrderStatus, OrderTimeLogEvent, InventoryMovementType } from "@prisma/client";
import { requireMobileAccess } from "../lib/auth-guard.js";
import { prisma } from "../lib/prisma.js";
import { resolveUserId } from "../lib/user-context.js";
import {
  LocationStockError,
  stockLocation,
} from "../services/location-stock.js";
import {
  LocationAdjustError,
  adjustLocationQuantity,
} from "../services/location-adjust.js";
import {
  LocationTransferError,
  transferPulmaoToPickFace,
} from "../services/location-transfer.js";
import {
  CargoTransferError,
  depositCargoTransfer,
  getCargoTransfer,
  listPendingCargoTransfers,
  withdrawCargoTransfer,
} from "../services/cargo-transfer.js";
import {
  PickWaveError,
  acceptPickWave,
  getCurrentReleasedWave,
  getReleasedWaveById,
  listReleasedWaves,
  getOrderIdsInActiveWave,
  getWaveLineDetail,
  mapWaveLineSummary,
} from "../services/pick-wave.js";
import { isWaveEnabled } from "../services/wave-settings.js";
import { confirmConsolidatedPick } from "../services/pick-wave-pick.js";
import { confirmSortAllocation } from "../services/pick-wave-sort.js";
import {
  completePurchaseReceipt,
  confirmReceiptItem,
  getPurchaseReceiptSession,
  isTinyConnectedError,
  listPurchaseReceiptQueue,
  markConferenceStarted,
  scanPurchaseReceiptItem,
  startPurchaseReceiptByBarcode,
} from "../services/tiny-purchase-receipt.js";
import {
  completePutaway,
  getPutawaySession,
  listPutawayQueue,
  startPutaway,
  storePutawayItem,
} from "../services/putaway.js";

function formatLocation(loc: { corridor: string; row: string; barcode: string }) {
  return `${loc.corridor}-${loc.row} · ${loc.barcode}`;
}

export async function mobileRoutes(app: FastifyInstance) {
  app.addHook("onRequest", requireMobileAccess);

  // ---------------------------------------------------------------------------
  // Picking — fila e aceite
  // ---------------------------------------------------------------------------

  app.get("/mobile/orders/queue", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const waveOrderIds = await getOrderIdsInActiveWave(tenantId);
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        status: OrderStatus.PENDING,
        ...(waveOrderIds.length > 0 ? { id: { notIn: waveOrderIds } } : {}),
      },
      orderBy: [
        { priority: "desc" },
        { collectionDeadline: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      include: {
        items: { include: { product: true } },
      },
    });
    return orders.map((o) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      priority: o.priority,
      customerName: o.customerName,
      collectionDeadline: o.collectionDeadline?.toISOString() ?? null,
      itemCount: o.items.length,
      totalUnits: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
    }));
  });

  app.post<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/accept",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;

      const tenantId = request.authUser!.tenantId!;
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId },
        include: { waveOrders: true },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });
      if (order.status !== OrderStatus.PENDING) {
        return reply.status(409).send({ error: "Pedido não está na fila" });
      }
      if (order.waveOrders.length > 0) {
        return reply.status(409).send({
          error: "Pedido está em uma onda ativa — use separação em onda",
        });
      }

      const result = await prisma.order.updateMany({
        where: { id: orderId, tenantId, status: OrderStatus.PENDING },
        data: {
          status: OrderStatus.PICKING,
          assignedPickerId: userId,
        },
      });
      if (result.count === 0) {
        return reply.status(409).send({
          error: "Pedido já aceito ou indisponível na fila",
        });
      }
      return { id: orderId, status: OrderStatus.PICKING };
    }
  );

  app.post<{ Params: { orderId: string }; Body: { basketBarcode: string } }>(
    "/mobile/orders/:orderId/basket",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;
      const { basketBarcode } = request.body ?? {};

      if (!basketBarcode?.trim()) {
        return reply.status(400).send({ error: "Código da cesta obrigatório" });
      }

      const basket = await prisma.basket.findFirst({
        where: { barcode: basketBarcode.trim(), active: true },
      });
      if (!basket) return reply.status(404).send({ error: "Cesta não encontrada" });

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: { basketId: basket.id },
        }),
        prisma.orderTimeLog.create({
          data: {
            orderId,
            userId,
            event: OrderTimeLogEvent.START,
          },
        }),
      ]);

      return { basketId: basket.id, basketCode: basket.code };
    }
  );

  app.get<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/picking",
    async (request, reply) => {
      const { orderId } = request.params;
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          basket: true,
          items: {
            orderBy: { lineNumber: "asc" },
            include: {
              product: true,
              pickLocation: true,
            },
          },
        },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      const { pickNextItemByRoute, sortPendingItemsByRoute } = await import(
        "../services/location-route.js"
      );

      const isPending = (i: (typeof order.items)[0]) =>
        i.quantityPicked < i.quantityOrdered;

      const mapPickLoc = (loc: (typeof order.items)[0]["pickLocation"]) =>
        loc
          ? {
              id: loc.id,
              corridor: loc.corridor,
              row: loc.row,
              barcode: loc.barcode,
              label: formatLocation(loc),
              currentQuantity: loc.currentQuantity,
              capacity: loc.capacity,
              minThreshold: loc.minThreshold,
            }
          : null;

      const nextItem =
        pickNextItemByRoute(order.items, isPending, null) ??
        order.items.find(isPending);

      const routeQueue = sortPendingItemsByRoute(order.items, isPending, null);

      const remaining = nextItem
        ? nextItem.quantityOrdered - nextItem.quantityPicked
        : 0;

      return {
        order: {
          id: order.id,
          erpOrderId: order.erpOrderId,
          status: order.status,
          basket: order.basket,
          collectionDeadline: order.collectionDeadline?.toISOString() ?? null,
        },
        items: order.items.map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          quantityOrdered: item.quantityOrdered,
          quantityPicked: item.quantityPicked,
          product: item.product,
          pickLocation: mapPickLoc(item.pickLocation),
          completed: item.quantityPicked >= item.quantityOrdered,
        })),
        routeQueue: routeQueue.slice(0, 5).map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          pickLocation: mapPickLoc(item.pickLocation),
        })),
        nextItem: nextItem
          ? {
              id: nextItem.id,
              lineNumber: nextItem.lineNumber,
              quantityOrdered: nextItem.quantityOrdered,
              quantityPicked: nextItem.quantityPicked,
              remaining,
              product: nextItem.product,
              pickLocation: mapPickLoc(nextItem.pickLocation),
              stockMismatchHint:
                nextItem.pickLocation &&
                nextItem.pickLocation.currentQuantity < remaining
                  ? `Saldo na gôndola (${nextItem.pickLocation.currentQuantity}) menor que o pendente (${remaining})`
                  : null,
            }
          : null,
        allPicked: !nextItem,
      };
    }
  );

  app.post<{
    Params: { orderId: string; itemId: string };
    Body: { locationBarcode: string };
  }>(
    "/mobile/orders/:orderId/items/:itemId/validate-location",
    async (request, reply) => {
      const { orderId, itemId } = request.params;
      const { locationBarcode } = request.body ?? {};

      const item = await prisma.orderItem.findFirst({
        where: { id: itemId, orderId },
        include: { pickLocation: true },
      });
      if (!item) return reply.status(404).send({ error: "Item não encontrado" });
      if (!item.pickLocation) {
        return reply.status(400).send({ error: "Item sem localização de pick" });
      }
      if (item.pickLocation.barcode !== locationBarcode?.trim()) {
        return reply.status(400).send({
          error: "Gôndola incorreta",
          expected: item.pickLocation.barcode,
        });
      }
      return { valid: true, location: formatLocation(item.pickLocation) };
    }
  );

  app.post<{
    Params: { orderId: string; itemId: string };
    Body: { quantity: number };
  }>(
    "/mobile/orders/:orderId/items/:itemId/pick",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId, itemId } = request.params;
      const quantity = Number(request.body?.quantity ?? 0);

      if (quantity <= 0) {
        return reply.status(400).send({ error: "Quantidade inválida" });
      }

      const item = await prisma.orderItem.findFirst({
        where: { id: itemId, orderId },
        include: {
          product: true,
          pickLocation: true,
          order: { select: { tenantId: true } },
        },
      });
      if (!item) return reply.status(404).send({ error: "Item não encontrado" });

      const newPicked = Math.min(
        item.quantityPicked + quantity,
        item.quantityOrdered
      );
      const pickedDelta = newPicked - item.quantityPicked;

      await prisma.$transaction(async (tx) => {
        await tx.orderItem.update({
          where: { id: itemId },
          data: { quantityPicked: newPicked },
        });

        if (pickedDelta > 0 && item.pickLocationId) {
          await tx.location.update({
            where: { id: item.pickLocationId },
            data: {
              currentQuantity: { decrement: pickedDelta },
            },
          });
          await tx.inventoryMovement.create({
            data: {
              tenantId: item.order.tenantId,
              type: InventoryMovementType.PICK_ALLOCATION,
              quantity: pickedDelta,
              userId,
              productId: item.productId,
              fromLocationId: item.pickLocationId,
              orderId,
            },
          });
        }
      });

      return {
        quantityPicked: newPicked,
        completed: newPicked >= item.quantityOrdered,
      };
    }
  );

  app.post<{ Params: { orderId: string }; Body: { reason: string } }>(
    "/mobile/orders/:orderId/report-issue",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;
      const reason = request.body?.reason?.trim() || "Problema reportado no mobile";

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.PAUSED_ISSUE },
        }),
        prisma.orderTimeLog.create({
          data: {
            orderId,
            userId,
            event: OrderTimeLogEvent.PAUSE,
            reason,
          },
        }),
      ]);

      return { status: OrderStatus.PAUSED_ISSUE, notified: true };
    }
  );

  app.post<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/complete-picking",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      const incomplete = order.items.some(
        (i) => i.quantityPicked < i.quantityOrdered
      );
      if (incomplete) {
        return reply.status(400).send({ error: "Ainda há itens pendentes" });
      }

      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.PICKED_AWAITING_CONFERENCE },
        }),
        prisma.orderTimeLog.create({
          data: {
            orderId,
            userId,
            event: OrderTimeLogEvent.END,
          },
        }),
      ]);

      return { status: OrderStatus.PICKED_AWAITING_CONFERENCE };
    }
  );

  // ---------------------------------------------------------------------------
  // Replenishment
  // ---------------------------------------------------------------------------

  app.get<{ Params: { barcode: string } }>(
    "/mobile/locations/barcode/:barcode",
    async (request, reply) => {
      const barcode = decodeURIComponent(request.params.barcode);
      const location = await prisma.location.findFirst({
        where: { barcode, active: true },
        include: { product: true },
      });
      if (!location) return reply.status(404).send({ error: "Gôndola não encontrada" });

      return {
        id: location.id,
        corridor: location.corridor,
        row: location.row,
        barcode: location.barcode,
        type: location.type,
        currentQuantity: location.currentQuantity,
        capacity: location.capacity,
        minThreshold: location.minThreshold,
        label: formatLocation(location),
        product: location.product,
        needsReplenishment: location.currentQuantity <= location.minThreshold,
      };
    }
  );

  app.post<{
    Params: { locationId: string };
    Body: {
      countedQuantity?: number;
      productBarcode?: string;
      reason?: string;
      orderId?: string;
      itemId?: string;
      waveLineId?: string;
    };
  }>(
    "/mobile/locations/:locationId/adjust-quantity",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        return await adjustLocationQuantity({
          tenantId,
          userId,
          locationId: request.params.locationId,
          countedQuantity: Number(request.body?.countedQuantity),
          productBarcode: request.body?.productBarcode,
          reason: request.body?.reason,
          orderId: request.body?.orderId,
          itemId: request.body?.itemId,
          waveLineId: request.body?.waveLineId,
        });
      } catch (e) {
        if (e instanceof LocationAdjustError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { barcode: string };
    Body: {
      countedQuantity?: number;
      productBarcode?: string;
      reason?: string;
      orderId?: string;
      itemId?: string;
      waveLineId?: string;
    };
  }>(
    "/mobile/locations/barcode/:barcode/adjust-quantity",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        return await adjustLocationQuantity({
          tenantId,
          userId,
          barcode: decodeURIComponent(request.params.barcode),
          countedQuantity: Number(request.body?.countedQuantity),
          productBarcode: request.body?.productBarcode,
          reason: request.body?.reason,
          orderId: request.body?.orderId,
          itemId: request.body?.itemId,
          waveLineId: request.body?.waveLineId,
        });
      } catch (e) {
        if (e instanceof LocationAdjustError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { locationId: string };
    Body: { quantity: number; productBarcode?: string };
  }>(
    "/mobile/locations/:locationId/replenish",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { locationId } = request.params;
      const quantity = Number(request.body?.quantity ?? 0);
      const productBarcode = request.body?.productBarcode?.trim();

      if (quantity <= 0) {
        return reply.status(400).send({ error: "Quantidade inválida" });
      }

      const location = await prisma.location.findUnique({
        where: { id: locationId },
        include: { product: true },
      });
      if (!location) return reply.status(404).send({ error: "Gôndola não encontrada" });
      if (location.type !== "PICK_FACE") {
        return reply.status(400).send({ error: "Reabastecimento apenas em gôndolas" });
      }

      if (productBarcode && location.product?.barcode !== productBarcode) {
        return reply
          .status(400)
          .send({ error: "Produto não corresponde à gôndola" });
      }

      const newQty = Math.min(
        location.currentQuantity + quantity,
        location.capacity
      );
      const added = newQty - location.currentQuantity;

      if (added <= 0) {
        return reply.status(400).send({ error: "Gôndola já está na capacidade máxima" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.location.update({
          where: { id: locationId },
          data: { currentQuantity: newQty },
        });
        if (location.productId) {
          await tx.inventoryMovement.create({
            data: {
              tenantId: location.tenantId,
              type: InventoryMovementType.REPLENISHMENT,
              quantity: added,
              userId,
              productId: location.productId,
              toLocationId: locationId,
              notes: "Reabastecimento via mobile",
            },
          });
        }
      });

      return {
        currentQuantity: newQty,
        added,
      };
    }
  );

  app.post<{
    Params: { locationId: string };
    Body: { productBarcode?: string; quantity?: number };
  }>(
    "/mobile/locations/:locationId/stock",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const productBarcode = request.body?.productBarcode?.trim() ?? "";

      try {
        const result = await stockLocation({
          locationId: request.params.locationId,
          productBarcode,
          quantity: request.body?.quantity,
          userId,
        });
        return result;
      } catch (e) {
        if (e instanceof LocationStockError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Body: {
      fromLocationBarcode?: string;
      toLocationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/replenishment/transfer", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    try {
      const from = request.body?.fromLocationBarcode ?? "";
      const to = request.body?.toLocationBarcode ?? "";
      const productBarcode = request.body?.productBarcode ?? "";
      const quantity = Number(request.body?.quantity ?? 0);
      const withdrawn = await withdrawCargoTransfer({
        tenantId,
        userId,
        fromLocationBarcode: from,
        productBarcode,
        quantity,
      });
      const deposited = await depositCargoTransfer({
        tenantId,
        userId,
        transferId: withdrawn.transfer.id,
        toLocationBarcode: to,
        productBarcode,
        quantity,
      });
      return {
        transfer: deposited.transfer,
        fromLocation: withdrawn.fromLocation,
        toLocation: deposited.toLocation,
        transferred: quantity,
        legacy: true,
      };
    } catch (e) {
      if (e instanceof CargoTransferError || e instanceof LocationTransferError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get("/mobile/replenishment/needs", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const { listReplenishmentNeeds } = await import(
      "../services/replenishment-queue.js"
    );
    return { needs: await listReplenishmentNeeds(tenantId) };
  });

  app.post<{
    Body: {
      fromLocationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
      targetPickFaceId?: string;
    };
  }>("/mobile/cargo-transfers/withdraw", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    try {
      return await withdrawCargoTransfer({
        tenantId,
        userId,
        fromLocationBarcode: request.body?.fromLocationBarcode ?? "",
        productBarcode: request.body?.productBarcode ?? "",
        quantity: Number(request.body?.quantity ?? 0),
        targetPickFaceId: request.body?.targetPickFaceId,
      });
    } catch (e) {
      if (e instanceof CargoTransferError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get("/mobile/cargo-transfers/pending", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    return {
      transfers: await listPendingCargoTransfers(tenantId),
    };
  });

  app.get<{ Params: { id: string } }>(
    "/mobile/cargo-transfers/:id",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      try {
        return await getCargoTransfer(tenantId, request.params.id);
      } catch (e) {
        if (e instanceof CargoTransferError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/mobile/cargo-transfers/:id/suggest-face",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      try {
        const transfer = await getCargoTransfer(tenantId, request.params.id);
        const { suggestPickFaceDeposit } = await import(
          "../services/pick-face-resolve.js"
        );
        const loc = await suggestPickFaceDeposit(
          tenantId,
          transfer.product.id,
          transfer.quantity,
        );
        if (!loc) {
          return reply.status(404).send({
            error: "Nenhum endereço de estoque de giro disponível",
          });
        }
        return {
          suggested: {
            barcode: loc.barcode,
            corridor: loc.corridor,
            row: loc.row,
            currentQuantity: loc.currentQuantity,
            capacity: loc.capacity,
            label: `${loc.corridor}-${loc.row}`,
          },
        };
      } catch (e) {
        if (e instanceof CargoTransferError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      toLocationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/cargo-transfers/:id/deposit", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    try {
      return await depositCargoTransfer({
        tenantId,
        userId,
        transferId: request.params.id,
        toLocationBarcode: request.body?.toLocationBarcode ?? "",
        productBarcode: request.body?.productBarcode,
        quantity: request.body?.quantity,
      });
    } catch (e) {
      if (e instanceof CargoTransferError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // ---------------------------------------------------------------------------
  // Pick wave
  // ---------------------------------------------------------------------------

  function mapWaveMobilePayload(
    wave: NonNullable<Awaited<ReturnType<typeof getReleasedWaveById>>>,
    userId: string,
  ) {
    const canWork = !wave.acceptedById || wave.acceptedById === userId;
    const waveOrders = wave.orders.map((wo) => wo.order);
    let collectionDeadline: Date | null = null;
    for (const o of waveOrders) {
      if (o.collectionDeadline) {
        if (
          !collectionDeadline ||
          o.collectionDeadline.getTime() < collectionDeadline.getTime()
        ) {
          collectionDeadline = o.collectionDeadline;
        }
      }
    }
    return {
      wave: {
        id: wave.id,
        name: wave.name,
        status: wave.status,
        releasedAt: wave.releasedAt,
        orderCount: wave.orders.length,
        gondolaPasses: wave.lines.length,
        acceptedById: wave.acceptedById,
        acceptedByName: wave.acceptedBy?.name ?? null,
        acceptedAt: wave.acceptedAt,
        canAccept: !wave.acceptedById,
        canWork,
        isMine: wave.acceptedById === userId,
        collectionDeadline: collectionDeadline?.toISOString() ?? null,
      },
      lines: canWork ? wave.lines.map(mapWaveLineSummary) : [],
    };
  }

  app.get("/mobile/waves/released", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const { scorePackingUrgency } = await import(
      "../services/packing-queue-sort.js"
    );
    const waves = await listReleasedWaves(tenantId);
    const summaries = waves.map((w) => {
      const orders = w.orders.map((wo) => wo.order);
      const urgency = Math.max(
        ...orders.map((o) =>
          scorePackingUrgency({
            priority: o.priority,
            collectionDeadline: o.collectionDeadline,
            marketplace: o.marketplace,
          }),
        ),
        0,
      );
      let collectionDeadline: Date | null = null;
      for (const o of orders) {
        if (o.collectionDeadline) {
          if (
            !collectionDeadline ||
            o.collectionDeadline.getTime() < collectionDeadline.getTime()
          ) {
            collectionDeadline = o.collectionDeadline;
          }
        }
      }
      return {
        id: w.id,
        name: w.name,
        releasedAt: w.releasedAt,
        orderCount: w._count.orders,
        lineCount: w._count.lines,
        acceptedById: w.acceptedById,
        acceptedByName: w.acceptedBy?.name ?? null,
        packingUrgency: urgency,
        collectionDeadline: collectionDeadline?.toISOString() ?? null,
      };
    });
    summaries.sort((a, b) => b.packingUrgency - a.packingUrgency);
    return { waves: summaries };
  });

  app.get("/mobile/waves/current", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const userId = resolveUserId(request);
    const wave = await getCurrentReleasedWave(tenantId);
    if (!wave) {
      return reply.status(404).send({ error: "Nenhuma onda ativa" });
    }

    return mapWaveMobilePayload(wave, userId);
  });

  app.post("/mobile/waves/current/accept", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const userId = resolveUserId(request);
    const wave = await getCurrentReleasedWave(tenantId);
    if (!wave) {
      return reply.status(404).send({ error: "Nenhuma onda ativa" });
    }

    try {
      const result = await acceptPickWave(wave.id, userId);
      return result;
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get<{ Params: { waveId: string } }>(
    "/mobile/waves/:waveId",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const enabled = await isWaveEnabled(tenantId);
      if (!enabled) {
        return reply.status(404).send({ error: "Separação em onda desabilitada" });
      }

      const userId = resolveUserId(request);
      const wave = await getReleasedWaveById(tenantId, request.params.waveId);
      if (!wave) {
        return reply.status(404).send({ error: "Onda não encontrada" });
      }
      return mapWaveMobilePayload(wave, userId);
    },
  );

  app.post<{ Params: { waveId: string } }>(
    "/mobile/waves/:waveId/accept",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const enabled = await isWaveEnabled(tenantId);
      if (!enabled) {
        return reply.status(404).send({ error: "Separação em onda desabilitada" });
      }

      const userId = resolveUserId(request);
      try {
        return await acceptPickWave(request.params.waveId, userId);
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get("/mobile/config", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const waveEnabled = await isWaveEnabled(tenantId);
    return { waveEnabled };
  });

  app.get<{ Params: { lineId: string } }>(
    "/mobile/waves/lines/:lineId",
    async (request, reply) => {
      try {
        const line = await getWaveLineDetail(request.params.lineId);
        if (!line) {
          return reply.status(404).send({ error: "Linha não encontrada" });
        }
        return { line };
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { lineId: string };
    Body: {
      locationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/waves/lines/:lineId/pick", async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      return await confirmConsolidatedPick({
        lineId: request.params.lineId,
        locationBarcode: request.body?.locationBarcode ?? "",
        productBarcode: request.body?.productBarcode,
        quantity: Number(request.body?.quantity ?? 0),
        userId,
      });
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.post<{
    Params: { lineId: string };
    Body: {
      allocationId?: string;
      quantity?: number;
      basketBarcode?: string;
    };
  }>("/mobile/waves/lines/:lineId/sort", async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      return await confirmSortAllocation({
        lineId: request.params.lineId,
        allocationId: request.body?.allocationId ?? "",
        quantity: Number(request.body?.quantity ?? 0),
        basketBarcode: request.body?.basketBarcode,
        userId,
      });
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // ---------------------------------------------------------------------------
  // Recebimento / conferência de compra (NF entrada — Tiny)
  // ---------------------------------------------------------------------------

  app.get("/mobile/purchase-receipts/queue", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    try {
      const queue = await listPurchaseReceiptQueue(tenantId);
      return { queue };
    } catch (e) {
      if (isTinyConnectedError(e)) {
        return reply.status(503).send({
          error:
            "Tiny ERP não conectado. Peça ao administrador para conectar em Integrações.",
        });
      }
      const message = e instanceof Error ? e.message : "Erro ao listar notas";
      return reply.status(422).send({ error: message });
    }
  });

  app.post<{ Body: { barcode?: string } }>(
    "/mobile/purchase-receipts/start",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código DANFE obrigatório" });
      }
      try {
        const tenantId = request.authUser!.tenantId!;
        return await startPurchaseReceiptByBarcode({
          tenantId,
          barcode,
          userId,
        });
      } catch (e) {
        if (isTinyConnectedError(e)) {
          return reply.status(503).send({
            error: "Tiny ERP não conectado.",
          });
        }
        const message =
          e instanceof Error ? e.message : "Erro ao iniciar recebimento";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/:sessionId",
    async (request, reply) => {
      try {
        return await getPurchaseReceiptSession(request.params.sessionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sessão não encontrada";
        return reply.status(404).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { barcode?: string; quantity?: number };
  }>(
    "/mobile/purchase-receipts/:sessionId/scan",
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código do produto obrigatório" });
      }
      try {
        return await scanPurchaseReceiptItem({
          sessionId: request.params.sessionId,
          barcode,
          quantity: request.body?.quantity,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao registrar bip";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { itemId?: string; quantity?: number };
  }>(
    "/mobile/purchase-receipts/:sessionId/confirm-item",
    async (request, reply) => {
      const { itemId, quantity } = request.body ?? {};
      if (!itemId) {
        return reply.status(400).send({ error: "itemId obrigatório" });
      }
      try {
        return await confirmReceiptItem(
          request.params.sessionId,
          itemId,
          Number(quantity ?? 1),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao confirmar item";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/:sessionId/conference-start",
    async (request, reply) => {
      const userId = resolveUserId(request);
      try {
        await markConferenceStarted(request.params.sessionId, userId);
        return { ok: true };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao iniciar conferência";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/:sessionId/complete",
    async (request, reply) => {
      const userId = resolveUserId(request);
      try {
        return await completePurchaseReceipt(request.params.sessionId, userId);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar conferência";
        return reply.status(422).send({ error: message });
      }
    },
  );

  // Devolução (recebimento caminhão)
  app.post<{ Body: { reference?: string } }>(
    "/mobile/purchase-receipts/return/start",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        const { startReturnReceiptSession } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await startReturnReceiptSession({
          tenantId,
          userId,
          reference: request.body?.reference,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao iniciar devolução";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/return/:sessionId",
    async (request, reply) => {
      try {
        const { getReturnReceiptSession } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await getReturnReceiptSession(request.params.sessionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sessão não encontrada";
        return reply.status(404).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { barcode?: string; quantity?: number };
  }>(
    "/mobile/purchase-receipts/return/:sessionId/scan",
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código do produto obrigatório" });
      }
      try {
        const { scanReturnReceiptProduct } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await scanReturnReceiptProduct({
          sessionId: request.params.sessionId,
          barcode,
          quantity: request.body?.quantity,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao registrar bip";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { pulmaoLocationBarcode?: string };
  }>(
    "/mobile/purchase-receipts/return/:sessionId/complete",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const pulmaoLocationBarcode = request.body?.pulmaoLocationBarcode?.trim();
      if (!pulmaoLocationBarcode) {
        return reply.status(400).send({ error: "Bipe o pulmão de destino" });
      }
      try {
        const { completeReturnReceipt } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await completeReturnReceipt({
          sessionId: request.params.sessionId,
          userId,
          pulmaoLocationBarcode,
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar devolução";
        return reply.status(422).send({ error: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Armazenagem (putaway pós-recebimento)
  // ---------------------------------------------------------------------------

  app.get("/mobile/putaway/queue", async (_request, reply) => {
    try {
      const queue = await listPutawayQueue();
      return { queue };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao listar fila";
      return reply.status(422).send({ error: message });
    }
  });

  app.post<{ Body: { purchaseReceiptId?: string } }>(
    "/mobile/putaway/start",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const purchaseReceiptId = request.body?.purchaseReceiptId?.trim();
      if (!purchaseReceiptId) {
        return reply.status(400).send({ error: "purchaseReceiptId obrigatório" });
      }
      try {
        return await startPutaway(purchaseReceiptId, userId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao iniciar armazenagem";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/mobile/putaway/:sessionId",
    async (request, reply) => {
      try {
        return await getPutawaySession(request.params.sessionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sessão não encontrada";
        return reply.status(404).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: {
      itemId?: string;
      locationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/putaway/:sessionId/store", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId, locationBarcode, productBarcode } = request.body ?? {};
    if (!itemId || !locationBarcode) {
      return reply.status(400).send({ error: "itemId e local são obrigatórios" });
    }
    try {
      return await storePutawayItem({
        sessionId: request.params.sessionId,
        itemId,
        locationBarcode,
        productBarcode: productBarcode?.trim() || undefined,
        quantity: Number(request.body?.quantity ?? 1),
        userId,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao armazenar";
      return reply.status(422).send({ error: message });
    }
  });

  app.post<{ Params: { sessionId: string } }>(
    "/mobile/putaway/:sessionId/complete",
    async (request, reply) => {
      try {
        return await completePutaway(request.params.sessionId);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar armazenagem";
        return reply.status(422).send({ error: message });
      }
    },
  );
}
