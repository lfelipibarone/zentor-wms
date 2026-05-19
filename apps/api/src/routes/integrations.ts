import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import {
  getTinyWebhookSecret,
  logIntegrationEvent,
  parseTinyWebhookPayload,
  upsertOrderFromTiny,
} from "../services/tiny-integration.js";

async function resolveWebhookTenantId(
  request: { query: Record<string, unknown>; headers: Record<string, unknown> },
): Promise<string | null> {
  const slug =
    (typeof request.query.tenant === "string" ? request.query.tenant : null) ??
    (typeof request.headers["x-tenant-slug"] === "string"
      ? request.headers["x-tenant-slug"]
      : null);

  if (slug) {
    const t = await prisma.tenant.findUnique({ where: { slug } });
    return t?.active ? t.id : null;
  }

  const first = await prisma.tenant.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  return first?.id ?? null;
}

export async function integrationRoutes(app: FastifyInstance) {
  app.post("/integrations/tiny/webhook", async (request, reply) => {
    const tenantId = await resolveWebhookTenantId({
      query: request.query as Record<string, unknown>,
      headers: request.headers as Record<string, unknown>,
    });
    if (!tenantId) {
      return reply.status(400).send({ error: "Cliente (tenant) não identificado" });
    }

    const secret = await getTinyWebhookSecret(tenantId);
    if (secret) {
      const header =
        (request.headers["x-tiny-token"] as string | undefined) ??
        (request.headers["authorization"] as string | undefined);
      const token = header?.replace(/^Bearer\s+/i, "").trim();
      if (token !== secret) {
        return reply.status(401).send({ error: "Token inválido" });
      }
    }

    const body = request.body;
    const parsed = parseTinyWebhookPayload(body);

    if (!parsed) {
      await logIntegrationEvent({
        tenantId,
        source: "TINY",
        eventType: "webhook",
        status: "IGNORED",
        message: "Payload não reconhecido",
        payload: body,
      });
      return { ok: true, ignored: true };
    }

    try {
      const result = await upsertOrderFromTiny(tenantId, parsed);
      await logIntegrationEvent({
        tenantId,
        source: "TINY",
        eventType: "webhook",
        externalId: parsed.erpOrderId,
        status: "OK",
        message: result.created ? "Pedido criado" : "Pedido atualizado",
        payload: body,
      });
      return { ok: true, ...result };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao processar";
      await logIntegrationEvent({
        tenantId,
        source: "TINY",
        eventType: "webhook",
        externalId: parsed.erpOrderId,
        status: "ERROR",
        message,
        payload: body,
      });
      return reply.status(422).send({ error: message });
    }
  });
}
