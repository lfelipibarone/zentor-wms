import { PrismaClient } from "@prisma/client";
import { ensureDefaultUsers } from "../src/services/ensure-default-users.js";
import { ensureAllTenantsRolePermissions } from "../src/services/role-permissions.js";

const prisma = new PrismaClient();

const DEFAULT_SETTINGS = [
  { key: "company.name", value: "Help Route", description: "Nome exibido no sistema" },
  { key: "wave.enabled", value: "true", description: "Habilitar onda no mobile" },
  { key: "wave.autoRelease.enabled", value: "false", description: "Liberação automática diária" },
  { key: "wave.autoRelease.time", value: "06:30", description: "Horário liberação automática" },
  { key: "wave.autoRelease.maxOrders", value: "50", description: "Máximo pedidos por onda" },
  { key: "wave.onlyDeadlineToday", value: "false", description: "Somente pedidos com coleta hoje" },
  { key: "tiny.webhook.secret", value: "", description: "Token header x-tiny-token" },
];

async function main() {
  const users = await ensureDefaultUsers(prisma);
  const tenantId = users.defaultTenantId;

  for (const row of DEFAULT_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { tenantId_key: { tenantId, key: row.key } },
      create: { tenantId, ...row },
      update: {},
    });
  }

  await ensureAllTenantsRolePermissions(prisma);

  console.log(
    `Seed ok — usuários: ${users.platformAdminEmail}, ${users.tenantAdminEmail}, ${users.operadorEmail}, ${users.pickerEmail}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
