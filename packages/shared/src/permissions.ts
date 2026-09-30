import type { UserRole } from "./types/prisma.js";

/** Chaves de permissão do Help Route WMS */
export const Permission = {
  MOBILE_ACCESS: "mobile.access",
  WEB_ACCESS: "web.access",
  DASHBOARD_VIEW: "dashboard.view",
  SEARCH_USE: "search.use",
  REGISTERS_VIEW: "registers.view",
  PRODUCTS_MANAGE: "products.manage",
  SALES_VIEW: "sales.view",
  RECEIPTS_VIEW: "receipts.view",
  STOCK_VIEW: "stock.view",
  SHIPPING_VIEW: "shipping.view",
  REPORTS_VIEW: "reports.view",
  SYSTEM_VIEW: "system.view",
  USERS_MANAGE: "users.manage",
  TENANTS_MANAGE: "tenants.manage",
  SETTINGS_MANAGE: "settings.manage",
  OLIST_CONFIGURE: "olist.configure",
  NOTIFICATIONS_VIEW: "notifications.view",
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionMeta[] = [
  { key: Permission.MOBILE_ACCESS, label: "Acesso ao app mobile", group: "Geral" },
  { key: Permission.WEB_ACCESS, label: "Acesso ao painel web", group: "Geral" },
  { key: Permission.DASHBOARD_VIEW, label: "Dashboard", group: "Operação" },
  { key: Permission.REGISTERS_VIEW, label: "Cadastros", group: "Operação" },
  { key: Permission.SALES_VIEW, label: "Pedidos", group: "Operação" },
  { key: Permission.RECEIPTS_VIEW, label: "Recebimentos", group: "Operação" },
  { key: Permission.STOCK_VIEW, label: "Estoque", group: "Operação" },
  { key: Permission.SHIPPING_VIEW, label: "Expedição", group: "Operação" },
  { key: Permission.REPORTS_VIEW, label: "Relatórios", group: "Admin" },
  { key: Permission.SYSTEM_VIEW, label: "Sistema", group: "Sistema" },
  { key: Permission.USERS_MANAGE, label: "Gerenciar usuários", group: "Admin" },
  {
    key: Permission.TENANTS_MANAGE,
    label: "Gerenciar clientes (plataforma)",
    group: "Plataforma",
  },
  {
    key: Permission.SETTINGS_MANAGE,
    label: "Configurações do sistema",
    group: "Admin",
  },
  {
    key: Permission.OLIST_CONFIGURE,
    label: "Integração Olist",
    group: "Integrações",
  },
  {
    key: Permission.NOTIFICATIONS_VIEW,
    label: "Notificações",
    group: "Geral",
  },
];

/** Permissões editáveis na matriz de cargos (canais + módulos) */
export const ROLE_MATRIX_CATALOG: PermissionMeta[] = [
  { key: Permission.MOBILE_ACCESS, label: "App Mobile", group: "Canais" },
  { key: Permission.WEB_ACCESS, label: "Painel Web", group: "Canais" },
  { key: Permission.SALES_VIEW, label: "Pedidos", group: "Módulos" },
  { key: Permission.RECEIPTS_VIEW, label: "Recebimentos", group: "Módulos" },
  { key: Permission.STOCK_VIEW, label: "Estoque", group: "Módulos" },
  { key: Permission.SHIPPING_VIEW, label: "Expedição", group: "Módulos" },
  { key: Permission.REGISTERS_VIEW, label: "Cadastros", group: "Módulos" },
  { key: Permission.REPORTS_VIEW, label: "Relatórios", group: "Módulos" },
];

export const ROLE_MATRIX_KEYS = ROLE_MATRIX_CATALOG.map((p) => p.key);

/** Cargos cuja matriz pode ser editada pelo admin da empresa */
export const EDITABLE_TENANT_ROLES: UserRole[] = [
  "PICKER",
  "REPLENISHER",
  "EXPEDITER",
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

/** Super-admin da plataforma (sem tenant) — apenas gestão de clientes e acesso web */
export const PLATFORM_ADMIN_PERMISSIONS: PermissionKey[] = [
  Permission.WEB_ACCESS,
  Permission.TENANTS_MANAGE,
  Permission.NOTIFICATIONS_VIEW,
];

export function isPlatformOnlyAdmin(user: {
  isPlatformAdmin?: boolean;
  tenantId?: string | null;
}): boolean {
  return Boolean(user.isPlatformAdmin && !user.tenantId);
}

const TENANT_ADMIN_PERMISSIONS = ALL_PERMISSION_KEYS.filter(
  (k) => k !== Permission.TENANTS_MANAGE,
);

const ROLE_DEFAULTS: Record<UserRole, PermissionKey[]> = {
  ADMIN: [...TENANT_ADMIN_PERMISSIONS],
  EXPEDITER: [
    Permission.WEB_ACCESS,
    Permission.DASHBOARD_VIEW,
    Permission.REGISTERS_VIEW,
    Permission.PRODUCTS_MANAGE,
    Permission.SALES_VIEW,
    Permission.RECEIPTS_VIEW,
    Permission.STOCK_VIEW,
    Permission.SHIPPING_VIEW,
    Permission.NOTIFICATIONS_VIEW,
  ],
  REPLENISHER: [
    Permission.MOBILE_ACCESS,
    Permission.WEB_ACCESS,
    Permission.STOCK_VIEW,
    Permission.NOTIFICATIONS_VIEW,
  ],
  PICKER: [Permission.MOBILE_ACCESS, Permission.NOTIFICATIONS_VIEW],
};

export function defaultPermissionsForRole(role: UserRole): PermissionKey[] {
  return [...ROLE_DEFAULTS[role]];
}

export function tenantAdminPermissions(): PermissionKey[] {
  return [...TENANT_ADMIN_PERMISSIONS];
}

/**
 * Resolve permissões de um cargo a partir da matriz do tenant.
 * `matrixPermissions` = linha salva; se ausente, usa defaults do sistema.
 */
export function resolveRolePermissions(
  role: UserRole,
  matrixPermissions?: string[] | null,
): PermissionKey[] {
  if (role === "ADMIN") return tenantAdminPermissions();
  if (matrixPermissions && matrixPermissions.length > 0) {
    return matrixPermissions.filter((p): p is PermissionKey =>
      ALL_PERMISSION_KEYS.includes(p as PermissionKey),
    );
  }
  return defaultPermissionsForRole(role);
}

/** Completa chaves derivadas ao salvar a matriz editável */
export function expandRoleMatrixPermissions(
  selected: string[],
): PermissionKey[] {
  const set = new Set<PermissionKey>(
    selected.filter((p): p is PermissionKey =>
      ROLE_MATRIX_KEYS.includes(p as PermissionKey),
    ),
  );
  set.add(Permission.NOTIFICATIONS_VIEW);
  if (set.has(Permission.WEB_ACCESS)) {
    set.add(Permission.DASHBOARD_VIEW);
  }
  if (set.has(Permission.REGISTERS_VIEW)) {
    set.add(Permission.PRODUCTS_MANAGE);
  }
  return [...set];
}

/**
 * `user.permissions` deve já estar resolvido (matriz do cargo).
 * Fallback para defaults apenas se a lista vier vazia (legado).
 */
export function hasPermission(
  user: { role: string; permissions: string[]; isPlatformAdmin?: boolean },
  permission: PermissionKey,
): boolean {
  if (user.isPlatformAdmin) {
    return PLATFORM_ADMIN_PERMISSIONS.includes(permission);
  }
  if (user.role === "ADMIN") {
    return permission !== Permission.TENANTS_MANAGE;
  }
  const perms =
    user.permissions.length > 0
      ? user.permissions
      : defaultPermissionsForRole(user.role as UserRole);
  return perms.includes(permission);
}

export function canAccessWeb(user: {
  role: string;
  permissions: string[];
  isPlatformAdmin?: boolean;
}): boolean {
  return hasPermission(user, Permission.WEB_ACCESS);
}

export function canAccessMobile(user: {
  role: string;
  permissions: string[];
  isPlatformAdmin?: boolean;
}): boolean {
  if (user.isPlatformAdmin) return false;
  return hasPermission(user, Permission.MOBILE_ACCESS);
}
