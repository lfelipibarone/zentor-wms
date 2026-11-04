/**
 * Popula ondas + pedidos prontos para packing (conferência na tela /packing).
 * Uso: pnpm --filter @wms/api exec tsx --env-file .env scripts/seed-packing-demo.ts
 */
import {
  PrismaClient,
  OrderStatus,
  PickWaveStatus,
  PickWaveLineSortStatus,
  LocationType,
} from "@prisma/client";

const prisma = new PrismaClient();

const WAVE_COUNT = 3;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "default" } });
  if (!tenant) throw new Error("Tenant default não encontrado — rode pnpm db:seed");

  const picker = await prisma.user.findUnique({ where: { email: "picker@wms.local" } });
  if (!picker) throw new Error("picker@wms.local não encontrado");

  // Limpa demo anterior
  const oldWaves = await prisma.pickWave.findMany({
    where: { tenantId: tenant.id, name: { startsWith: "Demo Packing" } },
    select: { id: true },
  });
  for (const w of oldWaves) {
    await prisma.pickWave.delete({ where: { id: w.id } });
  }
  await prisma.order.deleteMany({
    where: { tenantId: tenant.id, erpOrderId: { startsWith: "DEMO-PACK-" } },
  });
  await prisma.product.deleteMany({
    where: { tenantId: tenant.id, sku: { startsWith: "DEMO-SKU-" } },
  });
  await prisma.basket.deleteMany({
    where: { tenantId: tenant.id, code: { startsWith: "DEMO-C" } },
  });
  await prisma.location.deleteMany({
    where: { tenantId: tenant.id, barcode: { startsWith: "DEMO-LOC-" } },
  });

  const products = await Promise.all(
    [
      { sku: "DEMO-SKU-PUXADOR", name: "PUXADOR CLEAN USINADO (OLIMPIA) 192MM", barcode: "7891001001001" },
      { sku: "DEMO-SKU-DOBRADICA", name: "DOBRADIÇA INOX 35MM", barcode: "7891001001002" },
      { sku: "DEMO-SKU-CORREDICA", name: "CORREDIÇA TELESCOPICA 400MM", barcode: "7891001001003" },
    ].map((p) =>
      prisma.product.create({
        data: { tenantId: tenant.id, ...p, unit: "UN", imageUrl: null },
      }),
    ),
  );

  const locations = await Promise.all(
    products.map((p, i) =>
      prisma.location.create({
        data: {
          tenantId: tenant.id,
          corridor: "B",
          row: String(i + 1).padStart(2, "0"),
          barcode: `DEMO-LOC-B1-${i + 1}`,
          type: LocationType.PICK_FACE,
          productId: p.id,
          capacity: 100,
          fillPercent: 80,
          stockQuantity: 80,
        },
      }),
    ),
  );

  const marketplaces = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"] as const;
  const itemCombos = [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const;

  const createdWaves: Array<{ id: string; name: string; orders: string[] }> = [];
  let basketSeq = 1;
  let orderSeq = 2000;

  for (let w = 0; w < WAVE_COUNT; w++) {
    const ordersPerWave = 3;
    const baskets = await Promise.all(
      Array.from({ length: ordersPerWave }, () => {
        const n = basketSeq++;
        return prisma.basket.create({
          data: {
            tenantId: tenant.id,
            code: `DEMO-C${String(n).padStart(2, "0")}`,
            barcode: `DEMOCESTA${n}`,
          },
        });
      }),
    );

    const orders = [];
    for (let i = 0; i < ordersPerWave; i++) {
      const erp = `DEMO-PACK-${orderSeq++}`;
      const items = itemCombos[i % itemCombos.length]!;
      const order = await prisma.order.create({
        data: {
          tenantId: tenant.id,
          erpOrderId: erp,
          status: OrderStatus.PICKED_AWAITING_CONFERENCE,
          priority: 40 + w * 5 + i,
          customerName: `Cliente ${erp}`,
          marketplace: marketplaces[i % marketplaces.length],
          basketId: baskets[i]!.id,
          assignedPickerId: picker.id,
          collectionDeadline: new Date(Date.now() + (2 + w) * 60 * 60 * 1000),
          items: {
            create: items.map((pi, line) => ({
              productId: products[pi]!.id,
              lineNumber: line + 1,
              quantityOrdered: 3 + ((w + i) % 3),
              quantityPicked: 3 + ((w + i) % 3),
              quantityPacked: 0,
              pickLocationId: locations[pi]!.id,
            })),
          },
        },
        include: { items: true },
      });
      orders.push(order);
    }

    const stamp = new Date().toLocaleString("pt-BR");
    const wave = await prisma.pickWave.create({
      data: {
        tenantId: tenant.id,
        name: `Demo Packing ${w + 1}/${WAVE_COUNT} · ${stamp}`,
        status: PickWaveStatus.RELEASED,
        releasedAt: new Date(Date.now() - w * 60_000),
        acceptedAt: new Date(Date.now() - w * 60_000),
        acceptedById: picker.id,
        orders: {
          create: orders.map((o) => ({ orderId: o.id })),
        },
      },
    });

    for (let pi = 0; pi < products.length; pi++) {
      const product = products[pi]!;
      const location = locations[pi]!;
      const related = orders.flatMap((o) =>
        o.items
          .filter((it) => it.productId === product.id)
          .map((it) => ({ order: o, item: it })),
      );
      if (related.length === 0) continue;

      const quantityTotal = related.reduce((s, r) => s + r.item.quantityOrdered, 0);
      const line = await prisma.pickWaveLine.create({
        data: {
          waveId: wave.id,
          productId: product.id,
          pickLocationId: location.id,
          quantityTotal,
          quantityPicked: quantityTotal,
          sortStatus: PickWaveLineSortStatus.PICKED,
          pickedById: picker.id,
          pickStartedAt: new Date(Date.now() - 30 * 60_000),
          pickCompletedAt: new Date(),
        },
      });

      for (const { item } of related) {
        await prisma.pickWaveAllocation.create({
          data: {
            waveLineId: line.id,
            orderItemId: item.id,
            quantity: item.quantityOrdered,
            quantitySorted: 0,
          },
        });
      }
    }

    createdWaves.push({
      id: wave.id,
      name: wave.name,
      orders: orders.map((o) => o.erpOrderId),
    });
  }

  // Pedido avulso (fora de onda) na fila
  const avulsoBasket = await prisma.basket.create({
    data: {
      tenantId: tenant.id,
      code: `DEMO-C${String(basketSeq).padStart(2, "0")}`,
      barcode: `DEMOCESTA${basketSeq}`,
    },
  });
  await prisma.order.create({
    data: {
      tenantId: tenant.id,
      erpOrderId: "DEMO-PACK-AVULSO",
      status: OrderStatus.PICKED_AWAITING_CONFERENCE,
      priority: 20,
      customerName: "Cliente Avulso",
      marketplace: "MAGALU",
      basketId: avulsoBasket.id,
      assignedPickerId: picker.id,
      items: {
        create: {
          productId: products[0]!.id,
          lineNumber: 1,
          quantityOrdered: 2,
          quantityPicked: 2,
          quantityPacked: 0,
          pickLocationId: locations[0]!.id,
        },
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        waves: createdWaves,
        avulso: "DEMO-PACK-AVULSO",
        login: { email: "operador@wms.local", password: "operador123" },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
