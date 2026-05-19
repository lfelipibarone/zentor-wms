import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

export function getAuthTenantId(
  request: FastifyRequest,
): string | null | undefined {
  return request.authUser?.tenantId ?? null;
}

/** Filtro Prisma `{ tenantId }` para rotas operacionais do tenant. */
export function tenantWhere(request: FastifyRequest): { tenantId: string } {
  const tenantId = requireTenantId(request);
  return { tenantId };
}

export function requireTenantId(request: FastifyRequest): string {
  const tenantId = request.authUser?.tenantId;
  if (!tenantId) {
    throw new TenantContextError("Operação requer um cliente (tenant) vinculado ao usuário");
  }
  return tenantId;
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

export async function requireTenantContext(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | void> {
  if (!request.authUser) {
    reply.status(401).send({ error: "Não autenticado" });
    return;
  }
  if (request.authUser.isPlatformAdmin && !request.authUser.tenantId) {
    reply.status(403).send({
      error:
        "Super-admin da plataforma não opera dados de cliente nesta rota. Use o painel de clientes.",
    });
    return;
  }
  if (!request.authUser.tenantId) {
    reply.status(403).send({ error: "Usuário sem cliente vinculado" });
    return;
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: request.authUser.tenantId },
    select: { id: true, active: true },
  });
  if (!tenant?.active) {
    reply.status(403).send({ error: "Cliente inativo ou não encontrado" });
    return;
  }
  return tenant.id;
}

export async function assertResourceTenant(
  resourceTenantId: string,
  requestTenantId: string,
): Promise<void> {
  if (resourceTenantId !== requestTenantId) {
    throw new TenantContextError("Recurso não pertence ao seu cliente");
  }
}
