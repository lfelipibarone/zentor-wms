import type { FastifyInstance } from "fastify";
import { ALL_PERMISSION_KEYS } from "@wms/shared";
import { requirePlatformAdmin } from "../lib/platform-guard.js";
import { toPublicUser } from "../lib/user-dto.js";
import {
  createTenant,
  createTenantAdminUser,
  listTenants,
  listTenantUsers,
  TenantServiceError,
  updateTenant,
} from "../services/tenants.js";

export async function platformRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>(
    "/api/platform/tenants",
    { preHandler: requirePlatformAdmin },
    async (request) => {
      const page = request.query.page ? Number(request.query.page) : 1;
      const pageSize = request.query.pageSize ? Number(request.query.pageSize) : 50;
      return listTenants({
        q: request.query.q?.trim(),
        page: Number.isFinite(page) ? page : 1,
        pageSize: Number.isFinite(pageSize) ? pageSize : 50,
      });
    },
  );

  app.post<{ Body: { name?: string; slug?: string } }>(
    "/api/platform/tenants",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        const tenant = await createTenant({
          name: request.body?.name ?? "",
          slug: request.body?.slug,
        });
        return reply.status(201).send({
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            active: tenant.active,
          },
        });
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; active?: boolean };
  }>(
    "/api/platform/tenants/:id",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        const tenant = await updateTenant(request.params.id, request.body ?? {});
        return {
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            active: tenant.active,
          },
        };
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/platform/tenants/:id/users",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        return await listTenantUsers(request.params.id);
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      email?: string;
      name?: string;
      password?: string;
      permissions?: string[];
    };
  }>(
    "/api/platform/tenants/:id/admin-user",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        const permissions = request.body?.permissions?.filter((p) =>
          ALL_PERMISSION_KEYS.includes(p as never),
        );
        const user = await createTenantAdminUser(request.params.id, {
          email: request.body?.email ?? "",
          name: request.body?.name ?? "",
          password: request.body?.password ?? "",
          permissions,
        });
        return reply.status(201).send({ user: toPublicUser(user) });
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );
}
