import type { FastifyInstance } from "fastify";
import {
  requireSettingsManage,
  requireWebAccess,
} from "../lib/auth-guard.js";
import { tenantWhere } from "../lib/tenant-context.js";
import {
  defaultOAuthRedirectUri,
  getOrCreateTinyConnection,
  getTinyConnectionStatus,
  handleTinyOAuthCallback,
  oauthCallbackHtml,
  saveTinyOAuthCredentials,
  startTinyOAuth,
} from "../services/tiny-oauth.js";
import { prisma } from "../lib/prisma.js";
import { TinyConnectionStatus } from "@prisma/client";
import { syncPendingOrderPrioritiesFromTiny } from "../services/tiny-integration.js";

export async function tinyRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/integrations/tiny/oauth/callback", async (request, reply) => {
    if (request.query.error) {
      return reply
        .type("text/html")
        .send(
          oauthCallbackHtml({
            success: false,
            message: String(request.query.error),
          }),
        );
    }

    const code = request.query.code;
    const state = request.query.state;
    if (!code || !state) {
      return reply
        .type("text/html")
        .send(
          oauthCallbackHtml({
            success: false,
            message: "Código ou state OAuth ausente",
          }),
        );
    }

    const result = await handleTinyOAuthCallback({ code, state });
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
      { preHandler: requireSettingsManage },
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
            redirectUri: request.body?.redirectUri,
          });
        } else if (conn.oauthClientSecret) {
          await prisma.tinyConnection.update({
            where: { id: conn.id },
            data: {
              oauthClientId: clientId,
              oauthRedirectUri:
                request.body?.redirectUri?.trim() ||
                conn.oauthRedirectUri ||
                defaultOAuthRedirectUri(),
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
      "/api/integrations/tiny/sync-order-priorities",
      { preHandler: requireSettingsManage },
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

    secured.post(
      "/api/integrations/tiny/oauth/authorize",
      { preHandler: requireSettingsManage },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        try {
          const { authUrl, connectionId } = await startTinyOAuth(
            tenantWhere(request).tenantId,
            request.authUser.id,
          );
          return { authUrl, connectionId };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Erro ao iniciar OAuth";
          return reply.status(400).send({ error: message });
        }
      },
    );
  });
}
