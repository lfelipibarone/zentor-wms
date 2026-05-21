import {
  Prisma,
  PrismaClient,
  PurchaseReceiptKind,
  PurchaseReceiptSessionStatus,
  PutawaySessionStatus,
} from "@prisma/client";

type ProductRef = {
  sku: string;
  name: string;
  barcode: string | null;
};

export async function seedPurchaseReceiptDemos(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    startedById: string;
    products: ProductRef[];
  },
) {
  const { tenantId, startedById, products } = params;
  const [screw, motor, cable, valve, filter] = products;
  if (!screw || !motor || !cable) return;

  await prisma.putawaySession.deleteMany({
    where: {
      purchaseReceipt: {
        tenantId,
        OR: [
          { accessKey: { startsWith: "DEMO-NF-" } },
          { reference: { startsWith: "DEV-2024-" } },
        ],
      },
    },
  });
  await prisma.purchaseReceiptItem.deleteMany({
    where: {
      session: {
        tenantId,
        OR: [
          { accessKey: { startsWith: "DEMO-NF-" } },
          { reference: { startsWith: "DEV-2024-" } },
        ],
      },
    },
  });
  await prisma.purchaseReceiptTimeLog.deleteMany({
    where: {
      session: {
        tenantId,
        OR: [
          { accessKey: { startsWith: "DEMO-NF-" } },
          { reference: { startsWith: "DEV-2024-" } },
        ],
      },
    },
  });
  await prisma.purchaseReceiptSession.deleteMany({
    where: {
      tenantId,
      OR: [
        { accessKey: { startsWith: "DEMO-NF-" } },
        { reference: { startsWith: "DEV-2024-" } },
      ],
    },
  });

  const confStart = (h: number) => {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const confEnd = (h: number) => {
    const d = new Date();
    d.setHours(h, 30, 0, 0);
    return d;
  };

  // --- NF entrada ---
  const nfCompleted = await prisma.purchaseReceiptSession.create({
    data: {
      tenantId,
      kind: PurchaseReceiptKind.ENTRY,
      tinyNotaId: 45821,
      accessKey: "DEMO-NF-45821-00000000000000000000000000000000000001",
      invoiceNumber: "45821",
      supplierName: "Fornecedor Alpha Ltda",
      status: PurchaseReceiptSessionStatus.COMPLETED,
      tinySyncStatus: "OK",
      startedById,
      startedAt: confStart(8),
      conferenceStartedAt: confStart(9),
      conferenceEndedAt: confEnd(9),
      completedAt: confEnd(9),
      items: {
        create: [
          {
            lineNumber: 1,
            productCode: screw.sku,
            description: screw.name,
            barcode: screw.barcode,
            quantityExpected: new Prisma.Decimal(100),
            quantityChecked: new Prisma.Decimal(100),
          },
          {
            lineNumber: 2,
            productCode: motor.sku,
            description: motor.name,
            barcode: motor.barcode,
            quantityExpected: new Prisma.Decimal(20),
            quantityChecked: new Prisma.Decimal(20),
          },
          {
            lineNumber: 3,
            productCode: cable.sku,
            description: cable.name,
            barcode: cable.barcode,
            quantityExpected: new Prisma.Decimal(50),
            quantityChecked: new Prisma.Decimal(50),
          },
        ],
      },
    },
    include: { items: true },
  });

  await prisma.putawaySession.create({
    data: {
      purchaseReceiptId: nfCompleted.id,
      status: PutawaySessionStatus.PENDING,
      items: {
        create: nfCompleted.items.map((it) => ({
          receiptItemId: it.id,
          productCode: it.productCode,
          description: it.description,
          barcode: it.barcode,
          quantityExpected: it.quantityChecked,
        })),
      },
    },
  });

  await prisma.purchaseReceiptSession.create({
    data: {
      tenantId,
      kind: PurchaseReceiptKind.ENTRY,
      tinyNotaId: 45822,
      accessKey: "DEMO-NF-45822-00000000000000000000000000000000000002",
      invoiceNumber: "45822",
      supplierName: "Distribuidora Beta S.A.",
      status: PurchaseReceiptSessionStatus.IN_CHECK,
      tinySyncStatus: "OK",
      startedById,
      startedAt: confStart(10),
      conferenceStartedAt: confStart(11),
      items: {
        create: [
          {
            lineNumber: 1,
            productCode: valve.sku,
            description: valve.name,
            barcode: valve.barcode,
            quantityExpected: new Prisma.Decimal(30),
            quantityChecked: new Prisma.Decimal(30),
          },
          {
            lineNumber: 2,
            productCode: filter.sku,
            description: filter.name,
            barcode: filter.barcode,
            quantityExpected: new Prisma.Decimal(15),
            quantityChecked: new Prisma.Decimal(15),
          },
          {
            lineNumber: 3,
            productCode: screw.sku,
            description: screw.name,
            barcode: screw.barcode,
            quantityExpected: new Prisma.Decimal(40),
            quantityChecked: new Prisma.Decimal(0),
          },
          {
            lineNumber: 4,
            productCode: motor.sku,
            description: motor.name,
            barcode: motor.barcode,
            quantityExpected: new Prisma.Decimal(10),
            quantityChecked: new Prisma.Decimal(0),
          },
        ],
      },
    },
  });

  await prisma.purchaseReceiptSession.create({
    data: {
      tenantId,
      kind: PurchaseReceiptKind.ENTRY,
      tinyNotaId: 45823,
      accessKey: "DEMO-NF-45823-00000000000000000000000000000000000003",
      invoiceNumber: "45823",
      supplierName: "Importadora Gama",
      status: PurchaseReceiptSessionStatus.READY_TO_CHECK,
      startedById,
      startedAt: confStart(14),
      items: {
        create: [
          {
            lineNumber: 1,
            productCode: cable.sku,
            description: cable.name,
            barcode: cable.barcode,
            quantityExpected: new Prisma.Decimal(25),
            quantityChecked: new Prisma.Decimal(0),
          },
          {
            lineNumber: 2,
            productCode: screw.sku,
            description: screw.name,
            barcode: screw.barcode,
            quantityExpected: new Prisma.Decimal(60),
            quantityChecked: new Prisma.Decimal(0),
          },
        ],
      },
    },
  });

  // --- Devoluções ---
  await prisma.purchaseReceiptSession.create({
    data: {
      tenantId,
      kind: PurchaseReceiptKind.RETURN,
      reference: "DEV-2024-001",
      invoiceNumber: "NF dev. 9921",
      supplierName: "Cliente Mercado Livre — Silva",
      status: PurchaseReceiptSessionStatus.COMPLETED,
      startedById,
      startedAt: confStart(7),
      conferenceStartedAt: confStart(7),
      conferenceEndedAt: confEnd(8),
      completedAt: confEnd(8),
      items: {
        create: [
          {
            lineNumber: 1,
            productCode: motor.sku,
            description: motor.name,
            barcode: motor.barcode,
            quantityExpected: new Prisma.Decimal(2),
            quantityChecked: new Prisma.Decimal(2),
          },
          {
            lineNumber: 2,
            productCode: screw.sku,
            description: screw.name,
            barcode: screw.barcode,
            quantityExpected: new Prisma.Decimal(5),
            quantityChecked: new Prisma.Decimal(5),
          },
        ],
      },
    },
  });

  await prisma.purchaseReceiptSession.create({
    data: {
      tenantId,
      kind: PurchaseReceiptKind.RETURN,
      reference: "DEV-2024-002",
      invoiceNumber: "Pedido #ML-8842",
      supplierName: "Devolução Shopee — Costa",
      status: PurchaseReceiptSessionStatus.IN_CHECK,
      startedById,
      startedAt: confStart(12),
      conferenceStartedAt: confStart(13),
      items: {
        create: [
          {
            lineNumber: 1,
            productCode: filter.sku,
            description: filter.name,
            barcode: filter.barcode,
            quantityExpected: new Prisma.Decimal(3),
            quantityChecked: new Prisma.Decimal(1),
          },
          {
            lineNumber: 2,
            productCode: valve.sku,
            description: valve.name,
            barcode: valve.barcode,
            quantityExpected: new Prisma.Decimal(2),
            quantityChecked: new Prisma.Decimal(0),
          },
        ],
      },
    },
  });

  await prisma.purchaseReceiptSession.create({
    data: {
      tenantId,
      kind: PurchaseReceiptKind.RETURN,
      reference: "DEV-2024-003",
      invoiceNumber: "NF dev. 7710",
      supplierName: "Cliente B2B — Oficina Norte",
      status: PurchaseReceiptSessionStatus.COMPLETED,
      startedById,
      startedAt: yesterday(confStart(15)),
      conferenceStartedAt: yesterday(confStart(15)),
      conferenceEndedAt: yesterday(confEnd(16)),
      completedAt: yesterday(confEnd(16)),
      items: {
        create: [
          {
            lineNumber: 1,
            productCode: cable.sku,
            description: cable.name,
            barcode: cable.barcode,
            quantityExpected: new Prisma.Decimal(4),
            quantityChecked: new Prisma.Decimal(4),
          },
        ],
      },
    },
  });
}

function yesterday(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - 1);
  return copy;
}
