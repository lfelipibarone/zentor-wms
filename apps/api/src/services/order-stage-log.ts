import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface RecordStageChangeInput {
  tenantId: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  userId?: string | null;
  reason?: string | null;
}

export async function recordOrderStageChange(
  db: DbClient,
  input: RecordStageChangeInput,
) {
  if (input.fromStatus === input.toStatus) return null;
  return db.orderStageLog.create({
    data: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      userId: input.userId ?? null,
      reason: input.reason ?? null,
    },
  });
}

export async function recordOrderStatusUpdate(
  db: DbClient,
  params: {
    tenantId: string;
    orderId: string;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
    userId?: string | null;
    reason?: string | null;
  },
) {
  await db.order.update({
    where: { id: params.orderId },
    data: { status: params.toStatus },
  });
  await recordOrderStageChange(db, {
    tenantId: params.tenantId,
    orderId: params.orderId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    userId: params.userId,
    reason: params.reason,
  });
}
