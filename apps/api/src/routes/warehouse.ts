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
import {
  createWarehousePosition,
  updateWarehousePosition,
} from "../services/warehouse-positions.js";
import {
  listWarehouseEstanteRows,
  listWarehouseLayoutEstantes,
  listWarehouseLayoutRows,
  listWarehouseProximityOptions,
  parseLayoutSituacao,
} from "../services/warehouse-layout-list.js";
import { buildWarehouseSegmentSearchWhere } from "../services/warehouse-segment-search.js";
import { generateEstantePositions } from "../services/estante-generator.js";
import { resizeEstante, setEstanteFace } from "../services/estante-resize.js";
import {
  applyInventoryLayout,
  planInventoryLayout,
  type InventoryRowInput,
} from "../services/inventory-layout.js";
import { LocationType } from "@prisma/client";

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
    listInclude: { barracao: { select: { id: true, code: true, name: true } } },
    delegate: prisma.warehouseSetor as unknown as WarehouseDelegate,
  },
  {
    segment: "corredores",
    responseKey: "corredores",
    parentField: "setorId",
    listInclude: {
      setor: {
        select: {
          id: true,
          code: true,
          name: true,
          barracaoId: true,
          barracao: { select: { id: true, code: true } },
        },
      },
    },
    delegate: prisma.warehouseCorredor as unknown as WarehouseDelegate,
  },
  {
    segment: "estantes",
    responseKey: "estantes",
    parentField: "corredorId",
    listInclude: {
      corredor: {
        select: {
          id: true,
          code: true,
          setorId: true,
          setor: {
            select: {
              id: true,
              code: true,
              barracaoId: true,
              barracao: { select: { id: true, code: true } },
            },
          },
        },
      },
    },
    delegate: prisma.warehouseEstante as unknown as WarehouseDelegate,
  },
  {
    segment: "colunas",
    responseKey: "colunas",
    parentField: "estanteId",
    listInclude: {
      estante: {
        select: {
          id: true,
          code: true,
          corredorId: true,
          corredor: {
            select: {
              id: true,
              code: true,
              setorId: true,
              setor: {
                select: {
                  id: true,
                  code: true,
                  barracaoId: true,
                  barracao: { select: { id: true, code: true } },
                },
              },
            },
          },
        },
      },
    },
    delegate: prisma.warehouseColuna as unknown as WarehouseDelegate,
  },
  {
    segment: "linhas",
    responseKey: "linhas",
    parentField: "colunaId",
    listInclude: {
      coluna: {
        select: {
          id: true,
          code: true,
          estanteId: true,
          estante: {
            select: {
              id: true,
              code: true,
              corredorId: true,
              corredor: {
                select: {
                  id: true,
                  code: true,
                  setorId: true,
                  setor: {
                    select: {
                      id: true,
                      code: true,
                      barracaoId: true,
                      barracao: { select: { id: true, code: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      location: {
        include: {
          product: { select: { sku: true, name: true } },
        },
      },
    },
    delegate: prisma.warehouseLinha as unknown as WarehouseDelegate,
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

  app.get<{
    Querystring: {
      barracaoId?: string;
      q?: string;
      tipo?: string;
      estanteId?: string;
      colunaId?: string;
      face?: string;
      situacao?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    "/api/warehouse/layout-rows",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const barracaoId = request.query.barracaoId?.trim();
      if (!barracaoId) {
        return reply.status(400).send({ error: "barracaoId obrigatório" });
      }
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const tipoRaw = request.query.tipo?.trim().toLowerCase();
      let locationType: "PULMAO" | "PICK_FACE" | undefined;
      if (tipoRaw === "pulmao") locationType = "PULMAO";
      else if (tipoRaw === "pick_face" || tipoRaw === "estoque-de-giro") {
        locationType = "PICK_FACE";
      }
      const faceRaw = request.query.face?.trim().toUpperCase();
      const { rows, total } = await listWarehouseLayoutRows(
        tenantWhere(request).tenantId,
        {
          barracaoId,
          q: request.query.q,
          locationType,
          estanteId: request.query.estanteId?.trim() || undefined,
          colunaId: request.query.colunaId?.trim() || undefined,
          face: faceRaw === "A" || faceRaw === "B" ? faceRaw : undefined,
          situacao: parseLayoutSituacao(request.query.situacao),
          skip,
          take,
        },
      );
      return {
        rows,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.get<{ Querystring: { barracaoId?: string } }>(
    "/api/warehouse/layout-estantes",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const barracaoId = request.query.barracaoId?.trim();
      if (!barracaoId) {
        return reply.status(400).send({ error: "barracaoId obrigatório" });
      }
      const estantes = await listWarehouseLayoutEstantes(
        tenantWhere(request).tenantId,
        barracaoId,
      );
      return { estantes };
    },
  );

  app.get<{ Querystring: { estanteId?: string } }>(
    "/api/warehouse/estante-rows",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const estanteId = request.query.estanteId?.trim();
      if (!estanteId) {
        return reply.status(400).send({ error: "estanteId obrigatório" });
      }
      const rows = await listWarehouseEstanteRows(
        tenantWhere(request).tenantId,
        estanteId,
      );
      return { rows };
    },
  );

  app.get<{
    Querystring: { barracaoId?: string; excludeLinhaId?: string };
  }>(
    "/api/warehouse/proximity-options",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const barracaoId = request.query.barracaoId?.trim();
      if (!barracaoId) {
        return reply.status(400).send({ error: "barracaoId obrigatório" });
      }
      const options = await listWarehouseProximityOptions(
        tenantWhere(request).tenantId,
        barracaoId,
        request.query.excludeLinhaId?.trim() || undefined,
      );
      return options;
    },
  );

  for (const entity of ENTITIES) {
    const base = `/api/warehouse/${entity.segment}`;

    app.get<{
      Querystring: {
        page?: string;
        pageSize?: string;
        parentId?: string;
        q?: string;
        availableOnly?: string;
      };
    }>(
      base,
      { preHandler: guard(Permission.REGISTERS_VIEW) },
      async (request) => {
        const { page, pageSize, skip, take } = parsePagination(request.query);
        const tw = tenantWhere(request);
        const parentId = request.query.parentId?.trim();
        const q = request.query.q?.trim();
        const availableOnly =
          entity.segment === "linhas" &&
          request.query.availableOnly === "true";
        const where = buildWarehouseSegmentSearchWhere(
          entity.segment,
          tw.tenantId,
          q,
          {
            parentId,
            parentField: entity.parentField,
            availableOnly,
          },
        );
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
      };
    }>(
      base,
      { preHandler: guard(Permission.REGISTERS_VIEW) },
      async (request, reply) => {
        const b = request.body ?? {};
        const blockedStructuralSegments = new Set([
          "setores",
          "corredores",
          "estantes",
          "colunas",
          "linhas",
        ]);
        if (blockedStructuralSegments.has(entity.segment)) {
          return reply.status(400).send({
            error:
              "Cadastre a estrutura junto com a localização via POST /api/warehouse/positions ou importação.",
          });
        }
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

    app.post<{
      Body: {
        items?: Array<{ code?: string; name?: string; pickOrder?: number }>;
        pickOrderStart?: number;
        barracaoId?: string;
        setorId?: string;
        corredorId?: string;
        estanteId?: string;
      };
    }>(
      `${base}/batch`,
      { preHandler: guard(Permission.REGISTERS_VIEW) },
      async (request, reply) => {
        const blockedBatchSegments = new Set([
          "setores",
          "corredores",
          "estantes",
          "colunas",
          "linhas",
        ]);
        if (blockedBatchSegments.has(entity.segment)) {
          return reply.status(400).send({
            error:
              "Cadastro em lote estrutural desativado. Cadastre localizações via posição ou importação.",
          });
        }
        const b = request.body ?? {};
        const rawItems = b.items ?? [];
        if (rawItems.length === 0) {
          return reply.status(400).send({ error: "Lista de itens obrigatória" });
        }
        if (rawItems.length > 500) {
          return reply.status(400).send({ error: "Máximo de 500 itens por lote" });
        }

        if (entity.parentField) {
          const parentVal = (b as Record<string, string | undefined>)[
            entity.parentField
          ];
          if (!parentVal) {
            return reply.status(400).send({ error: "Vínculo pai obrigatório" });
          }
        }

        const tenantId = tenantWhere(request).tenantId;
        const parentData = entity.parentField
          ? {
              [entity.parentField]: (b as Record<string, string>)[
                entity.parentField
              ],
            }
          : {};

        let nextOrder = b.pickOrderStart ?? 0;
        const created: unknown[] = [];
        const errors: Array<{ code: string; message: string }> = [];

        for (const item of rawItems) {
          if (!item.code?.trim()) {
            errors.push({ code: "", message: "Código vazio ignorado" });
            continue;
          }
          const pickOrder =
            item.pickOrder !== undefined ? item.pickOrder : nextOrder++;
          try {
            const row = await entity.delegate.create({
              data: {
                tenantId,
                code: normalizeCode(item.code),
                name: item.name?.trim() || null,
                pickOrder,
                active: true,
                ...parentData,
              },
              include: entity.listInclude,
            });
            created.push(row);
          } catch {
            errors.push({
              code: item.code,
              message: "Código já cadastrado neste nível",
            });
          }
        }

        return reply.status(201).send({
          created: created.length,
          errors,
          items: created,
        });
      },
    );

    app.patch<{
      Body: { items?: Array<{ id?: string; pickOrder?: number }> };
    }>(
      `${base}/reorder`,
      { preHandler: guard(Permission.REGISTERS_VIEW) },
      async (request, reply) => {
        const items = request.body?.items ?? [];
        if (items.length === 0) {
          return reply.status(400).send({ error: "Lista de itens obrigatória" });
        }
        for (const item of items) {
          if (!item.id || item.pickOrder === undefined || item.pickOrder < 0) {
            return reply.status(400).send({ error: "id e pickOrder válidos obrigatórios" });
          }
        }

        const tenantId = tenantWhere(request).tenantId;
        const ids = items.map((i) => i.id!);
        const existing = await entity.delegate.findMany({
          where: { id: { in: ids }, tenantId },
        });
        if (existing.length !== ids.length) {
          return reply.status(404).send({ error: "Um ou mais registros não encontrados" });
        }

        await Promise.all(
          items.map((item) =>
            entity.delegate.update({
              where: { id: item.id! },
              data: { pickOrder: item.pickOrder! },
            }),
          ),
        );

        return { ok: true, updated: items.length };
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

  app.post<{
    Body: {
      colunaId?: string;
      setorCode?: string;
      corredorCode?: string;
      estanteCode?: string;
      colunaCode?: string;
      linhaCode?: string;
      linhaName?: string | null;
      face?: "A" | "B";
      barcode?: string;
      type?: LocationType;
      productId?: string | null;
      capacity?: number;
      minPercent?: number;
      fillPercent?: number;
      active?: boolean;
      barracaoId?: string | null;
      setorId?: string | null;
      corredorId?: string | null;
      estanteId?: string | null;
      proximityCorredorId?: string | null;
      proximityEstanteId?: string | null;
      proximityLinhaId?: string | null;
      proximityReferences?: Array<{
        proximityCorredorId?: string | null;
        proximityEstanteId?: string | null;
        proximityLinhaId?: string | null;
      }>;
    };
  }>(
    "/api/warehouse/positions",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const b = request.body ?? {};
      try {
        const result = await createWarehousePosition(
          tenantWhere(request).tenantId,
          {
            colunaId: b.colunaId,
            setorCode: b.setorCode,
            corredorCode: b.corredorCode,
            estanteCode: b.estanteCode,
            colunaCode: b.colunaCode,
            linhaCode: b.linhaCode ?? "",
            linhaName: b.linhaName,
            face: b.face,
            barcode: b.barcode ?? "",
            type: b.type ?? LocationType.PULMAO,
            productId: b.productId,
            capacity: b.capacity ?? 100,
            minPercent: b.minPercent,
            fillPercent: b.fillPercent,
            active: b.active,
            barracaoId: b.barracaoId,
            setorId: b.setorId,
            corredorId: b.corredorId,
            estanteId: b.estanteId,
            proximityCorredorId: b.proximityCorredorId,
            proximityEstanteId: b.proximityEstanteId,
            proximityLinhaId: b.proximityLinhaId,
            proximityReferences: b.proximityReferences,
          },
        );
        return reply.status(201).send(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao criar posição";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{
    Body: {
      barracaoId?: string;
      estanteCode?: string;
      ld?: { colunas?: number; linhas?: number };
      le?: { colunas?: number; linhas?: number } | null;
      type?: LocationType;
      capacity?: number;
      minPercent?: number;
    };
  }>(
    "/api/warehouse/estantes/generate",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const b = request.body ?? {};
      const tenantId = tenantWhere(request).tenantId;
      const barracao = b.barracaoId
        ? await prisma.warehouseBarracao.findFirst({
            where: { id: b.barracaoId, tenantId },
            select: { id: true },
          })
        : null;
      if (!barracao) return reply.status(400).send({ error: "Barracão inválido" });
      if (b.type && b.type !== LocationType.PULMAO && b.type !== LocationType.PICK_FACE) {
        return reply.status(400).send({ error: "Tipo inválido" });
      }
      try {
        const result = await generateEstantePositions(tenantId, {
          barracaoId: barracao.id,
          estanteCode: b.estanteCode ?? "",
          ld: { colunas: Number(b.ld?.colunas), linhas: Number(b.ld?.linhas) },
          le: b.le ? { colunas: Number(b.le.colunas), linhas: Number(b.le.linhas) } : null,
          type: b.type,
          capacity: b.capacity != null ? Number(b.capacity) : undefined,
          minPercent: b.minPercent != null ? Number(b.minPercent) : undefined,
        });
        return reply.status(201).send(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao gerar estante";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.patch<{
    Params: { estanteId: string };
    Body: {
      ld?: { colunas?: number; linhas?: number };
      le?: { colunas?: number; linhas?: number } | null;
      name?: string | null;
    };
  }>(
    "/api/warehouse/estantes/:estanteId/structure",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const b = request.body ?? {};
      try {
        return await resizeEstante(tenantWhere(request).tenantId, request.params.estanteId, {
          ld: { colunas: Number(b.ld?.colunas), linhas: Number(b.ld?.linhas) },
          le: b.le ? { colunas: Number(b.le.colunas), linhas: Number(b.le.linhas) } : null,
          name: b.name,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao alterar estante";
        return reply.status(msg.includes("não encontrad") ? 404 : 400).send({ error: msg });
      }
    },
  );

  app.patch<{ Params: { estanteId: string }; Body: { face?: string } }>(
    "/api/warehouse/estantes/:estanteId/face",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const face = request.body?.face;
      if (face !== "A" && face !== "B") return reply.status(400).send({ error: "Lado inválido" });
      try {
        return await setEstanteFace(tenantWhere(request).tenantId, request.params.estanteId, face);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao alterar lado";
        return reply.status(msg.includes("não encontrad") ? 404 : 400).send({ error: msg });
      }
    },
  );

  const MAX_INVENTORY_ROWS = 20000;
  const inventoryRows = (raw: unknown): InventoryRowInput[] | null => {
    if (!Array.isArray(raw) || raw.length > MAX_INVENTORY_ROWS) return null;
    return raw.map((r) => ({
      address: String((r as { address?: unknown })?.address ?? ""),
      sku: String((r as { sku?: unknown })?.sku ?? ""),
    }));
  };
  const sideInput = (raw: unknown) => {
    const s = raw as { colunas?: unknown; linhas?: unknown } | null | undefined;
    if (!s || !(Number(s.colunas) > 0)) return null;
    return { colunas: Math.floor(Number(s.colunas)), linhas: Math.floor(Number(s.linhas)) };
  };

  app.post<{ Body: { rows?: unknown } }>(
    "/api/warehouse/inventory-layout/preview",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const rows = inventoryRows(request.body?.rows);
      if (!rows) return reply.status(400).send({ error: `Envie até ${MAX_INVENTORY_ROWS} linhas` });
      const tenantId = tenantWhere(request).tenantId;
      const plan = planInventoryLayout(rows);
      const barracoes = await prisma.warehouseBarracao.findMany({
        where: { tenantId },
        select: { code: true },
      });
      const known = new Set(barracoes.map((b) => b.code.toUpperCase()));
      const missingBarracoes = [...new Set(plan.estantes.map((e) => e.barracao))].filter(
        (code) => !known.has(code),
      );
      return { ...plan, missingBarracoes };
    },
  );

  app.post<{ Body: { rows?: unknown; estantes?: unknown } }>(
    "/api/warehouse/inventory-layout/apply",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const rows = inventoryRows(request.body?.rows);
      if (!rows) return reply.status(400).send({ error: `Envie até ${MAX_INVENTORY_ROWS} linhas` });
      if (!Array.isArray(request.body?.estantes)) {
        return reply.status(400).send({ error: "Informe as estantes" });
      }
      const estantes = [];
      for (const raw of request.body.estantes as Array<Record<string, unknown>>) {
        const ld = sideInput(raw?.ld);
        if (!ld || !(ld.linhas > 0)) {
          return reply.status(400).send({ error: `Estante ${String(raw?.estante)}: LD inválido` });
        }
        estantes.push({
          barracao: String(raw.barracao ?? "").toUpperCase(),
          estante: String(raw.estante ?? "").toUpperCase(),
          ld,
          le: sideInput(raw.le),
        });
      }
      try {
        return await applyInventoryLayout(tenantWhere(request).tenantId, { rows, estantes });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao importar layout";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.patch<{
    Params: { linhaId: string };
    Body: {
      linhaCode?: string;
      linhaName?: string | null;
      linhaActive?: boolean;
      face?: "A" | "B";
      barcode?: string;
      type?: LocationType;
      productId?: string | null;
      capacity?: number;
      minPercent?: number;
      fillPercent?: number;
      active?: boolean;
      proximityCorredorId?: string | null;
      proximityEstanteId?: string | null;
      proximityLinhaId?: string | null;
      proximityReferences?: Array<{
        proximityCorredorId?: string | null;
        proximityEstanteId?: string | null;
        proximityLinhaId?: string | null;
      }>;
    };
  }>(
    "/api/warehouse/positions/:linhaId",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        const result = await updateWarehousePosition(
          tenantWhere(request).tenantId,
          {
            linhaId: request.params.linhaId,
            ...request.body,
          },
        );
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao atualizar posição";
        const status = msg.includes("não encontrad") ? 404 : 400;
        return reply.status(status).send({ error: msg });
      }
    },
  );
}
