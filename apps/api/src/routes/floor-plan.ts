import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { tenantWhere } from "../lib/tenant-context.js";
import {
  FloorPlanConflictError,
  getFloorPlanEditorData,
  previewFloorPlanRoute,
  saveFloorPlan,
  validateAllFloorPlans,
  validateFloorPlanDraft,
  type FloorPlanDraft,
} from "../services/floor-plan.js";
import {
  getRoutingEngineKind,
  invalidateRouteEngine,
  ROUTING_ENGINE_KEY,
  type RouteEngineKind,
} from "../services/route-engine/index.js";

type Guard = (permission: string) => (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

function errorStatus(e: unknown): number {
  if (e instanceof FloorPlanConflictError) return 409;
  const msg = e instanceof Error ? e.message : "";
  return msg.includes("não encontrad") ? 404 : 400;
}

function sendError(reply: FastifyReply, e: unknown, fallback: string) {
  return reply.status(errorStatus(e)).send({ error: e instanceof Error ? e.message : fallback });
}

export function registerFloorPlanRoutes(app: FastifyInstance, guard: Guard) {
  app.get<{ Params: { barracaoId: string } }>(
    "/api/warehouse/floor-plans/:barracaoId",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        return await getFloorPlanEditorData(tenantWhere(request).tenantId, request.params.barracaoId);
      } catch (e) {
        return sendError(reply, e, "Erro ao carregar planta");
      }
    },
  );

  app.put<{ Params: { barracaoId: string }; Body: FloorPlanDraft & { expectedVersion?: number } }>(
    "/api/warehouse/floor-plans/:barracaoId",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        return await saveFloorPlan(tenantWhere(request).tenantId, request.params.barracaoId, request.body);
      } catch (e) {
        return sendError(reply, e, "Erro ao salvar planta");
      }
    },
  );

  app.post<{ Params: { barracaoId: string }; Body: { draft?: FloorPlanDraft } }>(
    "/api/warehouse/floor-plans/:barracaoId/validation",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        return await validateFloorPlanDraft(
          tenantWhere(request).tenantId,
          request.params.barracaoId,
          request.body?.draft,
        );
      } catch (e) {
        return sendError(reply, e, "Erro ao validar planta");
      }
    },
  );

  app.post<{
    Params: { barracaoId: string };
    Body: { locationIds?: string[]; orderId?: string; draft?: FloorPlanDraft };
  }>(
    "/api/warehouse/floor-plans/:barracaoId/route-preview",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        return await previewFloorPlanRoute(
          tenantWhere(request).tenantId,
          request.params.barracaoId,
          request.body ?? {},
        );
      } catch (e) {
        return sendError(reply, e, "Erro ao simular rota");
      }
    },
  );

  app.get("/api/warehouse/routing-engine", { preHandler: guard(Permission.REGISTERS_VIEW) }, async (request) => {
    const tenantId = tenantWhere(request).tenantId;
    const [kind, plans] = await Promise.all([getRoutingEngineKind(tenantId), validateAllFloorPlans(tenantId)]);
    return { kind, canEnablePhysical: plans.ok, plans: plans.plans };
  });

  app.put<{ Body: { kind?: RouteEngineKind } }>(
    "/api/warehouse/routing-engine",
    { preHandler: guard(Permission.SETTINGS_MANAGE) },
    async (request, reply) => {
      const kind = request.body?.kind;
      if (kind !== "LEGACY" && kind !== "PHYSICAL") {
        return reply.status(400).send({ error: "kind deve ser LEGACY ou PHYSICAL" });
      }
      const tenantId = tenantWhere(request).tenantId;
      if (kind === "PHYSICAL") {
        const plans = await validateAllFloorPlans(tenantId);
        if (!plans.ok) {
          return reply.status(400).send({
            error: "Corrija os erros de validação das plantas antes de ativar a rota física",
            plans: plans.plans,
          });
        }
      }
      await prisma.systemSetting.upsert({
        where: { tenantId_key: { tenantId, key: ROUTING_ENGINE_KEY } },
        update: { value: kind, updatedById: request.authUser!.id },
        create: { tenantId, key: ROUTING_ENGINE_KEY, value: kind, updatedById: request.authUser!.id },
      });
      invalidateRouteEngine(tenantId);
      return { kind };
    },
  );
}
