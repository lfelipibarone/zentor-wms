import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { tenantWhere } from "../lib/tenant-context.js";
import {
  ApproachWaveError,
  listApproachWaves,
  listTenantApproachWaves,
  parseKind,
  saveApproachWaves,
  type ApproachWaveInput,
} from "../services/approach-waves/store.js";

type Guard = (permission: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof ApproachWaveError) return reply.status(e.statusCode).send({ error: e.message });
  throw e;
}

export function registerApproachWaveRoutes(app: FastifyInstance, guard: Guard) {
  app.get<{ Params: { barracaoId: string }; Querystring: { kind?: string } }>(
    "/api/warehouse/floor-plans/:barracaoId/approach-waves",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        const kind = parseKind(request.query.kind);
        return { waves: await listApproachWaves(tenantWhere(request).tenantId, request.params.barracaoId, kind) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.put<{ Params: { barracaoId: string }; Querystring: { kind?: string }; Body: { waves?: ApproachWaveInput[] } }>(
    "/api/warehouse/floor-plans/:barracaoId/approach-waves",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        const kind = parseKind(request.query.kind);
        const waves = await saveApproachWaves(
          tenantWhere(request).tenantId,
          request.params.barracaoId,
          kind,
          request.body?.waves ?? [],
        );
        return { waves };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.get<{ Querystring: { kind?: string } }>(
    "/api/approach-waves",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        const kind = parseKind(request.query.kind);
        return { waves: await listTenantApproachWaves(tenantWhere(request).tenantId, kind) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
