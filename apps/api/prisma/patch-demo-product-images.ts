import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function demoProductImageUrl(sku: string): string {
  return `https://picsum.photos/seed/wms-${encodeURIComponent(sku)}/400/400`;
}

const DEFAULT_SKUS = ["PAR-6X40", "MOT-220V", "CAB-2M", "VAL-1/2", "FUN-150"];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "default" } });
  if (!tenant) {
    throw new Error("Tenant default não encontrado");
  }

  let updated = 0;
  for (const sku of DEFAULT_SKUS) {
    const result = await prisma.product.updateMany({
      where: { tenantId: tenant.id, sku },
      data: { imageUrl: demoProductImageUrl(sku) },
    });
    updated += result.count;
  }

  const withoutImage = await prisma.product.findMany({
    where: { imageUrl: null },
    select: { id: true, sku: true },
  });
  for (const product of withoutImage) {
    await prisma.product.update({
      where: { id: product.id },
      data: { imageUrl: demoProductImageUrl(product.sku) },
    });
    updated += 1;
  }

  const remaining = await prisma.product.count({ where: { imageUrl: null } });
  console.log(`imageUrl aplicado em ${updated} produto(s). Sem imagem: ${remaining}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
