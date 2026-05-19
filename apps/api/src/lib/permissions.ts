import {
  ALL_PERMISSION_KEYS,
  canAccessMobile,
  canAccessWeb,
  defaultPermissionsForRole,
  hasPermission,
  Permission,
  PLATFORM_ADMIN_PERMISSIONS,
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
  isPlatformAdmin?: boolean;
}): string[] {
  if (user.isPlatformAdmin) return [...PLATFORM_ADMIN_PERMISSIONS];
  if (user.role === "ADMIN") {
    return ALL_PERMISSION_KEYS.filter((k) => k !== Permission.TENANTS_MANAGE);
  }
  if (user.permissions.length > 0) return user.permissions;
  return defaultPermissionsForRole(user.role as UserRole);
}

export function requirePermissionKey(
  user: { role: string; permissions: string[]; isPlatformAdmin?: boolean },
  permission: PermissionKey,
): boolean {
  return hasPermission(user, permission);
}
