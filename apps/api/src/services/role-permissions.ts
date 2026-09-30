import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import {
  ALL_PERMISSION_KEYS,
  defaultPermissionsForRole,
  EDITABLE_TENANT_ROLES,
  expandRoleMatrixPermissions,
  Permission,
  PLATFORM_ADMIN_PERMISSIONS,
  resolveRolePermissions,
  tenantAdminPermissions,
  type PermissionKey,
} from "@wms/shared";
import { prisma } from "../lib/prisma.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class RolePermissionServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "RolePermissionServiceError";
  }
}

const SEED_ROLES: UserRole[] = ["PICKER", "REPLENISHER", "EXPEDITER", "ADMIN"];

export async function seedTenantRolePermissions(
  tenantId: string,
  client: DbClient = prisma,
) {
  for (const role of SEED_ROLES) {
    const permissions = defaultPermissionsForRole(role);
    await client.tenantRolePermission.upsert({
      where: { tenantId_role: { tenantId, role } },
      create: { tenantId, role, permissions },
      update: {},
    });
  }
}

export async function ensureAllTenantsRolePermissions(
  client: DbClient = prisma,
) {
  const tenants = await client.tenant.findMany({ select: { id: true } });
  for (const t of tenants) {
    await seedTenantRolePermissions(t.id, client);
  }
}

export async function getRolePermissionMap(
  tenantId: string,
  client: DbClient = prisma,
): Promise<Map<UserRole, string[]>> {
  const rows = await client.tenantRolePermission.findMany({
    where: { tenantId },
  });
  const map = new Map<UserRole, string[]>();
  for (const row of rows) {
    map.set(row.role, row.permissions);
  }
  return map;
}

export function permissionsFromMap(
  role: string,
  map: Map<UserRole, string[]>,
  opts?: { isPlatformAdmin?: boolean },
): PermissionKey[] {
  if (opts?.isPlatformAdmin) return [...PLATFORM_ADMIN_PERMISSIONS];
  const userRole = role as UserRole;
  return resolveRolePermissions(userRole, map.get(userRole) ?? null);
}

export async function resolveUserPermissions(user: {
  role: string;
  tenantId?: string | null;
  isPlatformAdmin?: boolean;
}): Promise<PermissionKey[]> {
  if (user.isPlatformAdmin) return [...PLATFORM_ADMIN_PERMISSIONS];
  if (user.role === "ADMIN") return tenantAdminPermissions();
  if (!user.tenantId) {
    return defaultPermissionsForRole(user.role as UserRole);
  }
  const row = await prisma.tenantRolePermission.findUnique({
    where: {
      tenantId_role: {
        tenantId: user.tenantId,
        role: user.role as UserRole,
      },
    },
  });
  return resolveRolePermissions(user.role as UserRole, row?.permissions ?? null);
}

export async function listTenantRolePermissions(tenantId: string) {
  await seedTenantRolePermissions(tenantId);
  const map = await getRolePermissionMap(tenantId);

  return EDITABLE_TENANT_ROLES.map((role) => {
    const permissions = resolveRolePermissions(role, map.get(role) ?? null);
    return {
      role,
      permissions,
      editable: true,
    };
  }).concat([
    {
      role: "ADMIN" as UserRole,
      permissions: tenantAdminPermissions(),
      editable: false,
    },
  ]);
}

export async function updateTenantRolePermissions(
  tenantId: string,
  roles: Array<{ role: string; permissions: string[] }>,
) {
  if (!roles?.length) {
    throw new RolePermissionServiceError("Nenhuma alteração enviada");
  }

  const updates = roles.filter((r) =>
    EDITABLE_TENANT_ROLES.includes(r.role as UserRole),
  );
  if (updates.length === 0) {
    throw new RolePermissionServiceError(
      "Nenhum cargo editável informado (ADMIN não pode ser alterado)",
    );
  }

  await prisma.$transaction(async (tx) => {
    await seedTenantRolePermissions(tenantId, tx);
    for (const item of updates) {
      const role = item.role as UserRole;
      const permissions = expandRoleMatrixPermissions(item.permissions).filter(
        (p) => p !== Permission.TENANTS_MANAGE,
      );
      const invalid = permissions.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
      if (invalid.length) {
        throw new RolePermissionServiceError(
          `Permissões inválidas: ${invalid.join(", ")}`,
        );
      }
      await tx.tenantRolePermission.upsert({
        where: { tenantId_role: { tenantId, role } },
        create: { tenantId, role, permissions },
        update: { permissions },
      });
    }
  });

  return listTenantRolePermissions(tenantId);
}
