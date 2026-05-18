import {
  ALL_PERMISSION_KEYS,
  canAccessMobile,
  canAccessWeb,
  defaultPermissionsForRole,
  hasPermission,
  type PermissionKey,
  type UserRole,
} from "@wms/shared";

export {
  ALL_PERMISSION_KEYS,
  canAccessMobile,
  canAccessWeb,
  defaultPermissionsForRole,
  hasPermission,
  type PermissionKey,
  type UserRole,
};

export function effectivePermissions(user: {
  role: string;
  permissions: string[];
}): string[] {
  if (user.role === "ADMIN") return [...ALL_PERMISSION_KEYS];
  if (user.permissions.length > 0) return user.permissions;
  return defaultPermissionsForRole(user.role as UserRole);
}

export function requirePermissionKey(
  user: { role: string; permissions: string[] },
  permission: PermissionKey,
): boolean {
  const perms = effectivePermissions(user);
  return user.role === "ADMIN" || perms.includes(permission);
}
