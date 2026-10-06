import { LocationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildPaginationMeta } from "../lib/pagination.js";
import { assertMaxPickFaceLocations } from "./location-rules.js";
import { resumePausedOrdersAfterPickFace } from "./product-locations.js";
import { selectableProductWhere } from "./product-selectable.js";

export class ProductAdminError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "ProductAdminError";
  }
}

export type ProductMissingFilter = "location" | "image" | "barcode";

const locationSummarySelect = {
  id: true,
  barcode: true,
  type: true,
  currentQuantity: true,
} satisfies Prisma.LocationSelect;

const locationDetailSelect = {
  ...locationSummarySelect,
  face: true,
  capacity: true,
  minThreshold: true,
  active: true,
  barracao: { select: { code: true, name: true } },
} satisfies Prisma.LocationSelect;

const pulmaoStockWhere = {
  quantity: { gt: 0 },
  location: { active: true, type: LocationType.PULMAO },
} satisfies Prisma.LocationStockWhereInput;

/**
 * Pulmões não têm SKU fixo: entram na lista de posições do produto enquanto tiverem saldo dele,
 * com `currentQuantity` = saldo deste SKU.
 */
function mergePulmaoStocks<L extends { barcode: string }, P extends { locations: L[]; locationStocks: Array<{ quantity: number; location: L }> }>(
  product: P,
): Omit<P, "locationStocks"> & { locations: Array<L & { pulmaoStock: boolean }> } {
  const { locationStocks, ...rest } = product;
  return {
    ...rest,
    locations: [
      ...product.locations.map((l) => ({ ...l, pulmaoStock: false })),
      ...locationStocks.map((s) => ({ ...s.location, currentQuantity: s.quantity, pulmaoStock: true })),
    ],
  };
}

function missingWhere(missing?: ProductMissingFilter): Prisma.ProductWhereInput {
  if (missing === "location") {
    return { locations: { none: { active: true } }, locationStocks: { none: pulmaoStockWhere } };
  }
  if (missing === "image") return { OR: [{ imageUrl: null }, { imageUrl: "" }] };
  if (missing === "barcode") return { OR: [{ barcode: null }, { barcode: "" }] };
  return {};
}

export async function listProductsForAdmin(
  tenantId: string,
  opts: { q?: string; missing?: ProductMissingFilter; page: number; pageSize: number; skip: number; take: number },
) {
  const q = opts.q?.trim();
  const where = await selectableProductWhere(tenantId, {
    tenantId,
    AND: [
      q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { barcode: { contains: q, mode: "insensitive" } },
              { qrCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      missingWhere(opts.missing),
    ],
  });
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { sku: "asc" },
      skip: opts.skip,
      take: opts.take,
      include: {
        locations: { where: { active: true }, select: locationSummarySelect, orderBy: { barcode: "asc" } },
        locationStocks: {
          where: pulmaoStockWhere,
          select: { quantity: true, location: { select: locationSummarySelect } },
          orderBy: { quantity: "desc" },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);
  return {
    products: products.map(mergePulmaoStocks),
    pagination: buildPaginationMeta(total, opts.page, opts.pageSize),
  };
}

export async function getProductForAdmin(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: {
      locations: { select: locationDetailSelect, orderBy: [{ type: "asc" }, { barcode: "asc" }] },
      locationStocks: {
        where: pulmaoStockWhere,
        select: { quantity: true, location: { select: locationDetailSelect } },
        orderBy: { quantity: "desc" },
      },
    },
  });
  if (!product) throw new ProductAdminError("Produto não encontrado", 404);
  return mergePulmaoStocks(product);
}

const MAX_QR_CODE_LENGTH = 200;

/** Troca o conteúdo do QR da etiqueta. Vazio ou igual ao SKU volta para o padrão (o SKU). */
export async function setProductQrCode(tenantId: string, productId: string, raw: string | null) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: { id: true, sku: true },
  });
  if (!product) throw new ProductAdminError("Produto não encontrado", 404);

  const trimmed = raw?.trim() ?? "";
  if (trimmed.length > MAX_QR_CODE_LENGTH) {
    throw new ProductAdminError(`QR code com no máximo ${MAX_QR_CODE_LENGTH} caracteres`);
  }
  const qrCode = trimmed && trimmed.toUpperCase() !== product.sku.toUpperCase() ? trimmed : null;

  if (qrCode) {
    const same = { equals: qrCode, mode: "insensitive" as const };
    const clash = await prisma.product.findFirst({
      where: {
        tenantId,
        id: { not: productId },
        OR: [{ sku: same }, { barcode: same }, { qrCode: same }],
      },
      select: { sku: true },
    });
    if (clash) {
      throw new ProductAdminError(`O código ${qrCode} já identifica o produto ${clash.sku}`, 409);
    }
  }

  try {
    return await prisma.product.update({ where: { id: productId }, data: { qrCode } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ProductAdminError(`O código ${qrCode} já está em outro produto`, 409);
    }
    throw e;
  }
}

async function findTenantLocation(tenantId: string, locationId: string) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, tenantId },
    include: { product: { select: { id: true, sku: true } } },
  });
  if (!location) throw new ProductAdminError("Posição não encontrada", 404);
  return location;
}

/** Liga o produto a uma posição. Só substitui outro SKU se a posição estiver zerada e `replace` vier marcado. */
export async function assignProductLocation(
  tenantId: string,
  productId: string,
  input: { locationId: string; replace?: boolean },
) {
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } });
  if (!product) throw new ProductAdminError("Produto não encontrado", 404);
  const location = await findTenantLocation(tenantId, input.locationId);
  if (!location.active) throw new ProductAdminError(`Posição ${location.barcode} está inativa`);
  if (location.type === LocationType.PULMAO) {
    throw new ProductAdminError(
      `Pulmão ${location.barcode} aceita qualquer SKU; ele aparece no produto quando houver saldo guardado`,
    );
  }
  if (location.productId === productId) return { location, resumedOrderIds: [] as string[] };

  if (location.product) {
    if (location.currentQuantity > 0) {
      throw new ProductAdminError(
        `Posição ${location.barcode} tem ${location.currentQuantity} un. de ${location.product.sku}; transfira ou zere antes`,
      );
    }
    if (!input.replace) {
      throw new ProductAdminError(`Posição ${location.barcode} já é do SKU ${location.product.sku}`, 409);
    }
  }

  await assertMaxPickFaceLocations(tenantId, productId, location.type, location.id);
  const updated = await prisma.location.update({
    where: { id: location.id },
    data: { productId },
    select: locationDetailSelect,
  });
  const { resumedOrderIds } =
    updated.type === LocationType.PICK_FACE
      ? await resumePausedOrdersAfterPickFace(tenantId, productId)
      : { resumedOrderIds: [] as string[] };
  return { location: updated, resumedOrderIds };
}

export async function unassignProductLocation(tenantId: string, productId: string, locationId: string) {
  const location = await findTenantLocation(tenantId, locationId);
  if (location.type === LocationType.PULMAO) {
    throw new ProductAdminError("Pulmão não tem SKU fixo; o saldo sai pelo transporte ou ajuste");
  }
  if (location.productId !== productId) {
    throw new ProductAdminError("Esta posição não é deste produto", 404);
  }
  if (location.currentQuantity > 0) {
    throw new ProductAdminError(
      `Posição ${location.barcode} ainda tem ${location.currentQuantity} un.; transfira ou zere antes`,
    );
  }
  await prisma.location.update({ where: { id: location.id }, data: { productId: null } });
  return { ok: true };
}
