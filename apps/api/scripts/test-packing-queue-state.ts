import { PrismaClient, OrderStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const grouped = await prisma.order.groupBy({
    by: ["status"],
    _count: true,
  });
  console.log("ORDER_STATUS_COUNTS", JSON.stringify(grouped, null, 2));

  const pending = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING },
    take: 5,
    select: {
      id: true,
      erpOrderId: true,
      tenantId: true,
      waveOrders: { include: { wave: { select: { status: true, name: true } } } },
      items: {
        select: {
          id: true,
          quantityOrdered: true,
          quantityPicked: true,
          product: { select: { sku: true, barcode: true } },
          pickLocation: { select: { barcode: true } },
        },
      },
    },
  });
  console.log("PENDING_ORDERS", JSON.stringify(pending, null, 2));

  const separated = await prisma.order.findMany({
    where: { status: OrderStatus.PICKED_AWAITING_CONFERENCE },
    take: 10,
    select: {
      id: true,
      erpOrderId: true,
      basket: { select: { code: true, barcode: true } },
    },
  });
  console.log("SEPARATED_ORDERS", JSON.stringify(separated, null, 2));

  const picking = await prisma.order.findMany({
    where: { status: OrderStatus.PICKING },
    take: 5,
    select: { id: true, erpOrderId: true },
  });
  console.log("PICKING_ORDERS", JSON.stringify(picking, null, 2));

  const operador = await prisma.user.findUnique({
    where: { email: "operador@wms.local" },
    select: { permissions: true, role: true },
  });
  console.log("OPERADOR_PERMS", JSON.stringify(operador, null, 2));

  const tenant = await prisma.tenant.findFirst({ where: { slug: "default" } });
  const [products, locations, baskets] = await Promise.all([
    prisma.product.count({ where: { tenantId: tenant?.id } }),
    prisma.location.count({ where: { tenantId: tenant?.id } }),
    prisma.basket.count({ where: { tenantId: tenant?.id } }),
  ]);
  console.log("CATALOG", JSON.stringify({ products, locations, baskets }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
