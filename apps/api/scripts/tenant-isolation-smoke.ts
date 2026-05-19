/**
 * Smoke test: dois tenants, pedidos isolados por tenantId.
 * Uso: npx tsx apps/api/scripts/tenant-isolation-smoke.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slugA = "smoke-tenant-a";
  const slugB = "smoke-tenant-b";

  const tenantA = await prisma.tenant.upsert({
    where: { slug: slugA },
    create: { name: "Smoke A", slug: slugA, active: true },
    update: { active: true },
  });
  const tenantB = await prisma.tenant.upsert({
    where: { slug: slugB },
    create: { name: "Smoke B", slug: slugB, active: true },
    update: { active: true },
  });

  const erpA = "SMOKE-ORDER-A";
  const erpB = "SMOKE-ORDER-B";

  await prisma.order.deleteMany({
    where: {
      tenantId: { in: [tenantA.id, tenantB.id] },
      erpOrderId: { in: [erpA, erpB] },
    },
  });

  await prisma.order.create({
    data: {
      tenantId: tenantA.id,
      erpOrderId: erpA,
      customerName: "Cliente A",
      status: "PENDING",
    },
  });
  await prisma.order.create({
    data: {
      tenantId: tenantB.id,
      erpOrderId: erpB,
      customerName: "Cliente B",
      status: "PENDING",
    },
  });

  const visibleFromA = await prisma.order.findMany({
    where: { tenantId: tenantA.id, erpOrderId: { in: [erpA, erpB] } },
    select: { erpOrderId: true },
  });
  const visibleFromB = await prisma.order.findMany({
    where: { tenantId: tenantB.id, erpOrderId: { in: [erpA, erpB] } },
    select: { erpOrderId: true },
  });

  const idsA = visibleFromA.map((o) => o.erpOrderId).sort();
  const idsB = visibleFromB.map((o) => o.erpOrderId).sort();

  if (idsA.join() !== erpA || idsB.join() !== erpB) {
    console.error("FALHA isolamento:", { idsA, idsB });
    process.exit(1);
  }

  console.log("OK — isolamento por tenantId:");
  console.log(`  Tenant A (${slugA}): pedidos`, idsA);
  console.log(`  Tenant B (${slugB}): pedidos`, idsB);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
