import type { LocationFace, LocationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { stockModeFields } from "./location-level.js";
import { listLocationProximityReferencesByLocationIds } from "./location-proximity-references.js";
import { gondolaCode } from "./warehouse-layout.js";
import { needsReplenishment } from "./stock-percent.js";

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
  { face: "asc" as const },
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
  face: LocationFace;
  sku: string;
  /** % mínima da gôndola */
  minPercent: number | null;
  /** % atual (no pulmão, soma das % dos SKUs) */
  fillPercent: number | null;
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
    minPercent: number;
    fillPercent: number;
    stockMode: string;
    stockQuantity: number | null;
    minQuantity: number | null;
    capacity: number;
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

export const LAYOUT_SITUACOES = [
  "sem_sku",
  "com_sku",
  "vazia",
  "abaixo_min",
  "inativa",
] as const;
export type LayoutSituacao = (typeof LAYOUT_SITUACOES)[number];

export function parseLayoutSituacao(raw?: string): LayoutSituacao | undefined {
  const value = raw?.trim().toLowerCase();
  return LAYOUT_SITUACOES.find((s) => s === value);
}

export interface LayoutRowsFilter {
  barracaoId: string;
  q?: string;
  locationType?: "PULMAO" | "PICK_FACE";
  estanteId?: string;
  colunaId?: string;
  face?: LocationFace;
  situacao?: LayoutSituacao;
}

function situacaoWhere(situacao: LayoutSituacao): Prisma.WarehouseLinhaWhereInput {
  switch (situacao) {
    case "sem_sku":
      return { location: { productId: null } };
    case "com_sku":
      return { location: { productId: { not: null } } };
    case "vazia":
      return { location: { fillPercent: { lte: 0 } } };
    case "abaixo_min":
      return {
        location: {
          type: "PICK_FACE",
          productId: { not: null },
          fillPercent: { lte: prisma.location.fields.minPercent },
        },
      };
    case "inativa":
      return { active: false };
  }
}

function buildLinhaWhere(
  tenantId: string,
  opts: LayoutRowsFilter,
): Prisma.WarehouseLinhaWhereInput {
  const q = opts.q?.trim();
  const and: Prisma.WarehouseLinhaWhereInput[] = [
    {
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
    },
  ];

  if (opts.locationType) and.push({ location: { type: opts.locationType } });
  if (opts.estanteId) and.push({ coluna: { estanteId: opts.estanteId } });
  if (opts.colunaId) and.push({ colunaId: opts.colunaId });
  if (opts.face) and.push({ face: opts.face });
  if (opts.situacao) and.push(situacaoWhere(opts.situacao));

  if (!q) return { AND: and };

  const contains = { contains: q, mode: "insensitive" as const };
  return {
    AND: [
      ...and,
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

  return {
    id: linha.id,
    segment: "linhas",
    tipo: "Linha",
    parentPath: `${barracao.code} / Estante ${gondolaCode(estante.code, corredor.code)} / Coluna ${coluna.code}`,
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
    face: linha.face,
    sku: loc?.product?.sku ?? "—",
    minPercent: loc?.minPercent ?? null,
    fillPercent: loc?.fillPercent ?? null,
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
          minPercent: loc.minPercent,
          fillPercent: loc.fillPercent,
          ...stockModeFields(loc),
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

const naturalCollator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

const linhaSortSelect = {
  id: true,
  code: true,
  face: true,
  coluna: {
    select: {
      code: true,
      estante: {
        select: {
          code: true,
          corredor: {
            select: {
              code: true,
              setor: {
                select: { code: true, barracao: { select: { code: true } } },
              },
            },
          },
        },
      },
    },
  },
} as const;

type LinhaSortKey = Prisma.WarehouseLinhaGetPayload<{ select: typeof linhaSortSelect }>;

function linhaSortParts(l: LinhaSortKey): string[] {
  const estante = l.coluna.estante;
  const corredor = estante.corredor;
  return [
    corredor.setor.barracao.code,
    corredor.setor.code,
    corredor.code,
    estante.code,
    l.coluna.code,
    l.code,
    l.face,
  ];
}

function compareLinhaSortKeys(a: LinhaSortKey, b: LinhaSortKey): number {
  const pa = linhaSortParts(a);
  const pb = linhaSortParts(b);
  for (let i = 0; i < pa.length; i += 1) {
    const diff = naturalCollator.compare(pa[i]!, pb[i]!);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function loadMappedLinhas(ids: string[]) {
  if (ids.length === 0) return [];
  const items = await prisma.warehouseLinha.findMany({
    where: { id: { in: ids } },
    include: linhaPathInclude,
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((item): item is NonNullable<typeof item> => !!item);

  const locationIds = ordered
    .map((item) => item.location?.id)
    .filter((id): id is string => !!id);
  const proximityReferencesByLocationId =
    await listLocationProximityReferencesByLocationIds(locationIds);

  return ordered.map((item) => mapLinha(item, proximityReferencesByLocationId));
}

export async function listWarehouseLayoutRows(
  tenantId: string,
  opts: LayoutRowsFilter & { skip: number; take: number },
) {
  const where = buildLinhaWhere(tenantId, opts);

  const keys = await prisma.warehouseLinha.findMany({
    where,
    select: linhaSortSelect,
  });
  keys.sort(compareLinhaSortKeys);

  const pageIds = keys.slice(opts.skip, opts.skip + opts.take).map((k) => k.id);
  return { rows: await loadMappedLinhas(pageIds), total: keys.length };
}

/** Todas as posições de uma estante, na ordem física (coluna → linha → lado). */
export async function listWarehouseEstanteRows(tenantId: string, estanteId: string) {
  const keys = await prisma.warehouseLinha.findMany({
    where: { tenantId, location: { isNot: null }, coluna: { estanteId } },
    select: linhaSortSelect,
  });
  keys.sort(compareLinhaSortKeys);
  return loadMappedLinhas(keys.map((k) => k.id));
}

export interface LayoutEstanteSummary {
  id: string;
  label: string;
  colunas: Array<{ id: string; code: string }>;
  faces: LocationFace[];
  total: number;
  semSku: number;
  vazia: number;
  abaixoMin: number;
  inativa: number;
}

/** Estantes do barracão com colunas e contagens por situação (para filtros e visão por estante). */
export async function listWarehouseLayoutEstantes(
  tenantId: string,
  barracaoId: string,
): Promise<LayoutEstanteSummary[]> {
  const linhas = await prisma.warehouseLinha.findMany({
    where: {
      tenantId,
      location: { isNot: null },
      coluna: { estante: { corredor: { setor: { barracaoId } } } },
    },
    select: {
      face: true,
      active: true,
      location: {
        select: { type: true, productId: true, fillPercent: true, minPercent: true },
      },
      coluna: {
        select: {
          id: true,
          code: true,
          estante: {
            select: {
              id: true,
              code: true,
              corredor: { select: { code: true, setor: { select: { code: true } } } },
            },
          },
        },
      },
    },
  });

  const byEstante = new Map<
    string,
    LayoutEstanteSummary & { sortKey: string[]; colunaMap: Map<string, string> }
  >();
  for (const linha of linhas) {
    const estante = linha.coluna.estante;
    let entry = byEstante.get(estante.id);
    if (!entry) {
      entry = {
        id: estante.id,
        label: gondolaCode(estante.code, estante.corredor.code),
        colunas: [],
        faces: [],
        total: 0,
        semSku: 0,
        vazia: 0,
        abaixoMin: 0,
        inativa: 0,
        sortKey: [estante.corredor.setor.code, estante.corredor.code, estante.code],
        colunaMap: new Map(),
      };
      byEstante.set(estante.id, entry);
    }
    entry.colunaMap.set(linha.coluna.id, linha.coluna.code);
    if (!entry.faces.includes(linha.face)) entry.faces.push(linha.face);
    entry.total += 1;
    if (!linha.active) entry.inativa += 1;
    const loc = linha.location;
    if (!loc) continue;
    if (!loc.productId) entry.semSku += 1;
    if (loc.fillPercent <= 0) entry.vazia += 1;
    if (loc.type === "PICK_FACE" && loc.productId && needsReplenishment(loc.fillPercent, loc.minPercent)) {
      entry.abaixoMin += 1;
    }
  }

  return [...byEstante.values()]
    .sort((a, b) => {
      for (let i = 0; i < a.sortKey.length; i += 1) {
        const diff = naturalCollator.compare(a.sortKey[i]!, b.sortKey[i]!);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .map(({ sortKey: _sortKey, colunaMap, ...rest }) => ({
      ...rest,
      faces: [...rest.faces].sort(),
      colunas: [...colunaMap.entries()]
        .map(([id, code]) => ({ id, code }))
        .sort((a, b) => naturalCollator.compare(a.code, b.code)),
    }));
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
