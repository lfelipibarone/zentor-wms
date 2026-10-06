import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { parsePagination } from "../lib/pagination.js";
import { tenantWhere } from "../lib/tenant-context.js";
import { LocationRuleError } from "../services/location-rules.js";
import {
  assignProductLocation,
  getProductForAdmin,
  listProductsForAdmin,
  ProductAdminError,
  setProductQrCode,
  unassignProductLocation,
  type ProductMissingFilter,
} from "../services/product-admin.js";

type Guard = (permission: string) => (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

const MISSING_FILTERS: ProductMissingFilter[] = ["location", "image", "barcode"];

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof ProductAdminError) return reply.status(e.statusCode).send({ error: e.message });
  if (e instanceof LocationRuleError) return reply.status(400).send({ error: e.message });
  throw e;
}

export function registerProductRoutes(app: FastifyInstance, guard: Guard) {
  app.get<{ Querystring: { q?: string; missing?: string; page?: string; pageSize?: string } }>(
    "/api/products",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request) => {
      const missing = MISSING_FILTERS.find((m) => m === request.query.missing);
      return listProductsForAdmin(tenantWhere(request).tenantId, {
        q: request.query.q,
        missing,
        ...parsePagination(request.query),
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/products/:id",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request, reply) => {
      try {
        return { product: await getProductForAdmin(tenantWhere(request).tenantId, request.params.id) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.put<{ Params: { id: string }; Body: { qrCode?: string | null } }>(
    "/api/products/:id/qr-code",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request, reply) => {
      try {
        const product = await setProductQrCode(
          tenantWhere(request).tenantId,
          request.params.id,
          request.body?.qrCode ?? null,
        );
        return { product };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { locationId?: string; replace?: boolean } }>(
    "/api/products/:id/locations",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const locationId = request.body?.locationId;
      if (!locationId) return reply.status(400).send({ error: "Informe a posição" });
      try {
        return await assignProductLocation(tenantWhere(request).tenantId, request.params.id, {
          locationId,
          replace: request.body?.replace === true,
        });
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.delete<{ Params: { id: string; locationId: string } }>(
    "/api/products/:id/locations/:locationId",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        return await unassignProductLocation(
          tenantWhere(request).tenantId,
          request.params.id,
          request.params.locationId,
        );
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
