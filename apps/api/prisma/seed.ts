import {
  InventoryMovementType,
  OrderStatus,
  OrderTimeLogEvent,
  PrismaClient,
} from "@prisma/client";
import { ALL_PERMISSION_KEYS, defaultPermissionsForRole } from "@wms/shared";
import { hashPassword } from "../src/lib/password.js";

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
  // --- Usuários ---
  const admin = await prisma.user.upsert({
    where: { email: "admin@wms.local" },
    create: {
      email: "admin@wms.local",
      name: "Administrador Help Route",
      password: hashPassword("admin123"),
      role: "ADMIN",
      permissions: [...ALL_PERMISSION_KEYS],
    },
    update: {
      password: hashPassword("admin123"),
      role: "ADMIN",
      active: true,
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
      permissions: defaultPermissionsForRole("EXPEDITER"),
    },
    update: {
      password: hashPassword("operador123"),
      name: "Felipe Figueiredo",
      role: "EXPEDITER",
      active: true,
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
      permissions: pickerPerms,
    },
    update: { password: hashPassword("dev"), permissions: pickerPerms },
  });

  const pickerMaria = await prisma.user.upsert({
    where: { email: "maria@wms.local" },
    create: {
      email: "maria@wms.local",
      name: "Maria Silva",
      password: hashPassword("dev"),
      role: "PICKER",
      permissions: pickerPerms,
    },
    update: { password: hashPassword("dev"), permissions: pickerPerms },
  });

  const pickerCarlos = await prisma.user.upsert({
    where: { email: "carlos@wms.local" },
    create: {
      email: "carlos@wms.local",
      name: "Carlos Mendes",
      password: hashPassword("dev"),
      role: "PICKER",
      permissions: pickerPerms,
    },
    update: { password: hashPassword("dev"), permissions: pickerPerms },
  });

  const pickers = [pickerJoao, pickerMaria, pickerCarlos];

  // --- Configurações ---
  await prisma.systemSetting.upsert({
    where: { key: "company.name" },
    create: {
      key: "company.name",
      value: "Help Route",
      description: "Nome exibido no sistema",
    },
    update: { value: "Help Route" },
  });

  await prisma.systemSetting.upsert({
    where: { key: "warehouse.label" },
    create: {
      key: "warehouse.label",
      value: "CD Brasil · São Paulo",
      description: "Identificação do centro de distribuição",
    },
    update: { value: "CD Brasil · São Paulo" },
  });

  // --- Produtos ---
  const products = await Promise.all([
    prisma.product.upsert({
      where: { sku: "PAR-6X40" },
      create: {
        sku: "PAR-6X40",
        name: "Parafuso 6x40 (caixa)",
        requiresItemScan: false,
        barcode: "7891000000001",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { sku: "MOT-220V" },
      create: {
        sku: "MOT-220V",
        name: "Motor 220V",
        requiresItemScan: true,
        barcode: "7891000000002",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { sku: "CAB-2M" },
      create: {
        sku: "CAB-2M",
        name: "Cabo elétrico 2m",
        requiresItemScan: false,
        barcode: "7891000000003",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { sku: "VAL-1/2" },
      create: {
        sku: "VAL-1/2",
        name: "Válvula 1/2 pol",
        requiresItemScan: true,
        barcode: "7891000000004",
      },
      update: {},
    }),
    prisma.product.upsert({
      where: { sku: "FUN-150" },
      create: {
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
      where: { barcode: "LOC-A01-01" },
      create: {
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
      where: { barcode: "LOC-A02-01" },
      create: {
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
      where: { barcode: "LOC-B01-03" },
      create: {
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
      where: { barcode: "LOC-B02-02" },
      create: {
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
      where: { barcode: "LOC-C01-01" },
      create: {
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
      where: { barcode: "LOC-C02-04" },
      create: {
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

  await prisma.basket.upsert({
    where: { code: "CESTA-001" },
    create: { code: "CESTA-001", barcode: "BASKET001" },
    update: {},
  });

  // Limpa pedidos demo anteriores para re-seed idempotente
  await prisma.order.deleteMany({
    where: { erpOrderId: { startsWith: "ERP-DEMO-" } },
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
    },
  ) {
    const loc = locCycle[index % locCycle.length]!;
    const prod = prodCycle[index % prodCycle.length]!;
    const qty = 5 + (index % 12);
    const picked = opts?.quantityPicked ?? (status === "PENDING" ? 0 : qty);

    return prisma.order.create({
      data: {
        erpOrderId: `ERP-DEMO-${String(index).padStart(4, "0")}`,
        customerName: `Cliente Demo ${index + 1}`,
        status,
        priority: index % 3,
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

  // KPI: aguardando separação (~24)
  for (let i = 0; i < 24; i++) {
    await createDemoOrder(i, OrderStatus.PENDING, {
      createdAt: atToday(7 + (i % 4)),
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
    where: { erpOrderId: "ERP-10042" },
    create: {
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
    await prisma.orderTimeLog.create({
      data: {
        orderId: order.id,
        userId: pickers[i % pickers.length]!.id,
        event: OrderTimeLogEvent.END,
        createdAt: atToday(10 + (i % 6)),
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

  console.log("\n=== Help Route — dados de demonstração ===\n");
  console.log("Administrador (acesso total):");
  console.log("  E-mail: admin@wms.local");
  console.log("  Senha:  admin123\n");
  console.log("Operador comum (painel web, sem área admin):");
  console.log("  E-mail: operador@wms.local");
  console.log("  Senha:  operador123\n");
  console.log("Separadores (app mobile):");
  console.log("  picker@wms.local / dev");
  console.log("  maria@wms.local / dev");
  console.log("  carlos@wms.local / dev\n");
  console.log("Dashboard esperado:");
  console.log("  Aguardando separação: ~24");
  console.log("  Aguardando conferência: ~11");
  console.log("  Prontos para expedir: ~18");
  console.log("  Alertas de gôndola: 4 localizações\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
