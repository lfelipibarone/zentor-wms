import { effectivePermissions } from "./permissions.js";

export function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  active?: boolean;
  avatarUrl?: string | null;
  olistToken?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: effectivePermissions(user),
    active: user.active ?? true,
    avatarUrl: user.avatarUrl ?? null,
    olistConfigured: Boolean(user.olistToken?.trim()),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
