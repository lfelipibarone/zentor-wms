import type { FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { prisma } from "./prisma.js";
import {
  canAccessMobile,
  canAccessWeb,
  requirePermissionKey,
} from "./permissions.js";
import { requireTenantContext } from "./tenant-context.js";
import { verifySession, type SessionPayload } from "./session-token.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionPayload;
    authUser?: {
      id: string;
      email: string;
      name: string;
      role: string;
      permissions: string[];
      tenantId: string | null;
      isPlatformAdmin: boolean;
    };
  }
}

async function loadAuthUser(request: FastifyRequest): Promise<boolean> {
  if (!request.session) return false;
  const user = await prisma.user.findUnique({
    where: { id: request.session.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      permissions: true,
      active: true,
      tenantId: true,
      isPlatformAdmin: true,
    },
  });
  if (!user || !user.active) return false;
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { active: true },
    });
    if (!tenant?.active) return false;
  }
  request.authUser = user;
  return true;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7)
      : null;

  if (!token) {
    reply.status(401).send({ error: "Não autenticado" });
    return;
  }

  const session = verifySession(token);
  if (!session) {
    reply.status(401).send({ error: "Sessão inválida ou expirada" });
    return;
  }

  request.session = session;
  const ok = await loadAuthUser(request);
  if (!ok) {
    reply.status(401).send({ error: "Usuário inválido ou inativo" });
  }
}

export async function requireWebAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent || !request.authUser) return;

  if (!canAccessWeb(request.authUser)) {
    reply.status(403).send({ error: "Sem permissão para o painel web" });
  }
}

export async function requireMobileAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent || !request.authUser) return;

  if (request.authUser.isPlatformAdmin && !request.authUser.tenantId) {
    reply.status(403).send({
      error: "Super-admin da plataforma não acessa o app mobile",
    });
    return;
  }

  if (!canAccessMobile(request.authUser)) {
    reply.status(403).send({ error: "Sem permissão para o app mobile" });
    return;
  }

  await requireTenantContext(request, reply);
}

export function createPermissionGuard(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireWebAccess(request, reply);
    if (reply.sent || !request.authUser) return;

    if (!requirePermissionKey(request.authUser, permission as never)) {
      reply.status(403).send({ error: "Permissão negada" });
      return;
    }
    await requireTenantContext(request, reply);
  };
}

export const requireUsersManage = createPermissionGuard(Permission.USERS_MANAGE);
export const requireSettingsManage = createPermissionGuard(
  Permission.SETTINGS_MANAGE,
);
