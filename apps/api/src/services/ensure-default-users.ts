import type { PrismaClient, UserRole } from "@prisma/client";
import { PLATFORM_ADMIN_PERMISSIONS } from "@wms/shared";
import { hashPassword } from "../lib/password.js";
import { seedTenantRolePermissions } from "./role-permissions.js";

export type EnsureDefaultUsersResult = {
  defaultTenantId: string;
  platformAdminEmail: string;
  tenantAdminEmail: string;
  operadorEmail: string;
  pickerEmail: string;
};

type DefaultUser = {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  isPlatformAdmin: boolean;
  tenantId: string | null;
  permissions: string[];
};

/**
 * Garante os usuários padrão. A senha só é definida na criação — trocas feitas
 * pelo painel não são sobrescritas no boot.
 * 1. Super-admin da plataforma (`admin@wms.local`) -> gestão de clientes, sem tenant
 * 2. Admin da conta (`adm@wms.local`) -> gestão total do tenant `default`
 * 3. Operador (`operador@wms.local`) -> EXPEDITER no tenant `default`
 * 4. Separador mobile (`picker@wms.local`) -> PICKER no tenant `default`
 */
export async function ensureDefaultUsers(
  client: PrismaClient,
): Promise<EnsureDefaultUsersResult> {
  const defaultTenant = await client.tenant.upsert({
    where: { slug: "default" },
    create: {
      name: "Default",
      slug: "default",
      cnpj: "03.007.331/0001-41",
      active: true,
    },
    update: { active: true },
  });
  const TENANT_ID = defaultTenant.id;
  await seedTenantRolePermissions(TENANT_ID, client);

  const users: DefaultUser[] = [
    {
      email: "admin@wms.local",
      name: "Administrador Help Route",
      password: "admin123",
      role: "ADMIN",
      isPlatformAdmin: true,
      tenantId: null,
      permissions: [...PLATFORM_ADMIN_PERMISSIONS],
    },
    {
      email: "adm@wms.local",
      name: "Administrador da Conta",
      password: "admin123",
      role: "ADMIN",
      isPlatformAdmin: false,
      tenantId: TENANT_ID,
      permissions: [],
    },
    {
      email: "operador@wms.local",
      name: "Operador",
      password: "operador123",
      role: "EXPEDITER",
      isPlatformAdmin: false,
      tenantId: TENANT_ID,
      permissions: [],
    },
    {
      email: "picker@wms.local",
      name: "Separador",
      password: "dev",
      role: "PICKER",
      isPlatformAdmin: false,
      tenantId: TENANT_ID,
      permissions: [],
    },
  ];

  for (const { password, ...user } of users) {
    await client.user.upsert({
      where: { email: user.email },
      create: { ...user, password: hashPassword(password), active: true },
      update: {
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin,
        tenantId: user.tenantId,
        active: true,
        ...(user.isPlatformAdmin ? { permissions: user.permissions } : {}),
      },
    });
  }

  return {
    defaultTenantId: TENANT_ID,
    platformAdminEmail: "admin@wms.local",
    tenantAdminEmail: "adm@wms.local",
    operadorEmail: "operador@wms.local",
    pickerEmail: "picker@wms.local",
  };
}
