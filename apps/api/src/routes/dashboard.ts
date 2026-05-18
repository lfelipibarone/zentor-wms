import type { FastifyInstance } from "fastify";
import { createPermissionGuard } from "../lib/auth-guard.js";
import { Permission } from "@wms/shared";

const requireDashboard = createPermissionGuard(Permission.DASHBOARD_VIEW);
import { getDashboardProductivity } from "../services/dashboard-productivity.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard/productivity", { preHandler: requireDashboard }, async (_request, reply) => {
    try {
      const data = await getDashboardProductivity();
      return data;
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: "Erro ao gerar dashboard" });
    }
  });
}
