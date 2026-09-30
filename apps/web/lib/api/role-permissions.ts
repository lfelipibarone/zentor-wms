import { apiFetch } from "@/lib/api/client";
import type { PermissionKey, UserRole } from "@wms/shared";

export type RolePermissionRow = {
  role: UserRole;
  permissions: PermissionKey[];
  editable: boolean;
};

export function fetchRolePermissions() {
  return apiFetch<{ roles: RolePermissionRow[] }>("/api/admin/role-permissions");
}

export function updateRolePermissions(
  roles: Array<{ role: string; permissions: string[] }>,
) {
  return apiFetch<{ roles: RolePermissionRow[] }>("/api/admin/role-permissions", {
    method: "PUT",
    body: JSON.stringify({ roles }),
  });
}
