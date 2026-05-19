import type { FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { requireWebAccess } from "./auth-guard.js";
import { requirePermissionKey } from "./permissions.js";

export async function requirePlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireWebAccess(request, reply);
  if (reply.sent || !request.authUser) return;

  if (!request.authUser.isPlatformAdmin) {
    reply.status(403).send({ error: "Acesso restrito ao administrador da plataforma" });
    return;
  }

  if (
    !requirePermissionKey(request.authUser, Permission.TENANTS_MANAGE)
  ) {
    reply.status(403).send({ error: "Permissão negada" });
  }
}
