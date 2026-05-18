import type { FastifyInstance } from "fastify";
import {
  InventoryMovementType,
  LocationType,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { createPermissionGuard } from "../lib/auth-guard.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";
import { createNotification, notifyUsersWithPermission } from "../services/notifications.js";
import {
  getReportsSummary,
  reportToCsv,
  REPORT_IDS,
  runReport,
  type ReportId,
} from "../services/reports.js";
import {
  importLocations,
  normalizeImportRow,
  type LocationImportInput,
  type LocationImportMode,
} from "../services/location-import.js";

const guard = (p: string) => createPermissionGuard(p);

export async function webRoutes(app: FastifyInstance) {
  // --- Pesquisa rápida ---
  app.get<{ Querystring: { q?: string } }>(
    "/api/search",
    { preHandler: guard(Permission.SEARCH_USE) },
    async (request) => {
      const q = request.query.q?.trim();
      if (!q || q.length < 2) {
        return { products: [], orders: [], locations: [] };
      }
      const contains = { contains: q, mode: "insensitive" as const };

      const [products, orders, locations] = await Promise.all([
        prisma.product.findMany({
          where: {
            active: true,
            OR: [{ sku: contains }, { name: contains }, { barcode: contains }],
          },
          take: 15,
          orderBy: { sku: "asc" },
        }),
        prisma.order.findMany({
          where: {
            OR: [
              { erpOrderId: contains },
              { customerName: contains },
            ],
          },
          take: 15,
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { items: true } } },
        }),
        prisma.location.findMany({
          where: {
            active: true,
            OR: [{ barcode: contains }, { corridor: contains }, { row: contains }],
          },
          take: 15,
          include: { product: true },
        }),
      ]);

      return {
        products: products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode,
        })),
        orders: orders.map((o) => ({
          id: o.id,
          erpOrderId: o.erpOrderId,
          customerName: o.customerName,
          status: o.status,
          itemCount: o._count.items,
          createdAt: o.createdAt,
        })),
        locations: locations.map((l) => ({
          id: l.id,
          barcode: l.barcode,
          corridor: l.corridor,
          row: l.row,
          type: l.type,
          currentQuantity: l.currentQuantity,
          productSku: l.product?.sku ?? null,
          productName: l.product?.name ?? null,
        })),
      };
    },
  );

  // --- Produtos ---
  app.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>(
    "/api/products",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request) => {
      const q = request.query.q?.trim();
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where: Prisma.ProductWhereInput = q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { barcode: { contains: q, mode: "insensitive" } },
            ],
          }
        : {};
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          orderBy: { sku: "asc" },
          skip,
          take,
        }),
        prisma.product.count({ where }),
      ]);
      return { products, pagination: buildPaginationMeta(total, page, pageSize) };
    },
  );

  app.post<{
    Body: {
      sku?: string;
      name?: string;
      barcode?: string;
      requiresItemScan?: boolean;
    };
  }>(
    "/api/products",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request, reply) => {
      const { sku, name, barcode, requiresItemScan } = request.body ?? {};
      if (!sku?.trim() || !name?.trim()) {
        return reply.status(400).send({ error: "SKU e nome são obrigatórios" });
      }
      try {
        const product = await prisma.product.create({
          data: {
            sku: sku.trim().toUpperCase(),
            name: name.trim(),
            barcode: barcode?.trim() || null,
            requiresItemScan: requiresItemScan ?? false,
          },
        });
        return reply.status(201).send({ product });
      } catch {
        return reply.status(409).send({ error: "SKU ou código de barras já existe" });
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      barcode?: string;
      requiresItemScan?: boolean;
      active?: boolean;
    };
  }>(
    "/api/products/:id",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request, reply) => {
      const product = await prisma.product.update({
        where: { id: request.params.id },
        data: {
          name: request.body?.name?.trim(),
          barcode: request.body?.barcode?.trim() || null,
          requiresItemScan: request.body?.requiresItemScan,
          active: request.body?.active,
        },
      });
      return { product };
    },
  );

  // --- Pedidos (Vendas) ---
  app.get<{
    Querystring: { status?: string; q?: string; page?: string; pageSize?: string };
  }>(
    "/api/orders",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const q = request.query.q?.trim();
      const status = request.query.status as OrderStatus | undefined;
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where: Prisma.OrderWhereInput = {};
      if (status && Object.values(OrderStatus).includes(status)) {
        where.status = status;
      }
      if (q) {
        where.OR = [
          { erpOrderId: { contains: q, mode: "insensitive" } },
          { customerName: { contains: q, mode: "insensitive" } },
        ];
      }
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          skip,
          take,
          include: {
            assignedPicker: { select: { name: true } },
            basket: { select: { code: true } },
            _count: { select: { items: true } },
            items: { select: { quantityOrdered: true, quantityPicked: true } },
          },
        }),
        prisma.order.count({ where }),
      ]);
      return {
        orders: orders.map((o) => ({
          id: o.id,
          erpOrderId: o.erpOrderId,
          customerName: o.customerName,
          status: o.status,
          priority: o.priority,
          pickerName: o.assignedPicker?.name ?? null,
          basketCode: o.basket?.code ?? null,
          itemCount: o._count.items,
          qtyOrdered: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
          qtyPicked: o.items.reduce((s, i) => s + i.quantityPicked, 0),
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        })),
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  // --- Localizações (Cadastros) ---
  app.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>(
    "/api/locations",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const q = request.query.q?.trim();
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where: Prisma.LocationWhereInput = q
        ? {
            OR: [
              { barcode: { contains: q, mode: "insensitive" } },
              { corridor: { contains: q, mode: "insensitive" } },
            ],
          }
        : {};
      const [locations, total] = await Promise.all([
        prisma.location.findMany({
          where,
          orderBy: [{ corridor: "asc" }, { row: "asc" }],
          skip,
          take,
          include: { product: { select: { sku: true, name: true } } },
        }),
        prisma.location.count({ where }),
      ]);
      return {
        locations,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{
    Body: {
      corridor?: string;
      row?: string;
      barcode?: string;
      type?: LocationType;
      productId?: string;
      capacity?: number;
      minThreshold?: number;
    };
  }>(
    "/api/locations",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const b = request.body ?? {};
      if (!b.corridor || !b.row || !b.barcode || !b.type) {
        return reply.status(400).send({ error: "Campos obrigatórios faltando" });
      }
      try {
        const location = await prisma.location.create({
          data: {
            corridor: b.corridor,
            row: b.row,
            barcode: b.barcode.trim().toUpperCase(),
            type: b.type,
            productId: b.productId || null,
            capacity: b.capacity ?? 100,
            minThreshold: b.minThreshold ?? 0,
            currentQuantity: 0,
          },
          include: { product: { select: { sku: true, name: true } } },
        });
        return reply.status(201).send({ location });
      } catch {
        return reply.status(409).send({ error: "Código de barras já existe" });
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      productId?: string | null;
      capacity?: number;
      minThreshold?: number;
      active?: boolean;
    };
  }>(
    "/api/locations/:id",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const location = await prisma.location.update({
        where: { id: request.params.id },
        data: request.body,
        include: { product: { select: { sku: true, name: true } } },
      });
      return { location };
    },
  );

  app.post<{
    Body: {
      mode?: LocationImportMode;
      rows?: Array<Record<string, unknown>>;
    };
  }>(
    "/api/locations/import",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const rows = request.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return reply.status(400).send({ error: "Envie ao menos uma linha" });
      }
      if (rows.length > 5000) {
        return reply
          .status(400)
          .send({ error: "Máximo de 5000 linhas por importação" });
      }

      const mode: LocationImportMode =
        request.body?.mode === "createOnly" ? "createOnly" : "upsert";

      const parsed: LocationImportInput[] = [];
      const errors: Array<{ row: number; barcode?: string; message: string }> =
        [];

      rows.forEach((raw, i) => {
        const { data, error } = normalizeImportRow(raw, i + 2);
        if (error) errors.push(error);
        else if (data) parsed.push(data);
      });

      if (parsed.length === 0) {
        return reply.status(400).send({
          error: "Nenhuma linha válida para importar",
          errors,
        });
      }

      const result = await importLocations(parsed, mode);
      return { ...result, errors: [...errors, ...result.errors] };
    },
  );

  // --- Cestas ---
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/baskets",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const [baskets, total] = await Promise.all([
        prisma.basket.findMany({
          orderBy: { code: "asc" },
          skip,
          take,
          include: { _count: { select: { orders: true } } },
        }),
        prisma.basket.count(),
      ]);
      return {
        baskets: baskets.map((b) => ({
          ...b,
          ordersInUse: b._count.orders,
        })),
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{ Body: { code?: string; barcode?: string } }>(
    "/api/baskets",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const { code, barcode } = request.body ?? {};
      if (!code?.trim() || !barcode?.trim()) {
        return reply.status(400).send({ error: "Código e barcode obrigatórios" });
      }
      try {
        const basket = await prisma.basket.create({
          data: { code: code.trim().toUpperCase(), barcode: barcode.trim() },
        });
        return reply.status(201).send({ basket });
      } catch {
        return reply.status(409).send({ error: "Cesta já cadastrada" });
      }
    },
  );

  // --- Estoque ---
  app.get<{
    Querystring: { q?: string; lowOnly?: string; page?: string; pageSize?: string };
  }>(
    "/api/stock/locations",
    { preHandler: guard(Permission.STOCK_VIEW) },
    async (request) => {
      const q = request.query.q?.trim();
      const lowOnly = request.query.lowOnly === "true";
      const { page, pageSize, skip, take } = parsePagination(request.query);

      const baseWhere: Prisma.LocationWhereInput = q
        ? {
            OR: [
              { barcode: { contains: q, mode: "insensitive" } },
              { product: { sku: { contains: q, mode: "insensitive" } } },
            ],
          }
        : { active: true };

      if (lowOnly) {
        const all = await prisma.location.findMany({
          where: baseWhere,
          include: { product: true },
          orderBy: [{ corridor: "asc" }, { row: "asc" }],
        });
        const filtered = all.filter(
          (l) => l.currentQuantity <= l.minThreshold,
        );
        const slice = filtered.slice(skip, skip + take);
        return {
          locations: slice,
          pagination: buildPaginationMeta(filtered.length, page, pageSize),
        };
      }

      const [locations, total] = await Promise.all([
        prisma.location.findMany({
          where: baseWhere,
          include: { product: true },
          orderBy: [{ corridor: "asc" }, { row: "asc" }],
          skip,
          take,
        }),
        prisma.location.count({ where: baseWhere }),
      ]);
      return {
        locations,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/stock/movements",
    { preHandler: guard(Permission.STOCK_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query, 25);
      const [movements, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          orderBy: { createdAt: "desc" },
          skip,
          take,
          include: {
            product: { select: { sku: true, name: true } },
            user: { select: { name: true } },
            fromLocation: { select: { barcode: true } },
            toLocation: { select: { barcode: true } },
            order: { select: { erpOrderId: true } },
          },
        }),
        prisma.inventoryMovement.count(),
      ]);
      return {
        movements,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  // --- Recebimentos ---
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/receipts",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where = { type: InventoryMovementType.ENTRY };
      const [receipts, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take,
          include: {
            product: { select: { sku: true, name: true } },
            user: { select: { name: true } },
            toLocation: { select: { barcode: true, corridor: true, row: true } },
          },
        }),
        prisma.inventoryMovement.count({ where }),
      ]);
      return {
        receipts,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{
    Body: {
      productId?: string;
      toLocationId?: string;
      quantity?: number;
      reference?: string;
      notes?: string;
    };
  }>(
    "/api/receipts",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const { productId, toLocationId, quantity, reference, notes } =
        request.body ?? {};
      if (!productId || !toLocationId || !quantity || quantity < 1) {
        return reply.status(400).send({ error: "Produto, local e quantidade são obrigatórios" });
      }
      const loc = await prisma.location.findUnique({ where: { id: toLocationId } });
      if (!loc) return reply.status(404).send({ error: "Localização não encontrada" });

      const [movement] = await prisma.$transaction([
        prisma.inventoryMovement.create({
          data: {
            type: InventoryMovementType.ENTRY,
            quantity,
            userId: request.authUser!.id,
            productId,
            toLocationId,
            reference: reference?.trim() || null,
            notes: notes?.trim() || null,
          },
          include: {
            product: { select: { sku: true, name: true } },
            toLocation: { select: { barcode: true } },
          },
        }),
        prisma.location.update({
          where: { id: toLocationId },
          data: { currentQuantity: { increment: quantity }, productId },
        }),
      ]);

      return reply.status(201).send({ receipt: movement });
    },
  );

  // --- Expedição ---
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/shipping/queue",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where = {
        status: {
          in: [
            OrderStatus.PICKED_AWAITING_CONFERENCE,
            OrderStatus.DISPATCHING,
          ],
        },
      };
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: { updatedAt: "asc" },
          skip,
          take,
          include: {
            basket: { select: { code: true } },
            assignedPicker: { select: { name: true } },
            items: {
              include: {
                product: { select: { sku: true, name: true } },
              },
            },
          },
        }),
        prisma.order.count({ where }),
      ]);
      return {
        orders,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { action?: string } }>(
    "/api/shipping/:id/advance",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      const order = await prisma.order.findUnique({
        where: { id: request.params.id },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      let next: OrderStatus | null = null;
      if (order.status === OrderStatus.PICKED_AWAITING_CONFERENCE) {
        next = OrderStatus.DISPATCHING;
      } else if (order.status === OrderStatus.DISPATCHING) {
        next = OrderStatus.DISPATCHED;
      } else {
        return reply.status(400).send({ error: "Pedido não está na fila de expedição" });
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: next,
          ...(next === OrderStatus.DISPATCHED
            ? { dispatchedAt: new Date() }
            : {}),
        },
      });

      if (next === OrderStatus.DISPATCHING) {
        await notifyUsersWithPermission(Permission.SHIPPING_VIEW, {
          title: "Pedido pronto para expedir",
          body: `${order.erpOrderId} aguarda despacho.`,
          category: "SHIPPING",
          data: { orderId: order.id, erpOrderId: order.erpOrderId },
        });
      }

      if (next === OrderStatus.DISPATCHED) {
        if (order.assignedPickerId) {
          await createNotification({
            userId: order.assignedPickerId,
            title: "Pedido expedido",
            body: `${order.erpOrderId} foi marcado como expedido.`,
            category: "ORDER",
            data: { orderId: order.id, erpOrderId: order.erpOrderId },
          });
        }
      }

      return { order: updated };
    },
  );

  app.get(
    "/api/settings/public",
    { preHandler: guard(Permission.SYSTEM_VIEW) },
    async () => {
      const settings = await prisma.systemSetting.findMany({
        orderBy: { key: "asc" },
      });
      return { settings };
    },
  );

  // --- Relatórios ---
  app.get<{
    Querystring: { from?: string; to?: string };
  }>(
    "/api/reports/summary",
    { preHandler: guard(Permission.REPORTS_VIEW) },
    async (request) => {
      return getReportsSummary(request.query.from, request.query.to);
    },
  );

  app.get("/api/reports/types", { preHandler: guard(Permission.REPORTS_VIEW) }, async () => ({
    types: [
      {
        id: "dispatched",
        label: "Expedidos",
        description: "Pedidos despachados no período selecionado",
        requiresPeriod: true,
      },
      {
        id: "orders",
        label: "Pedidos",
        description: "Pedidos criados ou atualizados no período",
        requiresPeriod: true,
      },
      {
        id: "picking",
        label: "Separação",
        description: "Itens separados (movimentações de pick) por operador",
        requiresPeriod: true,
      },
      {
        id: "movements",
        label: "Movimentações",
        description: "Entradas, saídas, transferências e ajustes de estoque",
        requiresPeriod: true,
      },
      {
        id: "low_stock",
        label: "Estoque crítico",
        description: "Gôndolas com quantidade abaixo do mínimo (instantâneo)",
        requiresPeriod: false,
      },
    ],
  }));

  app.get<{
    Querystring: {
      report?: string;
      from?: string;
      to?: string;
      status?: string;
      movementType?: string;
      format?: string;
    };
  }>(
    "/api/reports/data",
    { preHandler: guard(Permission.REPORTS_VIEW) },
    async (request, reply) => {
      const report = request.query.report as ReportId | undefined;
      if (!report || !REPORT_IDS.includes(report)) {
        return reply.status(400).send({
          error: `Informe report: ${REPORT_IDS.join(", ")}`,
        });
      }

      try {
        const result = await runReport({
          report,
          from: request.query.from,
          to: request.query.to,
          status: request.query.status,
          movementType: request.query.movementType,
        });

        if (request.query.format === "csv") {
          const csv = reportToCsv(result);
          const period =
            result.from && result.to
              ? `${result.from}_${result.to}`
              : "atual";
          reply.header("Content-Type", "text/csv; charset=utf-8");
          reply.header(
            "Content-Disposition",
            `attachment; filename="help-route-${report}-${period}.csv"`,
          );
          return reply.send(csv);
        }

        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao gerar relatório";
        return reply.status(400).send({ error: msg });
      }
    },
  );
}
