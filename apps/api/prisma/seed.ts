import {
  InventoryMovementType,
  PrismaClient,
} from "@prisma/client";
import {
  ALL_PERMISSION_KEYS,
  defaultPermissionsForRole,
  Permission,
} from "@wms/shared";
import { hashPassword } from "../src/lib/password.js";
import { cleanupSeedDemoTenantData } from "../src/services/demo-tenant-cleanup.js";
import {
  DEMO_TENANT_CONFIGS,
  printTestUsersGuide,
  seedDemoTenant,
} from "./seed-demo-tenants.js";
import { seedPurchaseReceiptDemos } from "./seed-purchase-receipts.js";
import { seedFlowStageDemos } from "./seed-flow-stages.js";

const prisma = new PrismaClient();

function atToday(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** URLs estáveis (picsum por SKU) para validar zoom no packing. */
function demoProductImageUrl(sku: string): string {
  return `https://picsum.photos/seed/wms-${encodeURIComponent(sku)}/400/400`;
}

async function main() {
  await cleanupSeedDemoTenantData();

  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: "default" },
    create: { name: "Default", slug: "default", active: true },
    update: { active: true },
  });
  const TENANT_ID = defaultTenant.id;

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

  const felipePermissions = [
    ...new Set([
      ...defaultPermissionsForRole("EXPEDITER"),
      Permission.REGISTERS_VIEW,
      Permission.PRODUCTS_MANAGE,
      Permission.REPORTS_VIEW,
    ]),
  ];

  const operador = await prisma.user.upsert({
    where: { email: "operador@wms.local" },
    create: {
      email: "operador@wms.local",
      name: "Felipe Figueiredo",
      password: hashPassword("operador123"),
      role: "EXPEDITER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
    },
    update: {
      password: hashPassword("operador123"),
      name: "Felipe Figueiredo",
      active: true,
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
    },
  });

  const existingTiny = await prisma.tinyConnection.findFirst({
    where: { tenantId: TENANT_ID, userId: operador.id, deletedAt: null },
  });
  if (!existingTiny) {
    await prisma.tinyConnection.create({
      data: {
        tenantId: TENANT_ID,
        userId: operador.id,
        name: "Tiny ERP",
        isDefault: true,
      },
    });
  }

  const operador2 = await prisma.user.upsert({
    where: { email: "operador2@wms.local" },
    create: {
      email: "operador2@wms.local",
      name: "Ana Operadora",
      password: hashPassword("operador123"),
      role: "EXPEDITER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
    },
    update: {
      password: hashPassword("operador123"),
      name: "Ana Operadora",
      active: true,
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
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
        imageUrl: demoProductImageUrl("PAR-6X40"),
      },
      update: { imageUrl: demoProductImageUrl("PAR-6X40") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "MOT-220V" } },
      create: {
        tenantId: TENANT_ID,
        sku: "MOT-220V",
        name: "Motor 220V",
        requiresItemScan: true,
        barcode: "7891000000002",
        imageUrl: demoProductImageUrl("MOT-220V"),
      },
      update: { imageUrl: demoProductImageUrl("MOT-220V") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "CAB-2M" } },
      create: {
        tenantId: TENANT_ID,
        sku: "CAB-2M",
        name: "Cabo elétrico 2m",
        requiresItemScan: false,
        barcode: "7891000000003",
        imageUrl: demoProductImageUrl("CAB-2M"),
      },
      update: { imageUrl: demoProductImageUrl("CAB-2M") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "VAL-1/2" } },
      create: {
        tenantId: TENANT_ID,
        sku: "VAL-1/2",
        name: "Válvula 1/2 pol",
        requiresItemScan: true,
        barcode: "7891000000004",
        imageUrl: demoProductImageUrl("VAL-1/2"),
      },
      update: { imageUrl: demoProductImageUrl("VAL-1/2") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "FUN-150" } },
      create: {
        tenantId: TENANT_ID,
        sku: "FUN-150",
        name: "Filtro UV 150W",
        requiresItemScan: false,
        barcode: "7891000000005",
        imageUrl: demoProductImageUrl("FUN-150"),
      },
      update: { imageUrl: demoProductImageUrl("FUN-150") },
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
  const prodCycle = [screw, motor, cable];
  const locCycle = [locA, locB, locC, locD, locE];

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

  const basket1 = await prisma.basket.upsert({
    where: { tenantId_code: { tenantId: TENANT_ID, code: "CESTA-001" } },
    create: {
      tenantId: TENANT_ID,
      code: "CESTA-001",
      barcode: "BASKET001",
    },
    update: {},
  });
  const basket2 = await prisma.basket.upsert({
    where: { tenantId_code: { tenantId: TENANT_ID, code: "CESTA-002" } },
    create: {
      tenantId: TENANT_ID,
      code: "CESTA-002",
      barcode: "BASKET002",
    },
    update: {},
  });

  await seedPurchaseReceiptDemos(prisma, {
    tenantId: TENANT_ID,
    startedById: operador.id,
    products: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      barcode: p.barcode,
    })),
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

  await seedFlowStageDemos(prisma, {
    tenantId: TENANT_ID,
    userId: operador.id,
    productId: screw.id,
    pickLocationId: locA.id,
    basketId: basket1.id,
  });

  for (const config of DEMO_TENANT_CONFIGS) {
    await seedDemoTenant(prisma, config);
  }

  const notifyUsers = [admin, operador, operador2, ...pickers];
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
