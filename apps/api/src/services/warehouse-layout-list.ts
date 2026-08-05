import type { LocationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { listLocationProximityReferencesByLocationIds } from "./location-proximity-references.js";

const linhaPathInclude = {
  location: {
    include: {
      product: { select: { id: true, sku: true, name: true } },
    },
  },
  coluna: {
    include: {
      estante: {
        include: {
          corredor: {
            include: {
              setor: {
                include: {
                  barracao: { select: { id: true, code: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const linhaOrderBy = [
  {
    coluna: {
      estante: {
        corredor: {
          setor: { barracao: { code: "asc" as const } },
        },
      },
    },
  },
  {
    coluna: {
      estante: {
        corredor: { setor: { code: "asc" as const } },
      },
    },
  },
  {
    coluna: {
      estante: { corredor: { code: "asc" as const } },
    },
  },
  { coluna: { estante: { code: "asc" as const } } },
  { coluna: { code: "asc" as const } },
  { code: "asc" as const },
] satisfies Prisma.WarehouseLinhaOrderByWithRelationInput[];

export interface WarehouseLayoutListRow {
  id: string;
  segment: "linhas";
  tipo: "Linha";
  parentPath: string;
  code: string;
  name: string | null;
  ordem: number;
  active: boolean;
  barracaoId: string;
  barracao: string;
  setor: string;
  corredor: string;
  estante: string;
  coluna: string;
  linha: string;
  sku: string;
  capacity: number | null;
  minThreshold: number | null;
  currentQuantity: number | null;
  fillPct: number | null;
  isPosition: boolean;
  setorId: string;
  corredorId: string;
  estanteId: string;
  colunaId: string;
  barcode?: string;
  locationType?: LocationType;
  location?: {
    id: string;
    type: LocationType;
    barcode: string;
    capacity: number;
    minThreshold: number;
    currentQuantity: number;
    proximityCorredorId?: string | null;
    proximityEstanteId?: string | null;
    proximityLinhaId?: string | null;
    proximityReferences?: Array<{
      proximityCorredorId: string | null;
      proximityEstanteId: string | null;
      proximityLinhaId: string | null;
    }>;
    product?: { id: string; sku: string; name: string | null } | null;
  };
  productId?: string | null;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
  proximityReferences?: Array<{
    proximityCorredorId: string | null;
    proximityEstanteId: string | null;
    proximityLinhaId: string | null;
  }>;
}

function buildLinhaWhere(
  tenantId: string,
  opts: { barracaoId: string; q?: string; locationType?: "PULMAO" | "PICK_FACE" },
): Prisma.WarehouseLinhaWhereInput {
  const q = opts.q?.trim();
  const pathFilter: Prisma.WarehouseLinhaWhereInput = {
    tenantId,
    location: { isNot: null },
    coluna: {
      estante: {
        corredor: {
          setor: {
            barracaoId: opts.barracaoId,
          },
        },
      },
    },
  };

  if (opts.locationType) {
    pathFilter.location = { type: opts.locationType };
  }

  if (!q) return pathFilter;

  const contains = { contains: q, mode: "insensitive" as const };
  return {
    AND: [
      pathFilter,
      {
        OR: [
          { code: contains },
          { coluna: { code: contains } },
          { coluna: { estante: { code: contains } } },
          {
            coluna: {
              estante: { corredor: { code: contains } },
            },
          },
          {
            coluna: {
              estante: {
                corredor: { setor: { code: contains } },
              },
            },
          },
          {
            coluna: {
              estante: {
                corredor: {
                  setor: { barracao: { code: contains } },
                },
              },
            },
          },
          { location: { barcode: contains } },
          { location: { product: { sku: contains } } },
          { location: { product: { name: contains } } },
        ],
      },
    ],
  };
}

function mapLinha(
  linha: Prisma.WarehouseLinhaGetPayload<{ include: typeof linhaPathInclude }>,
  proximityReferencesByLocationId: Map<
    string,
    Array<{
      proximityCorredorId: string | null;
      proximityEstanteId: string | null;
      proximityLinhaId: string | null;
    }>
  >,
): WarehouseLayoutListRow {
  const coluna = linha.coluna;
  const estante = coluna.estante;
  const corredor = estante.corredor;
  const setor = corredor.setor;
  const barracao = setor.barracao;
  const loc = linha.location;
  const proximityReferences = loc
    ? proximityReferencesByLocationId.get(loc.id) ?? []
    : [];
  const capacity = loc?.capacity ?? null;
  const current = loc?.currentQuantity ?? null;
  const fillPct =
    capacity != null && current != null && capacity > 0
      ? Math.round((current / capacity) * 100)
      : null;

  return {
    id: linha.id,
    segment: "linhas",
    tipo: "Linha",
    parentPath: `${barracao.code} / ${setor.code} / ${corredor.code} / ${estante.code} / ${coluna.code}`,
    code: linha.code,
    name: linha.name,
    ordem: linha.pickOrder,
    active: linha.active,
    barracaoId: barracao.id,
    barracao: barracao.code,
    setor: setor.code,
    corredor: corredor.code,
    estante: estante.code,
    coluna: coluna.code,
    linha: linha.code,
    sku: loc?.product?.sku ?? "—",
    capacity,
    minThreshold: loc?.minThreshold ?? null,
    currentQuantity: current,
    fillPct,
    isPosition: true,
    setorId: setor.id,
    corredorId: corredor.id,
    estanteId: estante.id,
    colunaId: coluna.id,
    barcode: loc?.barcode,
    locationType: loc?.type,
    location: loc
      ? {
          id: loc.id,
          type: loc.type,
          barcode: loc.barcode,
          capacity: loc.capacity,
          minThreshold: loc.minThreshold,
          currentQuantity: loc.currentQuantity,
          proximityCorredorId: loc.proximityCorredorId,
          proximityEstanteId: loc.proximityEstanteId,
          proximityLinhaId: loc.proximityLinhaId,
          proximityReferences,
          product: loc.product,
        }
      : undefined,
    productId: loc?.product ? undefined : null,
    proximityCorredorId: loc?.proximityCorredorId,
    proximityEstanteId: loc?.proximityEstanteId,
    proximityLinhaId: loc?.proximityLinhaId,
    proximityReferences,
  };
}

export async function listWarehouseLayoutRows(
  tenantId: string,
  opts: {
    barracaoId: string;
    q?: string;
    locationType?: "PULMAO" | "PICK_FACE";
    skip: number;
    take: number;
  },
) {
  const where = buildLinhaWhere(tenantId, opts);

  const [items, total] = await Promise.all([
    prisma.warehouseLinha.findMany({
      where,
      orderBy: linhaOrderBy,
      skip: opts.skip,
      take: opts.take,
      include: linhaPathInclude,
    }),
    prisma.warehouseLinha.count({ where }),
  ]);

  const locationIds = items
    .map((item) => item.location?.id)
    .filter((id): id is string => !!id);
  const proximityReferencesByLocationId =
    await listLocationProximityReferencesByLocationIds(locationIds);

  return {
    rows: items.map((item) =>
      mapLinha(item, proximityReferencesByLocationId),
    ),
    total,
  };
}

export async function listWarehouseProximityOptions(
  tenantId: string,
  barracaoId: string,
  excludeLinhaId?: string,
) {
  const barracao = await prisma.warehouseBarracao.findFirst({
    where: { id: barracaoId, tenantId },
    select: {
      setores: {
        orderBy: [{ pickOrder: "asc" }, { code: "asc" }],
        select: {
          code: true,
          corredores: {
            orderBy: [{ pickOrder: "asc" }, { code: "asc" }],
            select: {
              id: true,
              code: true,
              estantes: {
                orderBy: [{ pickOrder: "asc" }, { code: "asc" }],
                select: { id: true, code: true },
              },
            },
          },
        },
      },
    },
  });

  if (!barracao) {
    return { corredores: [], estantes: [], linhas: [] };
  }

  const corredores: Array<{ id: string; label: string }> = [];
  const estantes: Array<{ id: string; label: string }> = [];

  for (const setor of barracao.setores) {
    for (const corredor of setor.corredores) {
      corredores.push({
        id: corredor.id,
        label: `${setor.code} / ${corredor.code}`,
      });
      for (const estante of corredor.estantes) {
        estantes.push({
          id: estante.id,
          label: `${setor.code} / ${corredor.code} / ${estante.code}`,
        });
      }
    }
  }

  const linhas = await prisma.warehouseLinha.findMany({
    where: {
      tenantId,
      ...(excludeLinhaId ? { id: { not: excludeLinhaId } } : {}),
      coluna: {
        estante: {
          corredor: { setor: { barracaoId } },
        },
      },
    },
    orderBy: linhaOrderBy,
    take: 200,
    select: {
      id: true,
      code: true,
      coluna: {
        select: {
          code: true,
          estante: {
            select: {
              code: true,
              corredor: {
                select: {
                  code: true,
                  setor: { select: { code: true } },
                },
              },
            },
          },
        },
      },
    },
  }).then((rows) =>
    rows.map((l) => ({
      id: l.id,
      label: `${l.coluna.estante.corredor.setor.code} / ${l.coluna.estante.corredor.code} / ${l.coluna.estante.code} / ${l.coluna.code} / ${l.code}`,
    })),
  );

  return { corredores, estantes, linhas };
}
