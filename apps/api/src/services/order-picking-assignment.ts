import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export class OrderPickingAssignmentError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "OrderPickingAssignmentError";
  }
}

export async function releaseOrderAccept(
  tenantId: string,
  orderId: string,
  userId: string,
): Promise<{ released: boolean; status: OrderStatus }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: true },
  });
  if (!order) {
    throw new OrderPickingAssignmentError("Pedido não encontrado", 404);
  }
  if (order.assignedPickerId !== userId) {
    throw new OrderPickingAssignmentError(
      "Este pedido não está atribuído a você",
      403,
    );
  }
  if (order.status !== OrderStatus.PICKING) {
    throw new OrderPickingAssignmentError(
      "Pedido não está em separação",
      409,
    );
  }
  if (order.basketId) {
    throw new OrderPickingAssignmentError(
      "Cesta já vinculada — não é possível cancelar o aceite",
      409,
    );
  }
  const hasPicked = order.items.some((i) => i.quantityPicked > 0);
  if (hasPicked) {
    throw new OrderPickingAssignmentError(
      "Separação já iniciada — não é possível cancelar o aceite",
      409,
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.PENDING,
      assignedPickerId: null,
    },
  });

  return { released: true, status: OrderStatus.PENDING };
}
