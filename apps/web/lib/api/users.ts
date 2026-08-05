import { apiFetch } from "@/lib/api/client";
import type { AuthUser } from "@/lib/auth";
import type { PaginationMeta } from "@/lib/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import type { PermissionKey } from "@wms/shared";

export interface CreateUserBody {
  email: string;
  name: string;
  password: string;
  role: string;
  active?: boolean;
  permissions?: PermissionKey[];
}

export interface UpdateUserBody {
  email?: string;
  name?: string;
  password?: string;
  role?: string;
  active?: boolean;
  permissions?: PermissionKey[];
}

export function fetchUsers(params?: {
  page?: number;
  pageSize?: number;
  q?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.q) sp.set("q", params.q);
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ users: AuthUser[]; pagination: PaginationMeta }>(
    `/api/admin/users?${sp}`,
  );
}

export function createUser(body: CreateUserBody) {
  return apiFetch<{ user: AuthUser }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateUser(id: string, body: UpdateUserBody) {
  return apiFetch<{ user: AuthUser }>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
