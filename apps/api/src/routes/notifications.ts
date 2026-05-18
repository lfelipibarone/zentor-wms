import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth-guard.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { page?: string; pageSize?: string; unreadOnly?: string } }>(
    "/api/notifications",
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.authUser!.id;
      const { page, pageSize, skip, take } = parsePagination(request.query, 15);
      const unreadOnly = request.query.unreadOnly === "true";

      const where = {
        userId,
        ...(unreadOnly ? { readAt: null } : {}),
      };

      const [items, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId, readAt: null } }),
      ]);

      return {
        notifications: items.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          category: n.category,
          data: n.data ? JSON.parse(n.data) : null,
          readAt: n.readAt,
          createdAt: n.createdAt,
        })),
        unreadCount,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/notifications/:id/read",
    { preHandler: requireAuth },
    async (request, reply) => {
      const n = await prisma.notification.findFirst({
        where: { id: request.params.id, userId: request.authUser!.id },
      });
      if (!n) return reply.status(404).send({ error: "Notificação não encontrada" });

      await prisma.notification.update({
        where: { id: n.id },
        data: { readAt: new Date() },
      });
      return { ok: true };
    },
  );

  app.post(
    "/api/notifications/read-all",
    { preHandler: requireAuth },
    async (request) => {
      await prisma.notification.updateMany({
        where: { userId: request.authUser!.id, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: true };
    },
  );

  app.post<{
    Body: { platform?: string; token?: string };
  }>(
    "/api/notifications/register-device",
    { preHandler: requireAuth },
    async (request, reply) => {
      const platform = request.body?.platform?.trim();
      const token = request.body?.token?.trim();

      if (!platform || !token) {
        return reply.status(400).send({ error: "platform e token são obrigatórios" });
      }
      if (!["expo", "web"].includes(platform)) {
        return reply.status(400).send({ error: "platform inválida" });
      }

      await prisma.pushDevice.upsert({
        where: {
          userId_platform_token: {
            userId: request.authUser!.id,
            platform,
            token,
          },
        },
        create: {
          userId: request.authUser!.id,
          platform,
          token,
        },
        update: { updatedAt: new Date() },
      });

      return { ok: true };
    },
  );
}
