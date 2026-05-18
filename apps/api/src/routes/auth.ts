import type { FastifyInstance } from "fastify";
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { verifyPassword, hashPassword } from "../lib/password.js";
import { requireAuth } from "../lib/auth-guard.js";
import {
  canAccessMobile,
  canAccessWeb,
  effectivePermissions,
} from "../lib/permissions.js";
import { signSession } from "../lib/session-token.js";
import { toPublicUser } from "../lib/user-dto.js";

export async function authRoutes(app: FastifyInstance) {
  app.post<{
    Body: { email?: string; password?: string };
  }>("/auth/login", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;

    if (!email || !password) {
      return reply.status(400).send({ error: "E-mail e senha são obrigatórios" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || !verifyPassword(password, user.password)) {
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    if (!canAccessWeb(user)) {
      return reply.status(403).send({
        error: "Este usuário não tem acesso ao painel web",
      });
    }

    const permissions = effectivePermissions(user);
    const token = signSession({
      id: user.id,
      email: user.email,
      role: user.role,
      permissions,
    });

    return {
      token,
      user: toPublicUser(user),
    };
  });

  app.post<{
    Body: { email?: string; password?: string };
  }>("/auth/mobile/login", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;

    if (!email || !password) {
      return reply.status(400).send({ error: "E-mail e senha são obrigatórios" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || !verifyPassword(password, user.password)) {
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    if (!canAccessMobile(user)) {
      return reply.status(403).send({
        error: "Este usuário não tem acesso ao app mobile",
      });
    }

    const permissions = effectivePermissions(user);
    const token = signSession({
      id: user.id,
      email: user.email,
      role: user.role,
      permissions,
    });

    return {
      token,
      user: toPublicUser(user),
    };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    return { user: toPublicUser(request.authUser!) };
  });

  app.patch<{
    Body: {
      name?: string;
      email?: string;
      avatarUrl?: string | null;
      currentPassword?: string;
      newPassword?: string;
    };
  }>("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.authUser!.id },
    });
    if (!user) {
      return reply.status(404).send({ error: "Usuário não encontrado" });
    }

    const { name, email, avatarUrl, currentPassword, newPassword } =
      request.body ?? {};
    const data: {
      name?: string;
      email?: string;
      avatarUrl?: string | null;
      password?: string;
    } = {};

    if (name?.trim()) data.name = name.trim();

    if (avatarUrl !== undefined) {
      data.avatarUrl = avatarUrl?.trim() || null;
    }

    if (email?.trim()) {
      const normalized = email.trim().toLowerCase();
      const exists = await prisma.user.findFirst({
        where: { email: normalized, NOT: { id: user.id } },
      });
      if (exists) {
        return reply.status(409).send({ error: "E-mail já em uso" });
      }
      data.email = normalized;
    }

    if (newPassword) {
      if (!currentPassword || !verifyPassword(currentPassword, user.password)) {
        return reply.status(400).send({ error: "Senha atual incorreta" });
      }
      if (newPassword.length < 6) {
        return reply
          .status(400)
          .send({ error: "Nova senha deve ter ao menos 6 caracteres" });
      }
      data.password = hashPassword(newPassword);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    return { user: toPublicUser(updated) };
  });

  app.patch<{ Body: { token?: string } }>(
    "/auth/me/olist-token",
    { preHandler: requireAuth },
    async (request, reply) => {
      const token = request.body?.token?.trim() ?? "";
      const updated = await prisma.user.update({
        where: { id: request.authUser!.id },
        data: { olistToken: token || null },
      });
      return { user: toPublicUser(updated), configured: Boolean(token) };
    },
  );

  app.get(
    "/auth/me/olist-token",
    { preHandler: requireAuth },
    async (request) => {
      const user = await prisma.user.findUnique({
        where: { id: request.authUser!.id },
        select: { olistToken: true },
      });
      return { configured: Boolean(user?.olistToken?.trim()) };
    },
  );

  app.get("/auth/permissions/catalog", { preHandler: requireAuth }, async () => {
    return { catalog: PERMISSION_CATALOG, keys: ALL_PERMISSION_KEYS };
  });
}
