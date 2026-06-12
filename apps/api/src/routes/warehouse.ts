import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";
import { tenantWhere } from "../lib/tenant-context.js";
import {
  getFullWarehouseTree,
  getWarehouseTree,
  listWarehouseBarracoes,
} from "../services/warehouse-tree.js";

type Guard = (permission: string) => (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

type WarehouseDelegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  findFirst: (args: unknown) => Promise<unknown | null>;
};

type EntityDef = {
  segment: string;
  responseKey: string;
  parentField?: string;
  listInclude?: Record<string, unknown>;
  delegate: WarehouseDelegate;
};

const ENTITIES: EntityDef[] = [
  {
    segment: "barracoes",
    responseKey: "barracoes",
    delegate: prisma.warehouseBarracao as unknown as WarehouseDelegate,
  },
  {
    segment: "setores",
    responseKey: "setores",
    parentField: "barracaoId",
    listInclude: { barracao: { select: { code: true, name: true } } },
    delegate: prisma.warehouseSetor as unknown as WarehouseDelegate,
  },
  {
    segment: "corredores",
    responseKey: "corredores",
    parentField: "setorId",
    listInclude: {
      setor: {
        select: {
          code: true,
          name: true,
          barracao: { select: { code: true } },
        },
      },
    },
    delegate: prisma.warehouseCorredor as unknown as WarehouseDelegate,
  },
  {
    segment: "fileiras",
    responseKey: "fileiras",
    parentField: "corredorId",
    listInclude: {
      corredor: {
        select: {
          code: true,
          setor: { select: { code: true, barracao: { select: { code: true } } } },
        },
      },
    },
    delegate: prisma.warehouseFileira as unknown as WarehouseDelegate,
  },
  {
    segment: "estantes",
    responseKey: "estantes",
    parentField: "setorId",
    listInclude: {
      setor: {
        select: { code: true, barracao: { select: { code: true } } },
      },
    },
    delegate: prisma.warehouseEstante as unknown as WarehouseDelegate,
  },
  {
    segment: "prateleiras",
    responseKey: "prateleiras",
    parentField: "estanteId",
    listInclude: {
      estante: {
        select: {
          code: true,
          setor: { select: { code: true, barracao: { select: { code: true } } } },
        },
      },
    },
    delegate: prisma.warehousePrateleira as unknown as WarehouseDelegate,
  },
  {
    segment: "colunas",
    responseKey: "colunas",
    parentField: "prateleiraId",
    listInclude: {
      prateleira: {
        select: {
          code: true,
          estante: {
            select: {
              code: true,
              setor: { select: { code: true, barracao: { select: { code: true } } } },
            },
          },
        },
      },
    },
    delegate: prisma.warehouseColuna as unknown as WarehouseDelegate,
  },
];

export function registerWarehouseRoutes(app: FastifyInstance, guard: Guard) {
  app.get(
    "/api/warehouse/barracoes-list",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const barracoes = await listWarehouseBarracoes(
        tenantWhere(request).tenantId,
      );
      return { barracoes };
    },
  );

  app.get(
    "/api/warehouse/full-tree",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const trees = await getFullWarehouseTree(tenantWhere(request).tenantId);
      return { trees };
    },
  );

  app.get<{ Querystring: { barracaoId?: string } }>(
    "/api/warehouse/tree",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const barracaoId = request.query.barracaoId?.trim();
      if (!barracaoId) {
        return reply.status(400).send({ error: "barracaoId obrigatório" });
      }
      try {
        const tree = await getWarehouseTree(
          tenantWhere(request).tenantId,
          barracaoId,
        );
        return { tree };
      } catch (e) {
        return reply.status(404).send({
          error: e instanceof Error ? e.message : "Barracão não encontrado",
        });
      }
    },
  );

  for (const entity of ENTITIES) {
    const base = `/api/warehouse/${entity.segment}`;

    app.get<{ Querystring: { page?: string; pageSize?: string; parentId?: string } }>(
      base,
      { preHandler: guard(Permission.REGISTERS_VIEW) },
      async (request) => {
        const { page, pageSize, skip, take } = parsePagination(request.query);
        const tw = tenantWhere(request);
        const parentId = request.query.parentId?.trim();
        const where = {
          ...tw,
          ...(entity.parentField && parentId
            ? { [entity.parentField]: parentId }
            : {}),
        };
        const [items, total] = await Promise.all([
          entity.delegate.findMany({
            where,
            orderBy: [{ pickOrder: "asc" }, { code: "asc" }],
            skip,
            take,
            include: entity.listInclude,
          }),
          entity.delegate.count({ where }),
        ]);
        return {
          [entity.responseKey]: items,
          pagination: buildPaginationMeta(total, page, pageSize),
        };
      },
    );

    app.post<{
      Body: {
        code?: string;
        name?: string;
        pickOrder?: number;
        active?: boolean;
        barracaoId?: string;
        setorId?: string;
        corredorId?: string;
        estanteId?: string;
        prateleiraId?: string;
      };
    }>(
      base,
      { preHandler: guard(Permission.REGISTERS_VIEW) },
      async (request, reply) => {
        const b = request.body ?? {};
        if (!b.code?.trim()) {
          return reply.status(400).send({ error: "Código obrigatório" });
        }
        if (entity.parentField) {
          const parentVal = (b as Record<string, string | undefined>)[
            entity.parentField
          ];
          if (!parentVal) {
            return reply.status(400).send({ error: "Vínculo pai obrigatório" });
          }
        }
        try {
          const item = await entity.delegate.create({
            data: {
              tenantId: tenantWhere(request).tenantId,
              code: normalizeCode(b.code),
              name: b.name?.trim() || null,
              pickOrder: b.pickOrder ?? 0,
              active: b.active ?? true,
              ...(entity.parentField
                ? {
                    [entity.parentField]: (b as Record<string, string>)[
                      entity.parentField
                    ],
                  }
                : {}),
            },
            include: entity.listInclude,
          });
          return reply.status(201).send({ item });
        } catch {
          return reply.status(409).send({ error: "Código já cadastrado neste nível" });
        }
      },
    );

    app.patch<{
      Params: { id: string };
      Body: {
        code?: string;
        name?: string | null;
        pickOrder?: number;
        active?: boolean;
      };
    }>(
      `${base}/:id`,
      { preHandler: guard(Permission.REGISTERS_VIEW) },
      async (request, reply) => {
        const existing = await entity.delegate.findFirst({
          where: { id: request.params.id, ...tenantWhere(request) },
        });
        if (!existing) {
          return reply.status(404).send({ error: "Registro não encontrado" });
        }
        const b = request.body ?? {};
        const data: Record<string, unknown> = {};
        if (b.code !== undefined) data.code = normalizeCode(b.code);
        if (b.name !== undefined) data.name = b.name?.trim() || null;
        if (b.pickOrder !== undefined) data.pickOrder = b.pickOrder;
        if (b.active !== undefined) data.active = b.active;
        try {
          const item = await entity.delegate.update({
            where: { id: request.params.id },
            data,
            include: entity.listInclude,
          });
          return { item };
        } catch {
          return reply.status(409).send({ error: "Código já cadastrado neste nível" });
        }
      },
    );
  }
}
