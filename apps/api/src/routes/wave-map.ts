import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { tenantWhere } from "../lib/tenant-context.js";
import { PickWaveError } from "../services/pick-wave-error.js";
import {
  WaveMapError,
  createWaveTemplate,
  deleteWaveTemplate,
  getWaveMap,
  listWaveTemplates,
  updateWaveTemplate,
  type WaveTemplateInput,
} from "../services/wave-map.js";

type Guard = (permission: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof WaveMapError) return reply.status(e.statusCode).send({ error: e.message });
  if (e instanceof PickWaveError) return reply.status(e.statusCode).send({ error: e.message });
  throw e;
}

export function registerWaveMapRoutes(app: FastifyInstance, guard: Guard) {
  app.get<{ Querystring: { barracaoId?: string; marketplace?: string } }>(
    "/api/waves/map",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      try {
        return await getWaveMap(tenantWhere(request).tenantId, {
          barracaoId: request.query.barracaoId?.trim() || undefined,
          marketplace: request.query.marketplace?.trim() || undefined,
        });
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.get<{ Querystring: { barracaoId?: string } }>(
    "/api/waves/templates",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => ({
      templates: await listWaveTemplates(tenantWhere(request).tenantId, request.query.barracaoId?.trim() || undefined),
    }),
  );

  app.post<{ Body: WaveTemplateInput }>(
    "/api/waves/templates",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      try {
        return { template: await createWaveTemplate(tenantWhere(request).tenantId, request.body ?? {}) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.put<{ Params: { id: string }; Body: WaveTemplateInput }>(
    "/api/waves/templates/:id",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      try {
        return {
          template: await updateWaveTemplate(tenantWhere(request).tenantId, request.params.id, request.body ?? {}),
        };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/waves/templates/:id",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      try {
        await deleteWaveTemplate(tenantWhere(request).tenantId, request.params.id);
        return { ok: true };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
