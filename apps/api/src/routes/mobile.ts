import type { FastifyInstance } from "fastify";
import { OrderStatus, OrderTimeLogEvent, InventoryMovementType } from "@prisma/client";
import { requireMobileAccess } from "../lib/auth-guard.js";
import { prisma } from "../lib/prisma.js";
import { resolveUserId } from "../lib/user-context.js";
import {
  LocationStockError,
  stockLocation,
} from "../services/location-stock.js";

function formatLocation(loc: { corridor: string; row: string; barcode: string }) {
  return `${loc.corridor}-${loc.row} · ${loc.barcode}`;
}

export async function mobileRoutes(app: FastifyInstance) {
  app.addHook("onRequest", requireMobileAccess);

  // ---------------------------------------------------------------------------
  // Picking — fila e aceite
  // ---------------------------------------------------------------------------

  app.get("/mobile/orders/queue", async () => {
    const orders = await prisma.order.findMany({
      where: { status: OrderStatus.PENDING },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        items: { include: { product: true } },
      },
    });
    return orders.map((o) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      priority: o.priority,
      customerName: o.customerName,
      itemCount: o.items.length,
      totalUnits: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
    }));
  });

  app.post<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/accept",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });
      if (order.status !== OrderStatus.PENDING) {
        return reply.status(409).send({ error: "Pedido não está na fila" });
      }

      const updated = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.PICKING,
          assignedPickerId: userId,
        },
      });
      return { id: updated.id, status: updated.status };
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

      const nextItem = order.items.find(
        (i) => i.quantityPicked < i.quantityOrdered
      );

      return {
        order: {
          id: order.id,
          erpOrderId: order.erpOrderId,
          status: order.status,
          basket: order.basket,
        },
        items: order.items.map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          quantityOrdered: item.quantityOrdered,
          quantityPicked: item.quantityPicked,
          product: item.product,
          pickLocation: item.pickLocation
            ? {
                ...item.pickLocation,
                label: formatLocation(item.pickLocation),
              }
            : null,
          completed: item.quantityPicked >= item.quantityOrdered,
        })),
        nextItem: nextItem
          ? {
              id: nextItem.id,
              lineNumber: nextItem.lineNumber,
              quantityOrdered: nextItem.quantityOrdered,
              quantityPicked: nextItem.quantityPicked,
              remaining: nextItem.quantityOrdered - nextItem.quantityPicked,
              product: nextItem.product,
              pickLocation: nextItem.pickLocation
                ? {
                    ...nextItem.pickLocation,
                    label: formatLocation(nextItem.pickLocation),
                  }
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
        include: { product: true, pickLocation: true },
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
}
