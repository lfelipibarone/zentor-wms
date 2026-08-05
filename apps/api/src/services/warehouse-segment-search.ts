import type { Prisma } from "@prisma/client";

function contains(q: string): Prisma.StringFilter {
  return { contains: q, mode: "insensitive" };
}

export function buildWarehouseSegmentSearchWhere(
  segment: string,
  tenantId: string,
  q?: string,
  opts?: { parentId?: string; parentField?: string; availableOnly?: boolean },
): Prisma.WarehouseBarracaoWhereInput &
  Prisma.WarehouseSetorWhereInput &
  Prisma.WarehouseCorredorWhereInput &
  Prisma.WarehouseEstanteWhereInput &
  Prisma.WarehouseColunaWhereInput &
  Prisma.WarehouseLinhaWhereInput {
  const term = q?.trim();
  const base: Record<string, unknown> = { tenantId };

  if (opts?.parentField && opts.parentId) {
    base[opts.parentField] = opts.parentId;
  }

  if (segment === "linhas" && opts?.availableOnly) {
    base.location = null;
  }

  if (!term) return base as never;

  const codeOrName: Prisma.WarehouseBarracaoWhereInput[] = [
    { code: contains(term) },
    { name: contains(term) },
  ];

  if (segment === "barracoes") {
    return { ...base, OR: codeOrName } as never;
  }

  if (segment === "setores") {
    return {
      ...base,
      OR: [
        { code: contains(term) },
        { name: contains(term) },
        { barracao: { code: contains(term) } },
        { barracao: { name: contains(term) } },
      ],
    } as never;
  }

  if (segment === "corredores") {
    return {
      ...base,
      OR: [
        { code: contains(term) },
        { setor: { code: contains(term) } },
        { setor: { barracao: { code: contains(term) } } },
      ],
    } as never;
  }

  if (segment === "estantes") {
    return {
      ...base,
      OR: [
        { code: contains(term) },
        { corredor: { code: contains(term) } },
        { corredor: { setor: { code: contains(term) } } },
        { corredor: { setor: { barracao: { code: contains(term) } } } },
      ],
    } as never;
  }

  if (segment === "colunas") {
    return {
      ...base,
      OR: [
        { code: contains(term) },
        { estante: { code: contains(term) } },
        { estante: { corredor: { code: contains(term) } } },
        { estante: { corredor: { setor: { code: contains(term) } } } },
        {
          estante: {
            corredor: { setor: { barracao: { code: contains(term) } } },
          },
        },
      ],
    } as never;
  }

  if (segment === "linhas") {
    return {
      ...base,
      OR: [
        { code: contains(term) },
        { name: contains(term) },
        { coluna: { code: contains(term) } },
        { coluna: { estante: { code: contains(term) } } },
        { coluna: { estante: { corredor: { code: contains(term) } } } },
        {
          coluna: {
            estante: { corredor: { setor: { code: contains(term) } } },
          },
        },
        {
          coluna: {
            estante: {
              corredor: { setor: { barracao: { code: contains(term) } } },
            },
          },
        },
      ],
    } as never;
  }

  return base as never;
}
