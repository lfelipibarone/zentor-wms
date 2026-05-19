import {
  InventoryMovementType,
  OrderStatus,
  OrderTimeLogEvent,
  PrismaClient,
} from "@prisma/client";
import { ALL_PERMISSION_KEYS, defaultPermissionsForRole } from "@wms/shared";
import { hashPassword } from "../src/lib/password.js";
import {
  DEMO_TENANT_CONFIGS,
  printTestUsersGuide,
  seedDemoTenant,
} from "./seed-demo-tenants.js";

const prisma = new PrismaClient();

function atToday(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function yesterdayAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: "default" },
    create: { name: "Default", slug: "default", active: true },
    update: { active: true },
  });
  const TENANT_ID = defaultTenant.id;

  await prisma.tinyConnection.upsert({
    where: { tenantId: TENANT_ID },
    create: { tenantId: TENANT_ID, name: "Tiny ERP" },
    update: {},
  });

  // --- Usuários ---
  const admin = await prisma.user.upsert({
    where: { email: "admin@wms.local" },
    create: {
      email: "admin@wms.local",
      name: "Administrador Help Route",
      password: hashPassword("admin123"),
      role: "ADMIN",
      isPlatformAdmin: true,
      tenantId: null,
      permissions: [...ALL_PERMISSION_KEYS],
    },
    update: {
      password: hashPassword("admin123"),
      role: "ADMIN",
      active: true,
      isPlatformAdmin: true,
      tenantId: null,
      permissions: [...ALL_PERMISSION_KEYS],
    },
  });

  const operador = await prisma.user.upsert({
    where: { email: "operador@wms.local" },
    create: {
      email: "operador@wms.local",
      name: "Felipe Figueiredo",
      password: hashPassword("operador123"),
      role: "EXPEDITER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: defaultPermissionsForRole("EXPEDITER"),
    },
    update: {
      password: hashPassword("operador123"),
      name: "Felipe Figueiredo",
      role: "EXPEDITER",
      active: true,
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: defaultPermissionsForRole("EXPEDITER"),
    },
  });

  const pickerPerms = defaultPermissionsForRole("PICKER");

  const pickerJoao = await prisma.user.upsert({
    where: { email: "picker@wms.local" },
    create: {
      email: "picker@wms.local",
      name: "João Separador",
      password: hashPassword("dev"),
      role: "PICKER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: pickerPerms,
    },
    update: {
      password: hashPassword("dev"),
      tenantId: TENANT_ID,
      permissions: pickerPerms,
    },
  });

  const pickerMaria = await prisma.user.upsert({
    where: { email: "maria@wms.local" },
    create: {
      email: "maria@wms.local",
      name: "Maria Silva",
      password: hashPassword("dev"),
      role: "PICKER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: pickerPerms,
    },
    update: {
      password: hashPassword("dev"),
      tenantId: TENANT_ID,
      permissions: pickerPerms,
    },
  });

  const pickerCarlos = await prisma.user.upsert({
    where: { email: "carlos@wms.local" },
    create: {
      email: "carlos@wms.local",
      name: "Carlos Mendes",
      password: hashPassword("dev"),
      role: "PICKER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: pickerPerms,
    },
    update: {
      password: hashPassword("dev"),
      tenantId: TENANT_ID,
      permissions: pickerPerms,
    },
  });

  const pickers = [pickerJoao, pickerMaria, pickerCarlos];

  // --- Configurações ---
  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId: TENANT_ID, key: "company.name" } },
    create: {
      tenantId: TENANT_ID,
      key: "company.name",
      value: "Help Route",
      description: "Nome exibido no sistema",
    },
    update: { value: "Help Route" },
  });

  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId: TENANT_ID, key: "warehouse.label" } },
    create: {
      tenantId: TENANT_ID,
      key: "warehouse.label",
      value: "CD Brasil · São Paulo",
      description: "Identificação do centro de distribuição",
    },
    update: { value: "CD Brasil · São Paulo" },
  });

  for (const row of [
    { key: "wave.enabled", value: "true", description: "Habilitar onda no mobile" },
    {
      key: "wave.autoRelease.enabled",
      value: "false",
      description: "Liberação automática diária",
    },
    {
      key: "wave.autoRelease.time",
      value: "06:30",
      description: "Horário liberação automática",
    },
    {
      key: "wave.autoRelease.maxOrders",
      value: "50",
      description: "Máximo pedidos por onda",
    },
    {
      key: "wave.onlyDeadlineToday",
      value: "false",
      description: "Somente pedidos com coleta hoje",
    },
    {
      key: "tiny.webhook.secret",
      value: "",
      description: "Token header x-tiny-token",
    },
  ]) {
    await prisma.systemSetting.upsert({
      where: { tenantId_key: { tenantId: TENANT_ID, key: row.key } },
      create: { tenantId: TENANT_ID, ...row },
      update: { value: row.value, description: row.description },
    });
  }

  // --- Produtos ---
  const products = await Promise.all([
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "PAR-6X40" } },
      create: {
        tenantId: TENANT_ID,
        sku: "PAR-6X40",
        name: "Parafuso 6x40 (caixa)",
        requiresItemScan: false,
        barcode: "7891000000001",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "MOT-220V" } },
      create: {
        tenantId: TENANT_ID,
        sku: "MOT-220V",
        name: "Motor 220V",
        requiresItemScan: true,
        barcode: "7891000000002",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "CAB-2M" } },
      create: {
        tenantId: TENANT_ID,
        sku: "CAB-2M",
        name: "Cabo elétrico 2m",
        requiresItemScan: false,
        barcode: "7891000000003",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "VAL-1/2" } },
      create: {
        tenantId: TENANT_ID,
        sku: "VAL-1/2",
        name: "Válvula 1/2 pol",
        requiresItemScan: true,
        barcode: "7891000000004",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "FUN-150" } },
      create: {
        tenantId: TENANT_ID,
        sku: "FUN-150",
        name: "Filtro UV 150W",
        requiresItemScan: false,
        barcode: "7891000000005",
      },
      update: {},
    }),
  ]);

  const [screw, motor, cable, valve, filter] = products;

  // --- Localizações (algumas abaixo do mínimo → alertas) ---
  const locations = await Promise.all([
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "LOC-A01-01" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "A",
        row: "01",
        barcode: "LOC-A01-01",
        type: "PICK_FACE",
        productId: screw.id,
        currentQuantity: 8,
        capacity: 100,
        minThreshold: 20,
      },
      update: { currentQuantity: 8 },
    }),
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "LOC-A02-01" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "A",
        row: "02",
        barcode: "LOC-A02-01",
        type: "PICK_FACE",
        productId: motor.id,
        currentQuantity: 1,
        capacity: 10,
        minThreshold: 2,
      },
      update: { currentQuantity: 1 },
    }),
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "LOC-B01-03" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "B",
        row: "01",
        barcode: "LOC-B01-03",
        type: "PICK_FACE",
        productId: cable.id,
        currentQuantity: 5,
        capacity: 80,
        minThreshold: 15,
      },
      update: { currentQuantity: 5 },
    }),
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "LOC-B02-02" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "B",
        row: "02",
        barcode: "LOC-B02-02",
        type: "PICK_FACE",
        productId: valve.id,
        currentQuantity: 12,
        capacity: 40,
        minThreshold: 10,
      },
      update: { currentQuantity: 12 },
    }),
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "LOC-C01-01" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "C",
        row: "01",
        barcode: "LOC-C01-01",
        type: "PICK_FACE",
        productId: filter.id,
        currentQuantity: 2,
        capacity: 30,
        minThreshold: 8,
      },
      update: { currentQuantity: 2 },
    }),
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "LOC-C02-04" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "C",
        row: "02",
        barcode: "LOC-C02-04",
        type: "PICK_FACE",
        productId: screw.id,
        currentQuantity: 45,
        capacity: 100,
        minThreshold: 20,
      },
      update: { currentQuantity: 45 },
    }),
  ]);

  const [locA, locB, locC, locD, locE] = locations;

  const pulmaoLocations = await Promise.all([
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "PUL-A01-01" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "P",
        row: "01",
        barcode: "PUL-A01-01",
        type: "PULMAO",
        productId: screw.id,
        currentQuantity: 500,
        capacity: 2000,
        minThreshold: 100,
      },
      update: { currentQuantity: 500 },
    }),
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "PUL-B01-01" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "P",
        row: "02",
        barcode: "PUL-B01-01",
        type: "PULMAO",
        productId: motor.id,
        currentQuantity: 80,
        capacity: 200,
        minThreshold: 20,
      },
      update: { currentQuantity: 80 },
    }),
    prisma.location.upsert({
      where: { tenantId_barcode: { tenantId: TENANT_ID, barcode: "PUL-C01-01" } },
      create: {
        tenantId: TENANT_ID,
        corridor: "P",
        row: "03",
        barcode: "PUL-C01-01",
        type: "PULMAO",
        productId: cable.id,
        currentQuantity: 300,
        capacity: 1000,
        minThreshold: 50,
      },
      update: { currentQuantity: 300 },
    }),
  ]);

  void pulmaoLocations;

  await prisma.basket.upsert({
    where: { tenantId_code: { tenantId: TENANT_ID, code: "CESTA-001" } },
    create: {
      tenantId: TENANT_ID,
      code: "CESTA-001",
      barcode: "BASKET001",
    },
    update: {},
  });

  // Limpa ondas e pedidos demo para re-seed idempotente
  await prisma.pickWaveAllocation.deleteMany({});
  await prisma.pickWaveLine.deleteMany({});
  await prisma.pickWaveOrder.deleteMany({});
  await prisma.pickWave.deleteMany({});
  await prisma.order.deleteMany({
    where: { tenantId: TENANT_ID, erpOrderId: { startsWith: "ERP-DEMO-" } },
  });

  const locCycle = [locA, locB, locC, locD, locE, locA];
  const prodCycle = [screw, motor, cable, valve, filter, screw];

  async function createDemoOrder(
    index: number,
    status: OrderStatus,
    opts?: {
      updatedAt?: Date;
      createdAt?: Date;
      dispatchedAt?: Date;
      quantityPicked?: number;
      assignedPickerId?: string;
      collectionDeadline?: Date;
      marketplace?: string;
      priority?: number;
    },
  ) {
    const loc = locCycle[index % locCycle.length]!;
    const prod = prodCycle[index % prodCycle.length]!;
    const qty = 5 + (index % 12);
    const picked = opts?.quantityPicked ?? (status === "PENDING" ? 0 : qty);

    return prisma.order.create({
      data: {
        tenantId: TENANT_ID,
        erpOrderId: `ERP-DEMO-${String(index).padStart(4, "0")}`,
        customerName: `Cliente Demo ${index + 1}`,
        status,
        priority: opts?.priority ?? index % 3,
        marketplace: opts?.marketplace ?? "MERCADO_LIVRE",
        collectionDeadline: opts?.collectionDeadline,
        assignedPickerId: opts?.assignedPickerId,
        createdAt: opts?.createdAt ?? new Date(),
        updatedAt: opts?.updatedAt ?? new Date(),
        dispatchedAt:
          status === OrderStatus.DISPATCHED
            ? (opts?.dispatchedAt ?? opts?.updatedAt ?? new Date())
            : undefined,
        items: {
          create: [
            {
              lineNumber: 1,
              productId: prod.id,
              quantityOrdered: qty,
              quantityPicked: picked,
              pickLocationId: loc.id,
            },
            {
              lineNumber: 2,
              productId: prodCycle[(index + 1) % prodCycle.length]!.id,
              quantityOrdered: 2 + (index % 4),
              quantityPicked: status === "PENDING" ? 0 : 2 + (index % 4),
              pickLocationId: locCycle[(index + 1) % locCycle.length]!.id,
            },
          ],
        },
      },
    });
  }

  // KPI: aguardando separação (~24) — deadlines escalonados para onda
  for (let i = 0; i < 24; i++) {
    const deadline = atToday(10 + Math.floor(i / 6), (i % 6) * 10);
    await createDemoOrder(i, OrderStatus.PENDING, {
      createdAt: atToday(7 + (i % 4)),
      collectionDeadline: deadline,
      marketplace: "MERCADO_LIVRE",
      priority: i < 6 ? 3 : i < 12 ? 2 : 1,
    });
  }

  // KPI: aguardando conferência (~11)
  for (let i = 24; i < 35; i++) {
    await createDemoOrder(i, OrderStatus.PICKED_AWAITING_CONFERENCE, {
      assignedPickerId: pickers[i % pickers.length]!.id,
      createdAt: atToday(8),
      updatedAt: atToday(10 + (i % 6)),
    });
  }

  // KPI: prontos para expedir (~18)
  for (let i = 35; i < 53; i++) {
    await createDemoOrder(i, OrderStatus.DISPATCHING, {
      createdAt: atToday(7),
      updatedAt: atToday(11 + (i % 5), (i * 7) % 60),
    });
  }

  // Pedidos já expedidos hoje (conferência no gráfico)
  for (let i = 53; i < 63; i++) {
    const expedido = atToday(9 + (i % 8), 15);
    await createDemoOrder(i, OrderStatus.DISPATCHED, {
      createdAt: atToday(6),
      updatedAt: expedido,
      dispatchedAt: expedido,
      quantityPicked: 10,
    });
  }

  // Pedidos criados ontem (deltas)
  for (let i = 63; i < 70; i++) {
    await createDemoOrder(i, OrderStatus.PENDING, {
      createdAt: yesterdayAt(14),
    });
  }

  // Pedido legado mobile
  await prisma.order.upsert({
    where: {
      tenantId_erpOrderId: { tenantId: TENANT_ID, erpOrderId: "ERP-10042" },
    },
    create: {
      tenantId: TENANT_ID,
      erpOrderId: "ERP-10042",
      customerName: "Cliente Demo Mobile",
      priority: 1,
      status: OrderStatus.PENDING,
      items: {
        create: [
          {
            lineNumber: 1,
            productId: screw.id,
            quantityOrdered: 10,
            pickLocationId: locA.id,
          },
          {
            lineNumber: 2,
            productId: motor.id,
            quantityOrdered: 2,
            pickLocationId: locB.id,
          },
        ],
      },
    },
    update: {},
  });

  // Movimentações de pick hoje → gráfico por hora + ranking
  const hourlyPlan: Array<{ hour: number; pickerIdx: number; qty: number }> = [
    { hour: 7, pickerIdx: 0, qty: 42 },
    { hour: 8, pickerIdx: 0, qty: 88 },
    { hour: 8, pickerIdx: 1, qty: 52 },
    { hour: 9, pickerIdx: 0, qty: 120 },
    { hour: 9, pickerIdx: 1, qty: 95 },
    { hour: 9, pickerIdx: 2, qty: 78 },
    { hour: 10, pickerIdx: 0, qty: 156 },
    { hour: 10, pickerIdx: 1, qty: 134 },
    { hour: 10, pickerIdx: 2, qty: 112 },
    { hour: 11, pickerIdx: 1, qty: 198 },
    { hour: 11, pickerIdx: 2, qty: 165 },
    { hour: 12, pickerIdx: 0, qty: 90 },
    { hour: 13, pickerIdx: 1, qty: 210 },
    { hour: 13, pickerIdx: 2, qty: 187 },
    { hour: 14, pickerIdx: 0, qty: 245 },
    { hour: 14, pickerIdx: 1, qty: 220 },
    { hour: 15, pickerIdx: 2, qty: 178 },
    { hour: 16, pickerIdx: 0, qty: 132 },
    { hour: 16, pickerIdx: 1, qty: 98 },
  ];

  await prisma.inventoryMovement.deleteMany({
    where: { reference: "seed-demo" },
  });

  for (const slot of hourlyPlan) {
    const picker = pickers[slot.pickerIdx]!;
    const prod = prodCycle[slot.pickerIdx % prodCycle.length]!;
    const loc = locCycle[slot.pickerIdx % locCycle.length]!;
    await prisma.inventoryMovement.create({
      data: {
        tenantId: TENANT_ID,
        type: InventoryMovementType.PICK_ALLOCATION,
        quantity: slot.qty,
        userId: picker.id,
        productId: prod.id,
        fromLocationId: loc.id,
        reference: "seed-demo",
        createdAt: atToday(slot.hour, 30),
      },
    });
  }

  // Logs de tempo (deltas conferência)
  const dispatchingOrders = await prisma.order.findMany({
    where: { status: OrderStatus.DISPATCHING },
    take: 8,
  });

  await prisma.orderTimeLog.deleteMany({
    where: { order: { erpOrderId: { startsWith: "ERP-DEMO-" } } },
  });

  for (let i = 0; i < dispatchingOrders.length; i++) {
    const order = dispatchingOrders[i]!;
    const picker = pickers[i % pickers.length]!;
    const startAt = atToday(9 + (i % 4), 10);
    const endAt = atToday(9 + (i % 4), 10 + 8 + (i % 5));
    await prisma.orderTimeLog.create({
      data: {
        orderId: order.id,
        userId: picker.id,
        event: OrderTimeLogEvent.START,
        createdAt: startAt,
      },
    });
    await prisma.orderTimeLog.create({
      data: {
        orderId: order.id,
        userId: picker.id,
        event: OrderTimeLogEvent.END,
        createdAt: endAt,
      },
    });
  }

  for (let i = 0; i < 3; i++) {
    await prisma.orderTimeLog.create({
      data: {
        orderId: dispatchingOrders[i]!.id,
        userId: operador.id,
        event: OrderTimeLogEvent.END,
        createdAt: yesterdayAt(15 + i),
      },
    });
  }

  const { releasePickWave } = await import("../src/services/pick-wave.js");
  const { confirmConsolidatedPick } = await import(
    "../src/services/pick-wave-pick.js"
  );
  const { confirmSortAllocation } = await import(
    "../src/services/pick-wave-sort.js"
  );
  try {
    const wave = await releasePickWave(TENANT_ID, operador.id, { auto: true });
    console.log(
      `Onda demo liberada: ${wave.orderCount} pedidos, ${wave.lineCount} linhas consolidadas`,
    );

    const demoLine = await prisma.pickWaveLine.findFirst({
      where: { waveId: wave.waveId },
      include: {
        pickLocation: true,
        allocations: {
          include: { orderItem: { include: { order: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (demoLine && demoLine.quantityTotal > 0) {
      const remaining = demoLine.quantityTotal - demoLine.quantityPicked;
      if (remaining > 0) {
        if (demoLine.pickLocation.currentQuantity < remaining) {
          await prisma.location.update({
            where: { id: demoLine.pickLocationId },
            data: { currentQuantity: remaining + 10 },
          });
        }
        await confirmConsolidatedPick({
          lineId: demoLine.id,
          locationBarcode: demoLine.pickLocation.barcode,
          quantity: remaining,
          userId: pickers[0]!.id,
        });
      }

      for (const alloc of demoLine.allocations.slice(0, 2)) {
        const qtyLeft = alloc.quantity - alloc.quantitySorted;
        if (qtyLeft <= 0) continue;
        await confirmSortAllocation({
          lineId: demoLine.id,
          allocationId: alloc.id,
          quantity: qtyLeft,
          basketBarcode: "BASKET001",
          userId: pickers[1]!.id,
        });
      }
    }
  } catch (e) {
    console.warn("Onda demo:", e);
  }

  for (const config of DEMO_TENANT_CONFIGS) {
    await seedDemoTenant(prisma, config);
  }

  const notifyUsers = [admin, operador, ...pickers];
  for (const u of notifyUsers) {
    await prisma.notification.createMany({
      data: [
        {
          userId: u.id,
          title: "Bem-vindo ao Help Route",
          body: "Suas notificações operacionais aparecerão aqui.",
          category: "SYSTEM",
        },
        {
          userId: u.id,
          title: "Gôndolas em alerta",
          body: "4 localizações estão abaixo do estoque mínimo.",
          category: "STOCK",
        },
      ],
    });
  }

  console.log("\n=== Help Route — tenant default (dados completos) ===\n");
  console.log("Dashboard esperado:");
  console.log("  Aguardando separação: ~24");
  console.log("  Aguardando conferência: ~11");
  console.log("  Prontos para expedir: ~18");
  console.log("  Alertas de gôndola: 4 localizações\n");
  printTestUsersGuide();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
