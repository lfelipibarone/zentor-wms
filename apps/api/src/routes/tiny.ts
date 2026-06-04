import type { FastifyInstance } from "fastify";
import {
  requireOlistConfigure,
  requireWebAccess,
} from "../lib/auth-guard.js";
import { tenantWhere } from "../lib/tenant-context.js";
import {
  cancelTinyDraft,
  defaultOAuthRedirectUri,
  disconnectTinyConnection,
  getOrCreateTinyConnection,
  getTinyConnectionStatus,
  handleTinyOAuthCallback,
  oauthCallbackHtml,
  oauthCallbackJson,
  resolveOAuthRedirectUri,
  saveTinyOAuthCredentials,
  startTinyOAuth,
  testTinyConnection,
} from "../services/tiny-oauth.js";
import { prisma } from "../lib/prisma.js";
import { TinyConnectionStatus } from "@prisma/client";
import { syncPendingOrderPrioritiesFromTiny } from "../services/tiny-integration.js";
import { syncSalesOrdersFromTiny } from "../services/sync-sales-orders-from-tiny.js";

function wantsJson(request: {
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
}): boolean {
  const accept = String(request.headers.accept ?? "");
  if (accept.includes("application/json")) return true;
  return request.query.format === "json";
}

export async function tinyRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; format?: string };
  }>("/integrations/tiny/oauth/callback", async (request, reply) => {
    const asJson = wantsJson({
      headers: request.headers as Record<string, unknown>,
      query: request.query as Record<string, unknown>,
    });

    const fail = (message: string) => {
      const result = { success: false, message };
      if (asJson) {
        return reply.send(oauthCallbackJson(result));
      }
      return reply.type("text/html").send(oauthCallbackHtml(result));
    };

    if (request.query.error) {
      return fail(String(request.query.error));
    }

    const code = request.query.code;
    const state = request.query.state;
    if (!code || !state) {
      return fail("Código ou state OAuth ausente");
    }

    const result = await handleTinyOAuthCallback({ code, state });
    if (asJson) {
      return reply.send(oauthCallbackJson(result));
    }
    return reply.type("text/html").send(oauthCallbackHtml(result));
  });

  app.register(async (secured) => {
    secured.addHook("onRequest", requireWebAccess);

    secured.get("/api/integrations/tiny/connection", async (request) => {
      return getTinyConnectionStatus(tenantWhere(request).tenantId);
    });

    secured.get("/api/integrations/tiny/oauth/redirect-uri", async () => {
      return { redirectUri: defaultOAuthRedirectUri() };
    });

    secured.put<{
      Body: {
        clientId?: string;
        clientSecret?: string;
        redirectUri?: string;
      };
    }>(
      "/api/integrations/tiny/credentials",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        const tenantId = tenantWhere(request).tenantId;
        const clientId = request.body?.clientId?.trim();
        const clientSecret = request.body?.clientSecret?.trim();
        const conn = await getOrCreateTinyConnection(tenantId);

        if (!clientId) {
          return reply.status(400).send({ error: "clientId é obrigatório" });
        }

        if (clientSecret) {
          await saveTinyOAuthCredentials(tenantId, {
            clientId,
            clientSecret,
            redirectUri: resolveOAuthRedirectUri(request.body?.redirectUri),
          });
        } else if (conn.oauthClientSecret) {
          await prisma.tinyConnection.update({
            where: { id: conn.id },
            data: {
              oauthClientId: clientId,
              oauthRedirectUri: resolveOAuthRedirectUri(
                request.body?.redirectUri ?? conn.oauthRedirectUri,
              ),
              status: TinyConnectionStatus.PENDING,
            },
          });
        } else {
          return reply
            .status(400)
            .send({ error: "clientSecret é obrigatório na primeira configuração" });
        }
        return getTinyConnectionStatus(tenantId);
      },
    );

    secured.post(
      "/api/integrations/tiny/test-connection",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        const result = await testTinyConnection(tenantWhere(request).tenantId);
        if (!result.ok) {
          return reply.status(400).send(result);
        }
        return result;
      },
    );

    secured.post(
      "/api/integrations/tiny/disconnect",
      { preHandler: requireOlistConfigure },
      async (request) => {
        return disconnectTinyConnection(tenantWhere(request).tenantId);
      },
    );

    secured.delete(
      "/api/integrations/tiny/draft",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        try {
          return await cancelTinyDraft(tenantWhere(request).tenantId);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Erro ao cancelar rascunho";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.post(
      "/api/integrations/tiny/sync-order-priorities",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        try {
          const result = await syncPendingOrderPrioritiesFromTiny(
            tenantWhere(request).tenantId,
          );
          return result;
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Erro ao sincronizar prioridades";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.post<{ Body: { days?: number } }>(
      "/api/integrations/tiny/sync-orders",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        try {
          const days = request.body?.days;
          const result = await syncSalesOrdersFromTiny({
            tenantId: tenantWhere(request).tenantId,
            ...(days !== undefined ? { days } : {}),
          });
          return result;
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Erro ao sincronizar pedidos";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.post(
      "/api/integrations/tiny/oauth/authorize",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        try {
          const { authUrl, state, connectionId } = await startTinyOAuth(
            tenantWhere(request).tenantId,
            request.authUser.id,
          );
          return { authUrl, state, connectionId };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Erro ao iniciar OAuth";
          return reply.status(400).send({ error: message });
        }
      },
    );
  });
}
