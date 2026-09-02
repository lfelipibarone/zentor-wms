import {
  OrderStatus,
  OrderTimeLogEvent,
  PickWaveLineSortStatus,
  PickWaveStatus,
  type PrismaClient,
} from "@prisma/client";

type SeedProduct = { id: string; sku: string; name: string };
type SeedLocation = { id: string; barcode: string; productId: string | null };

export type SeedFlowStagesInput = {
  tenantId: string;
  pickerId: string;
  operadorId: string;
  products: SeedProduct[];
  /** Apenas PICK_FACE com produto — pedidos OK. */
  pickFaces: SeedLocation[];
  baskets: Array<{ id: string; code: string }>;
  /** Produto cadastrado sem gôndola de giro → PAUSED_ISSUE. */
  productWithoutPickFace: SeedProduct;
};

function demoLabelUrl(filename: string): string {
  const base = (process.env.API_PUBLIC_URL ?? "http://localhost:3333").replace(
    /\/$/,
    "",
  );
  return `${base}/demo/labels/${filename}`;
}

function deadlineHoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Um pedido (e uma onda) por etapa do fluxo — web + packing + app mobile.
 * Ids ERP estáveis: DEMO-{STATUS}-01
 */
export async function seedFlowStages(
  prisma: PrismaClient,
  input: SeedFlowStagesInput,
) {
  const {
    tenantId,
    pickerId,
    operadorId,
    products,
    pickFaces,
    baskets,
    productWithoutPickFace,
  } = input;

  const [p0, p1, p2] = products;
  const loc0 = pickFaces.find((l) => l.productId === p0?.id) ?? pickFaces[0]!;
  const loc1 = pickFaces.find((l) => l.productId === p1?.id) ?? pickFaces[1]!;
  const loc2 = pickFaces.find((l) => l.productId === p2?.id) ?? pickFaces[2]!;
  const basket0 = baskets[0]!;
  const basket1 = baskets[1]!;
  const basket2 = baskets[2] ?? baskets[0]!;
  const basket3 = baskets[3] ?? baskets[1]!;

  if (!p0 || !p1 || !p2) {
    throw new Error("seedFlowStages: precisa de pelo menos 3 produtos");
  }
  if (pickFaces.length < 3) {
    throw new Error("seedFlowStages: precisa de pelo menos 3 gôndolas de giro");
  }

  const labelUrl = demoLabelUrl("tiny-etiqueta-171579.zpl");
  const labelSampleUrl = demoLabelUrl("tiny-etiqueta-sample.zpl");

  type StageOrder = {
    erpOrderId: string;
    status: OrderStatus;
    customerName: string;
    marketplace: string;
    priority: number;
    basketId?: string;
    assignedPickerId?: string;
    shippingLabel?: string | null;
    collectionDeadline?: Date;
    dispatchedAt?: Date;
    notes?: string;
    items: Array<{
      lineNumber: number;
      productId?: string | null;
      erpSku?: string;
      erpDescription?: string;
      pickLocationId?: string | null;
      quantityOrdered: number;
      quantityPicked: number;
      quantityPacked: number;
    }>;
  };

  const stages: StageOrder[] = [
    {
      erpOrderId: "DEMO-PENDING-01",
      status: OrderStatus.PENDING,
      customerName: "Cliente Aguardando Separação",
      marketplace: "MERCADO_LIVRE",
      priority: 80,
      collectionDeadline: deadlineHoursFromNow(6),
      notes: "Seed: fila mobile / aba Aguardando separação",
      items: [
        {
          lineNumber: 1,
          productId: p0.id,
          pickLocationId: loc0.id,
          quantityOrdered: 2,
          quantityPicked: 0,
          quantityPacked: 0,
        },
        {
          lineNumber: 2,
          productId: p1.id,
          pickLocationId: loc1.id,
          quantityOrdered: 1,
          quantityPicked: 0,
          quantityPacked: 0,
        },
      ],
    },
    {
      erpOrderId: "DEMO-PICKING-01",
      status: OrderStatus.PICKING,
      customerName: "Cliente Em Separação",
      marketplace: "SHOPEE",
      priority: 70,
      basketId: basket0.id,
      assignedPickerId: pickerId,
      collectionDeadline: deadlineHoursFromNow(4),
      notes: "Seed: picking em andamento no app",
      items: [
        {
          lineNumber: 1,
          productId: p0.id,
          pickLocationId: loc0.id,
          quantityOrdered: 3,
          quantityPicked: 1,
          quantityPacked: 0,
        },
        {
          lineNumber: 2,
          productId: p2.id,
          pickLocationId: loc2.id,
          quantityOrdered: 1,
          quantityPicked: 0,
          quantityPacked: 0,
        },
      ],
    },
    {
      erpOrderId: "DEMO-PAUSED-01",
      status: OrderStatus.PAUSED_ISSUE,
      customerName: "Cliente Pausado (SKU faltando)",
      marketplace: "AMAZON",
      priority: 40,
      notes: "Seed: PAUSED_ISSUE — produto ERP sem cadastro WMS (como Tiny)",
      items: [
        {
          lineNumber: 1,
          productId: null,
          erpSku: "SKU-INEXISTENTE-ERP",
          erpDescription: "Produto ainda não cadastrado no WMS",
          pickLocationId: null,
          quantityOrdered: 1,
          quantityPicked: 0,
          quantityPacked: 0,
        },
      ],
    },
    {
      erpOrderId: "DEMO-PAUSED-NO-FACE-01",
      status: OrderStatus.PAUSED_ISSUE,
      customerName: "Cliente Pausado (sem estoque de giro)",
      marketplace: "OLIST",
      priority: 45,
      notes:
        "Seed: PAUSED_ISSUE — produto existe, mas sem Location PICK_FACE no layout",
      items: [
        {
          lineNumber: 1,
          productId: productWithoutPickFace.id,
          erpSku: productWithoutPickFace.sku,
          erpDescription: productWithoutPickFace.name,
          pickLocationId: null,
          quantityOrdered: 2,
          quantityPicked: 0,
          quantityPacked: 0,
        },
      ],
    },
    {
      erpOrderId: "DEMO-PACKING-01",
      status: OrderStatus.PICKED_AWAITING_CONFERENCE,
      customerName: "Cliente Packing + Etiqueta",
      marketplace: "OLIST",
      priority: 90,
      basketId: basket1.id,
      assignedPickerId: pickerId,
      shippingLabel: labelUrl,
      collectionDeadline: deadlineHoursFromNow(3),
      notes: "Seed: packing web — preview ZPL local sem Tiny",
      items: [
        {
          lineNumber: 1,
          productId: p0.id,
          pickLocationId: loc0.id,
          quantityOrdered: 2,
          quantityPicked: 2,
          quantityPacked: 0,
        },
        {
          lineNumber: 2,
          productId: p1.id,
          pickLocationId: loc1.id,
          quantityOrdered: 1,
          quantityPicked: 1,
          quantityPacked: 0,
        },
      ],
    },
    {
      erpOrderId: "TINY-862886936",
      status: OrderStatus.PICKED_AWAITING_CONFERENCE,
      customerName: "Rafael Garcia (prova etiqueta Tiny)",
      marketplace: "OLIST",
      priority: 95,
      basketId: basket2.id,
      assignedPickerId: pickerId,
      shippingLabel: labelUrl,
      collectionDeadline: deadlineHoursFromNow(2),
      notes: "Seed: pedido de prova 40A0133E85 / NF 171579",
      items: [
        {
          lineNumber: 1,
          productId: p0.id,
          pickLocationId: loc0.id,
          quantityOrdered: 1,
          quantityPicked: 1,
          quantityPacked: 0,
        },
      ],
    },
    {
      erpOrderId: "DEMO-RETURNED-01",
      status: OrderStatus.PACKING_RETURNED_TO_PICKING,
      customerName: "Cliente Retorno do Packing",
      marketplace: "MERCADO_LIVRE",
      priority: 85,
      basketId: basket3.id,
      assignedPickerId: pickerId,
      notes: "Seed: packing devolveu para re-separação",
      items: [
        {
          lineNumber: 1,
          productId: p1.id,
          pickLocationId: loc1.id,
          quantityOrdered: 2,
          quantityPicked: 1,
          quantityPacked: 0,
        },
      ],
    },
    {
      erpOrderId: "DEMO-DISPATCHING-01",
      status: OrderStatus.DISPATCHING,
      customerName: "Cliente Pronto para Expedir",
      marketplace: "SHOPEE",
      priority: 60,
      shippingLabel: labelSampleUrl,
      collectionDeadline: deadlineHoursFromNow(8),
      notes: "Seed: conferido — aguardando expedição",
      items: [
        {
          lineNumber: 1,
          productId: p2.id,
          pickLocationId: loc2.id,
          quantityOrdered: 1,
          quantityPicked: 1,
          quantityPacked: 1,
        },
      ],
    },
    {
      erpOrderId: "DEMO-DISPATCHED-01",
      status: OrderStatus.DISPATCHED,
      customerName: "Cliente Já Expedido",
      marketplace: "AMAZON",
      priority: 10,
      shippingLabel: labelSampleUrl,
      dispatchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      notes: "Seed: pedido finalizado",
      items: [
        {
          lineNumber: 1,
          productId: p0.id,
          pickLocationId: loc0.id,
          quantityOrdered: 1,
          quantityPicked: 1,
          quantityPacked: 1,
        },
      ],
    },
  ];

  const createdOrders: Array<{ id: string; erpOrderId: string; status: OrderStatus }> =
    [];

  for (const stage of stages) {
    const order = await prisma.order.create({
      data: {
        tenantId,
        erpOrderId: stage.erpOrderId,
        status: stage.status,
        customerName: stage.customerName,
        marketplace: stage.marketplace,
        priority: stage.priority,
        basketId: stage.basketId,
        assignedPickerId: stage.assignedPickerId,
        shippingLabel: stage.shippingLabel ?? null,
        collectionDeadline: stage.collectionDeadline,
        dispatchedAt: stage.dispatchedAt,
        notes: stage.notes,
        erpSource: stage.erpOrderId.startsWith("TINY-") ? "TINY" : "MANUAL",
        items: {
          create: stage.items.map((item) => ({
            lineNumber: item.lineNumber,
            productId: item.productId ?? undefined,
            erpSku: item.erpSku,
            erpDescription: item.erpDescription,
            pickLocationId: item.pickLocationId ?? undefined,
            quantityOrdered: item.quantityOrdered,
            quantityPicked: item.quantityPicked,
            quantityPacked: item.quantityPacked,
          })),
        },
      },
      select: { id: true, erpOrderId: true, status: true },
    });
    createdOrders.push(order);
  }

  // Pedido + onda liberada para teste no app (separação consolidada)
  const waveOrder = await prisma.order.create({
    data: {
      tenantId,
      erpOrderId: "DEMO-WAVE-ORDER-01",
      status: OrderStatus.PENDING,
      customerName: "Cliente Onda Mobile",
      marketplace: "MERCADO_LIVRE",
      priority: 75,
      collectionDeadline: deadlineHoursFromNow(5),
      notes: "Seed: pedido dentro de onda RELEASED",
      erpSource: "MANUAL",
      items: {
        create: [
          {
            lineNumber: 1,
            productId: p0.id,
            pickLocationId: loc0.id,
            quantityOrdered: 2,
            quantityPicked: 0,
            quantityPacked: 0,
          },
        ],
      },
    },
    include: { items: true },
  });

  const waveLineQty = waveOrder.items[0]!.quantityOrdered;
  const wave = await prisma.pickWave.create({
    data: {
      tenantId,
      name: "Onda Demo Seed",
      status: PickWaveStatus.RELEASED,
      marketplace: "MERCADO_LIVRE",
      partitionStrategy: "SINGLE_ITEM",
      releasedAt: new Date(),
      releasedById: operadorId,
      orders: {
        create: [{ orderId: waveOrder.id }],
      },
      lines: {
        create: [
          {
            productId: p0.id,
            pickLocationId: loc0.id,
            quantityTotal: waveLineQty,
            quantityPicked: 0,
            sortStatus: PickWaveLineSortStatus.PENDING,
            allocations: {
              create: [
                {
                  orderItemId: waveOrder.items[0]!.id,
                  quantity: waveLineQty,
                },
              ],
            },
          },
        ],
      },
    },
    select: { id: true, name: true },
  });

  createdOrders.push({
    id: waveOrder.id,
    erpOrderId: waveOrder.erpOrderId,
    status: waveOrder.status,
  });

  return {
    orders: createdOrders,
    wave,
    labelUrl,
  };
}

export function printFlowStagesGuide(
  result: Awaited<ReturnType<typeof seedFlowStages>>,
) {
  console.log("\n=== Fluxo seed (web + packing + app) ===\n");
  for (const o of result.orders) {
    console.log(`  ${o.status.padEnd(28)} ${o.erpOrderId}`);
  }
  console.log(`\n  Onda RELEASED: ${result.wave.name} (${result.wave.id})`);
  console.log(`  ZPL local:     ${result.labelUrl}`);
  console.log(
    "  Packing teste: DEMO-PACKING-01 ou TINY-862886936 (badge Etiqueta disponível)\n",
  );
}
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
