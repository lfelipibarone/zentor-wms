import { OrderTimeLogEvent } from "@prisma/client";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export async function ensurePickingStartLog(
  tx: Tx,
  orderId: string,
  userId: string,
) {
  const existingStart = await tx.orderTimeLog.findFirst({
    where: { orderId, event: OrderTimeLogEvent.START },
    orderBy: { createdAt: "desc" },
  });
  if (!existingStart) {
    await tx.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.START },
    });
    return;
  }
  const endAfterStart = await tx.orderTimeLog.findFirst({
    where: {
      orderId,
      event: OrderTimeLogEvent.END,
      createdAt: { gt: existingStart.createdAt },
    },
  });
  if (endAfterStart) {
    await tx.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.START },
    });
  }
}

export async function ensurePickingEndLog(
  tx: Tx,
  orderId: string,
  userId: string,
) {
  const lastStart = await tx.orderTimeLog.findFirst({
    where: {
      orderId,
      event: {
        in: [OrderTimeLogEvent.START, OrderTimeLogEvent.RESUME],
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!lastStart) return;

  const endAfterStart = await tx.orderTimeLog.findFirst({
    where: {
      orderId,
      event: OrderTimeLogEvent.END,
      createdAt: { gt: lastStart.createdAt },
    },
  });
  if (endAfterStart) return;

  await tx.orderTimeLog.create({
    data: { orderId, userId, event: OrderTimeLogEvent.END },
  });
}

export async function ensurePackStartLog(
  tx: Tx,
  orderId: string,
  userId: string,
) {
  const lastStart = await tx.orderTimeLog.findFirst({
    where: { orderId, event: OrderTimeLogEvent.PACK_START },
    orderBy: { createdAt: "desc" },
  });
  if (!lastStart) {
    await tx.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_START },
    });
    return;
  }
  const endAfterStart = await tx.orderTimeLog.findFirst({
    where: {
      orderId,
      event: OrderTimeLogEvent.PACK_END,
      createdAt: { gt: lastStart.createdAt },
    },
  });
  if (endAfterStart) {
    await tx.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_START },
    });
  }
}

export async function ensurePackEndLog(
  tx: Tx,
  orderId: string,
  userId: string,
) {
  const lastStart = await tx.orderTimeLog.findFirst({
    where: { orderId, event: OrderTimeLogEvent.PACK_START },
    orderBy: { createdAt: "desc" },
  });
  if (!lastStart) return;

  const endAfterStart = await tx.orderTimeLog.findFirst({
    where: {
      orderId,
      event: OrderTimeLogEvent.PACK_END,
      createdAt: { gt: lastStart.createdAt },
    },
  });
  if (endAfterStart) return;

  await tx.orderTimeLog.create({
    data: { orderId, userId, event: OrderTimeLogEvent.PACK_END },
  });
}

export async function ensureResumeAfterPause(
  tx: Tx,
  orderId: string,
  userId: string,
) {
  const lastPause = await tx.orderTimeLog.findFirst({
    where: { orderId, event: OrderTimeLogEvent.PAUSE },
    orderBy: { createdAt: "desc" },
  });
  if (!lastPause) return;

  const resumed = await tx.orderTimeLog.findFirst({
    where: {
      orderId,
      event: {
        in: [OrderTimeLogEvent.RESUME, OrderTimeLogEvent.END],
      },
      createdAt: { gt: lastPause.createdAt },
    },
  });
  if (resumed) return;

  await tx.orderTimeLog.create({
    data: { orderId, userId, event: OrderTimeLogEvent.RESUME },
  });
}
