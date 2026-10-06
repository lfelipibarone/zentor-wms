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

function missingWhere(missing?: ProductMissingFilter): Prisma.ProductWhereInput {
  if (missing === "location") return { locations: { none: { active: true } } };
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
      },
    }),
    prisma.product.count({ where }),
  ]);
  return { products, pagination: buildPaginationMeta(total, opts.page, opts.pageSize) };
}

export async function getProductForAdmin(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: {
      locations: { select: locationDetailSelect, orderBy: [{ type: "asc" }, { barcode: "asc" }] },
    },
  });
  if (!product) throw new ProductAdminError("Produto não encontrado", 404);
  return product;
}

export interface ProductUpdateInput {
  name?: string;
  barcode?: string | null;
  requiresItemScan?: boolean;
  active?: boolean;
  imageUrl?: string | null;
  unit?: string | null;
  weight?: number | null;
}

export async function updateProductForAdmin(tenantId: string, productId: string, b: ProductUpdateInput) {
  const existing = await prisma.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } });
  if (!existing) throw new ProductAdminError("Produto não encontrado", 404);
  if (b.name !== undefined && !b.name.trim()) throw new ProductAdminError("Nome é obrigatório");
  try {
    return await prisma.product.update({
      where: { id: productId },
      data: {
        ...(b.name !== undefined ? { name: b.name.trim() } : {}),
        ...(b.barcode !== undefined ? { barcode: b.barcode?.trim() || null } : {}),
        ...(b.requiresItemScan !== undefined ? { requiresItemScan: b.requiresItemScan } : {}),
        ...(b.active !== undefined ? { active: b.active } : {}),
        ...(b.imageUrl !== undefined ? { imageUrl: b.imageUrl?.trim() || null } : {}),
        ...(b.unit !== undefined ? { unit: b.unit?.trim() || null } : {}),
        ...(b.weight !== undefined ? { weight: b.weight } : {}),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ProductAdminError("Este código de barras já está em outro produto", 409);
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
