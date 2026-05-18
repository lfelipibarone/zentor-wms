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
  { key: Permission.SEARCH_USE, label: "Pesquisa rápida", group: "Operação" },
  { key: Permission.REGISTERS_VIEW, label: "Cadastros", group: "Operação" },
  { key: Permission.PRODUCTS_MANAGE, label: "Produtos", group: "Operação" },
  { key: Permission.SALES_VIEW, label: "Vendas", group: "Operação" },
  { key: Permission.RECEIPTS_VIEW, label: "Recebimentos", group: "Operação" },
  { key: Permission.STOCK_VIEW, label: "Estoque", group: "Operação" },
  { key: Permission.SHIPPING_VIEW, label: "Expedição", group: "Operação" },
  { key: Permission.REPORTS_VIEW, label: "Relatórios", group: "Admin" },
  { key: Permission.SYSTEM_VIEW, label: "Sistema", group: "Sistema" },
  { key: Permission.USERS_MANAGE, label: "Gerenciar usuários", group: "Admin" },
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

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

const ROLE_DEFAULTS: Record<UserRole, PermissionKey[]> = {
  ADMIN: [...ALL_PERMISSION_KEYS],
  EXPEDITER: [
    Permission.WEB_ACCESS,
    Permission.DASHBOARD_VIEW,
    Permission.SEARCH_USE,
    Permission.REGISTERS_VIEW,
    Permission.PRODUCTS_MANAGE,
    Permission.SALES_VIEW,
    Permission.RECEIPTS_VIEW,
    Permission.STOCK_VIEW,
    Permission.SHIPPING_VIEW,
    Permission.SYSTEM_VIEW,
    Permission.OLIST_CONFIGURE,
    Permission.NOTIFICATIONS_VIEW,
  ],
  REPLENISHER: [
    Permission.MOBILE_ACCESS,
    Permission.WEB_ACCESS,
    Permission.STOCK_VIEW,
    Permission.SEARCH_USE,
    Permission.NOTIFICATIONS_VIEW,
  ],
  PICKER: [Permission.MOBILE_ACCESS, Permission.NOTIFICATIONS_VIEW],
};

export function defaultPermissionsForRole(role: UserRole): PermissionKey[] {
  return [...ROLE_DEFAULTS[role]];
}

export function hasPermission(
  user: { role: string; permissions: string[] },
  permission: PermissionKey,
): boolean {
  if (user.role === "ADMIN") return true;
  return user.permissions.includes(permission);
}

export function canAccessWeb(user: {
  role: string;
  permissions: string[];
}): boolean {
  return hasPermission(user, Permission.WEB_ACCESS);
}

const MOBILE_ROLES = new Set(["PICKER", "REPLENISHER", "EXPEDITER"]);

export function canAccessMobile(user: {
  role: string;
  permissions: string[];
}): boolean {
  if (user.role === "ADMIN") return true;
  if (hasPermission(user, Permission.MOBILE_ACCESS)) return true;
  return MOBILE_ROLES.has(user.role);
}
