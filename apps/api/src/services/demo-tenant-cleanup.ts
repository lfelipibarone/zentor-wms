import { prisma } from "../lib/prisma.js";
import { cleanupTenantOrdersAndWaves } from "./sync-sales-orders-from-tiny.js";

export function isSeedDemoTenantSlug(slug: string): boolean {
  return slug === "default" || slug.startsWith("demo-");
}

export async function cleanupSeedDemoTenantData(): Promise<{
  tenants: number;
  ordersRemoved: number;
  wavesRemoved: number;
}> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true },
  });

  const targets = tenants.filter((tenant) => isSeedDemoTenantSlug(tenant.slug));
  let ordersRemoved = 0;
  let wavesRemoved = 0;

  for (const tenant of targets) {
    const stats = await cleanupTenantOrdersAndWaves(prisma, tenant.id);
    ordersRemoved += stats.ordersRemoved;
    wavesRemoved += stats.wavesRemoved;
  }

  return { tenants: targets.length, ordersRemoved, wavesRemoved };
}
