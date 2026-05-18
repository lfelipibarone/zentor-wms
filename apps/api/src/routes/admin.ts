import type { FastifyInstance } from "fastify";
import {
  ALL_PERMISSION_KEYS,
  defaultPermissionsForRole,
  type UserRole,
} from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import {
  requireUsersManage,
  requireSettingsManage,
} from "../lib/auth-guard.js";
import { toPublicUser } from "../lib/user-dto.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";

const ROLES: UserRole[] = ["ADMIN", "EXPEDITER", "REPLENISHER", "PICKER"];

export async function adminRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { page?: string; pageSize?: string; q?: string } }>(
    "/api/admin/users",
    { preHandler: requireUsersManage },
    async (request) => {
      const q = request.query.q?.trim();
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where = q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {};
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { name: "asc" },
          skip,
          take,
        }),
        prisma.user.count({ where }),
      ]);
      return {
        users: users.map(toPublicUser),
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{
    Body: {
      email?: string;
      name?: string;
      password?: string;
      role?: string;
      permissions?: string[];
      active?: boolean;
    };
  }>("/api/admin/users", { preHandler: requireUsersManage }, async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const name = request.body?.name?.trim();
    const password = request.body?.password;
    const role = (request.body?.role ?? "EXPEDITER") as UserRole;

    if (!email || !name || !password) {
      return reply
        .status(400)
        .send({ error: "E-mail, nome e senha são obrigatórios" });
    }
    if (!ROLES.includes(role)) {
      return reply.status(400).send({ error: "Papel inválido" });
    }
    if (password.length < 6) {
      return reply
        .status(400)
        .send({ error: "Senha deve ter ao menos 6 caracteres" });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return reply.status(409).send({ error: "E-mail já cadastrado" });
    }

    const permissions =
      request.body?.permissions?.filter((p) =>
        ALL_PERMISSION_KEYS.includes(p as never),
      ) ?? defaultPermissionsForRole(role);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashPassword(password),
        role,
        permissions,
        active: request.body?.active ?? true,
      },
    });

    return reply.status(201).send({ user: toPublicUser(user) });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      email?: string;
      name?: string;
      password?: string;
      role?: string;
      permissions?: string[];
      active?: boolean;
    };
  }>(
    "/api/admin/users/:id",
    { preHandler: requireUsersManage },
    async (request, reply) => {
      const existing = await prisma.user.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Usuário não encontrado" });
      }

      const data: {
        email?: string;
        name?: string;
        password?: string;
        role?: UserRole;
        permissions?: string[];
        active?: boolean;
      } = {};

      if (request.body?.name?.trim()) data.name = request.body.name.trim();
      if (request.body?.email?.trim()) {
        const email = request.body.email.trim().toLowerCase();
        const clash = await prisma.user.findFirst({
          where: { email, NOT: { id: existing.id } },
        });
        if (clash) {
          return reply.status(409).send({ error: "E-mail já em uso" });
        }
        data.email = email;
      }
      if (request.body?.password) {
        if (request.body.password.length < 6) {
          return reply
            .status(400)
            .send({ error: "Senha deve ter ao menos 6 caracteres" });
        }
        data.password = hashPassword(request.body.password);
      }
      if (request.body?.role) {
        if (!ROLES.includes(request.body.role as UserRole)) {
          return reply.status(400).send({ error: "Papel inválido" });
        }
        data.role = request.body.role as UserRole;
      }
      if (request.body?.permissions) {
        data.permissions = request.body.permissions.filter((p) =>
          ALL_PERMISSION_KEYS.includes(p as never),
        );
      }
      if (typeof request.body?.active === "boolean") {
        data.active = request.body.active;
      }

      const user = await prisma.user.update({
        where: { id: existing.id },
        data,
      });

      return { user: toPublicUser(user) };
    },
  );

  app.get(
    "/api/admin/settings",
    { preHandler: requireSettingsManage },
    async () => {
      const settings = await prisma.systemSetting.findMany({
        orderBy: { key: "asc" },
      });
      return { settings };
    },
  );

  app.put<{
    Body: { settings?: Array<{ key: string; value: string; description?: string }> };
  }>(
    "/api/admin/settings",
    { preHandler: requireSettingsManage },
    async (request, reply) => {
      const items = request.body?.settings;
      if (!items?.length) {
        return reply.status(400).send({ error: "Nenhuma configuração enviada" });
      }

      const updated = await prisma.$transaction(
        items.map((item) =>
          prisma.systemSetting.upsert({
            where: { key: item.key },
            create: {
              key: item.key,
              value: item.value,
              description: item.description,
              updatedById: request.authUser!.id,
            },
            update: {
              value: item.value,
              description: item.description,
              updatedById: request.authUser!.id,
            },
          }),
        ),
      );

      return { settings: updated };
    },
  );
}
