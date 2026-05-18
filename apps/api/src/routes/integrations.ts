import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import {
  getTinyWebhookSecret,
  logIntegrationEvent,
  parseTinyWebhookPayload,
  upsertOrderFromTiny,
} from "../services/tiny-integration.js";

export async function integrationRoutes(app: FastifyInstance) {
  app.post("/integrations/tiny/webhook", async (request, reply) => {
    const secret = await getTinyWebhookSecret();
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
        source: "TINY",
        eventType: "webhook",
        status: "IGNORED",
        message: "Payload não reconhecido",
        payload: body,
      });
      return { ok: true, ignored: true };
    }

    try {
      const result = await upsertOrderFromTiny(parsed);
      await logIntegrationEvent({
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
