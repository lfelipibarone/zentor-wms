import type { FastifyRequest } from "fastify";

/** Retorna o ID do usuário autenticado (JWT). Falha se não houver sessão. */
export function resolveUserId(request: FastifyRequest): string {
  const id = request.authUser?.id;
  if (!id) {
    throw new Error("Usuário não autenticado");
  }
  return id;
}
