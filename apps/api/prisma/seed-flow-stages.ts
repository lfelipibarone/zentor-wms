import {
  OrderStatus,
  OrderTimeLogEvent,
  PrismaClient,
} from "@prisma/client";

function atToday(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

export async function seedFlowStageDemos(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    userId: string;
    productId: string;
    pickLocationId: string;
    basketId: string;
  },
) {
  const { tenantId, userId, productId, pickLocationId, basketId } = params;

  await prisma.orderTimeLog.deleteMany({
    where: { order: { tenantId, erpOrderId: { startsWith: "DEMO-STAGE-" } } },
  });
  await prisma.orderStageLog.deleteMany({
    where: { tenantId, order: { erpOrderId: { startsWith: "DEMO-STAGE-" } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { tenantId, erpOrderId: { startsWith: "DEMO-STAGE-" } } },
  });
  await prisma.order.deleteMany({
    where: { tenantId, erpOrderId: { startsWith: "DEMO-STAGE-" } },
  });

  const scenarios: Array<{
    erpOrderId: string;
    status: OrderStatus;
    pickMin: number;
    packMin: number;
    returnIssue?: { type: string; resolved: boolean };
  }> = [
    { erpOrderId: "DEMO-STAGE-001", status: OrderStatus.DISPATCHING, pickMin: 8, packMin: 5 },
    { erpOrderId: "DEMO-STAGE-002", status: OrderStatus.DISPATCHING, pickMin: 12, packMin: 7 },
    { erpOrderId: "DEMO-STAGE-003", status: OrderStatus.DISPATCHING, pickMin: 6, packMin: 4 },
    { erpOrderId: "DEMO-STAGE-004", status: OrderStatus.PICKED_AWAITING_CONFERENCE, pickMin: 10, packMin: 0 },
    {
      erpOrderId: "DEMO-STAGE-005",
      status: OrderStatus.PACKING_RETURNED_TO_PICKING,
      pickMin: 9,
      packMin: 3,
      returnIssue: { type: "MISSING", resolved: false },
    },
    {
      erpOrderId: "DEMO-STAGE-006",
      status: OrderStatus.DISPATCHING,
      pickMin: 11,
      packMin: 6,
      returnIssue: { type: "DAMAGED", resolved: true },
    },
    {
      erpOrderId: "DEMO-STAGE-007",
      status: OrderStatus.DISPATCHING,
      pickMin: 7,
      packMin: 5,
      returnIssue: { type: "WRONG_ITEM", resolved: true },
    },
  ];

  for (const scenario of scenarios) {
    const pickStart = atToday(9, 15);
    const pickEnd = minutesAfter(pickStart, scenario.pickMin);
    const packStart = minutesAfter(pickEnd, 2);
    const packEnd =
      scenario.packMin > 0 ? minutesAfter(packStart, scenario.packMin) : null;

    const order = await prisma.order.create({
      data: {
        tenantId,
        erpOrderId: scenario.erpOrderId,
        status: scenario.status,
        basketId,
        assignedPickerId: userId,
        customerName: "Cliente demo",
        marketplace: "MERCADO_LIVRE",
        items: {
          create: {
            lineNumber: 1,
            productId,
            pickLocationId,
            quantityOrdered: 2,
            quantityPicked: 2,
            quantityPacked: scenario.packMin > 0 ? 2 : 0,
          },
        },
      },
    });

    const timeLogs: Array<{
      event: OrderTimeLogEvent;
      createdAt: Date;
      reason?: string;
    }> = [
      { event: OrderTimeLogEvent.START, createdAt: pickStart },
      { event: OrderTimeLogEvent.END, createdAt: pickEnd },
    ];

    if (scenario.returnIssue) {
      const issueAt = minutesAfter(packStart, 1);
      timeLogs.push({
        event: OrderTimeLogEvent.PACK_START,
        createdAt: packStart,
      });
      timeLogs.push({
        event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
        createdAt: issueAt,
        reason: JSON.stringify({
          type: scenario.returnIssue.type,
          sku: "PAR-6X40",
          productName: "Parafuso 6x40 (caixa)",
          quantity: 1,
          description: "Demo seed",
        }),
      });
      timeLogs.push({
        event: OrderTimeLogEvent.PACK_CANCEL,
        createdAt: issueAt,
      });

      await prisma.orderStageLog.create({
        data: {
          tenantId,
          orderId: order.id,
          fromStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
          toStatus: OrderStatus.PACKING_RETURNED_TO_PICKING,
          userId,
          reason: timeLogs.find((l) => l.event === OrderTimeLogEvent.PACK_REPORT_ISSUE)?.reason,
          createdAt: issueAt,
        },
      });

      if (scenario.returnIssue.resolved) {
        const rePickStart = minutesAfter(issueAt, 15);
        const rePickEnd = minutesAfter(rePickStart, scenario.pickMin);
        const rePackStart = minutesAfter(rePickEnd, 1);
        const rePackEnd = minutesAfter(rePackStart, scenario.packMin);
        timeLogs.push(
          { event: OrderTimeLogEvent.START, createdAt: rePickStart },
          { event: OrderTimeLogEvent.END, createdAt: rePickEnd },
          { event: OrderTimeLogEvent.PACK_START, createdAt: rePackStart },
          { event: OrderTimeLogEvent.PACK_END, createdAt: rePackEnd },
        );
        await prisma.orderStageLog.create({
          data: {
            tenantId,
            orderId: order.id,
            fromStatus: OrderStatus.PACKING_RETURNED_TO_PICKING,
            toStatus: OrderStatus.PICKING,
            userId,
            createdAt: rePickStart,
          },
        });
        await prisma.orderStageLog.create({
          data: {
            tenantId,
            orderId: order.id,
            fromStatus: OrderStatus.PICKING,
            toStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
            userId,
            createdAt: rePickEnd,
          },
        });
        if (scenario.status === OrderStatus.DISPATCHING) {
          await prisma.orderStageLog.create({
            data: {
              tenantId,
              orderId: order.id,
              fromStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
              toStatus: OrderStatus.DISPATCHING,
              userId,
              createdAt: rePackEnd,
            },
          });
        }
      }
    } else if (packEnd) {
      timeLogs.push(
        { event: OrderTimeLogEvent.PACK_START, createdAt: packStart },
        { event: OrderTimeLogEvent.PACK_END, createdAt: packEnd },
      );
      await prisma.orderStageLog.create({
        data: {
          tenantId,
          orderId: order.id,
          fromStatus: OrderStatus.PICKING,
          toStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
          userId,
          createdAt: pickEnd,
        },
      });
      if (scenario.status === OrderStatus.DISPATCHING) {
        await prisma.orderStageLog.create({
          data: {
            tenantId,
            orderId: order.id,
            fromStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
            toStatus: OrderStatus.DISPATCHING,
            userId,
            createdAt: packEnd,
          },
        });
      }
    } else {
      await prisma.orderStageLog.create({
        data: {
          tenantId,
          orderId: order.id,
          fromStatus: OrderStatus.PICKING,
          toStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
          userId,
          createdAt: pickEnd,
        },
      });
    }

    await prisma.orderStageLog.create({
      data: {
        tenantId,
        orderId: order.id,
        fromStatus: OrderStatus.PENDING,
        toStatus: OrderStatus.PICKING,
        userId,
        createdAt: pickStart,
      },
    });

    for (const log of timeLogs) {
      await prisma.orderTimeLog.create({
        data: {
          orderId: order.id,
          userId,
          event: log.event,
          reason: log.reason,
          createdAt: log.createdAt,
        },
      });
    }
  }

  console.log("  Stage metrics demo: 7 pedidos DEMO-STAGE-* com logs de tempo");
}
