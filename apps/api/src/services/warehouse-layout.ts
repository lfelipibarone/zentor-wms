import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export function normalizeWarehouseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Código usado para níveis estruturais não informados pelo usuário. */
export const WAREHOUSE_ADDRESS_PLACEHOLDER = "—";

type DbClient = Prisma.TransactionClient | typeof prisma;

function optionalNormalizedCode(code?: string | null): string | null {
  const trimmed = code?.trim();
  return trimmed ? normalizeWarehouseCode(trimmed) : null;
}

export interface PartialAddressCodes {
  setorCode?: string;
  corredorCode?: string;
  estanteCode?: string;
  colunaCode?: string;
  linhaCode?: string;
}

export function hasAnyAddressCode(codes: PartialAddressCodes): boolean {
  return !!(
    optionalNormalizedCode(codes.setorCode) ||
    optionalNormalizedCode(codes.corredorCode) ||
    optionalNormalizedCode(codes.estanteCode) ||
    optionalNormalizedCode(codes.colunaCode) ||
    optionalNormalizedCode(codes.linhaCode)
  );
}

/** Preenche níveis ausentes com placeholder quando algum nível foi informado. */
export function resolveEffectiveAddressCodes(codes: PartialAddressCodes): {
  setorCode: string;
  corredorCode: string;
  estanteCode: string;
  colunaCode: string;
  linhaCode: string;
} | null {
  const levels = [
    optionalNormalizedCode(codes.setorCode),
    optionalNormalizedCode(codes.corredorCode),
    optionalNormalizedCode(codes.estanteCode),
    optionalNormalizedCode(codes.colunaCode),
    optionalNormalizedCode(codes.linhaCode),
  ];

  let deepest = -1;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i]) {
      deepest = i;
      break;
    }
  }
  if (deepest < 0) return null;

  const effective = levels.map(
    (code) => code ?? WAREHOUSE_ADDRESS_PLACEHOLDER,
  ) as string[];

  return {
    setorCode: effective[0]!,
    corredorCode: effective[1]!,
    estanteCode: effective[2]!,
    colunaCode: effective[3]!,
    linhaCode: effective[4]!,
  };
}

export interface EnsureWarehouseHierarchyCodes {
  barracaoId: string;
  setorCode: string;
  corredorCode: string;
  estanteCode: string;
  colunaCode: string;
}

export interface ResolvedWarehouseHierarchyIds {
  barracaoId: string;
  setorId: string;
  corredorId: string;
  estanteId: string;
  colunaId: string;
}

/** Find-or-create setor → coluna under an existing barracão. */
export async function ensureWarehouseHierarchy(
  tenantId: string,
  input: EnsureWarehouseHierarchyCodes,
  client: DbClient = prisma,
): Promise<ResolvedWarehouseHierarchyIds> {
  const barracao = await client.warehouseBarracao.findFirst({
    where: { id: input.barracaoId, tenantId },
  });
  if (!barracao) throw new Error("Barracão inválido");

  const setorCode = normalizeWarehouseCode(input.setorCode);
  const corredorCode = normalizeWarehouseCode(input.corredorCode);
  const estanteCode = normalizeWarehouseCode(input.estanteCode);
  const colunaCode = normalizeWarehouseCode(input.colunaCode);

  let setor = await client.warehouseSetor.findFirst({
    where: { tenantId, barracaoId: barracao.id, code: setorCode },
  });
  if (!setor) {
    setor = await client.warehouseSetor.create({
      data: {
        tenantId,
        barracaoId: barracao.id,
        code: setorCode,
        pickOrder: 0,
        active: true,
      },
    });
  }

  let corredor = await client.warehouseCorredor.findFirst({
    where: { tenantId, setorId: setor.id, code: corredorCode },
  });
  if (!corredor) {
    corredor = await client.warehouseCorredor.create({
      data: {
        tenantId,
        setorId: setor.id,
        code: corredorCode,
        pickOrder: 0,
        active: true,
      },
    });
  }

  let estante = await client.warehouseEstante.findFirst({
    where: { tenantId, corredorId: corredor.id, code: estanteCode },
  });
  if (!estante) {
    estante = await client.warehouseEstante.create({
      data: {
        tenantId,
        corredorId: corredor.id,
        code: estanteCode,
        pickOrder: 0,
        active: true,
      },
    });
  }

  let coluna = await client.warehouseColuna.findFirst({
    where: { tenantId, estanteId: estante.id, code: colunaCode },
  });
  if (!coluna) {
    coluna = await client.warehouseColuna.create({
      data: {
        tenantId,
        estanteId: estante.id,
        code: colunaCode,
        pickOrder: 0,
        active: true,
      },
    });
  }

  return {
    barracaoId: barracao.id,
    setorId: setor.id,
    corredorId: corredor.id,
    estanteId: estante.id,
    colunaId: coluna.id,
  };
}

/** Resolve layout codes, creating missing structural levels (setor → coluna). */
export async function resolveOrCreateLayoutCodes(
  tenantId: string,
  codes: {
    barracao?: string;
    setor?: string;
    corredor?: string;
    estante?: string;
    coluna?: string;
    linha?: string;
  },
): Promise<LocationLayoutInput> {
  const barracaoCode = codes.barracao?.trim();
  if (!barracaoCode) {
    throw new Error("Barracão obrigatório na importação");
  }

  const barracao = await prisma.warehouseBarracao.findFirst({
    where: { tenantId, code: { equals: barracaoCode, mode: "insensitive" } },
  });
  if (!barracao) throw new Error(`Barracão não encontrado: ${barracaoCode}`);

  const effective = resolveEffectiveAddressCodes({
    setorCode: codes.setor,
    corredorCode: codes.corredor,
    estanteCode: codes.estante,
    colunaCode: codes.coluna,
    linhaCode: codes.linha,
  });
  if (!effective) {
    throw new Error("Informe ao menos um nível do endereço na importação");
  }

  const hierarchy = await ensureWarehouseHierarchy(tenantId, {
    barracaoId: barracao.id,
    setorCode: effective.setorCode,
    corredorCode: effective.corredorCode,
    estanteCode: effective.estanteCode,
    colunaCode: effective.colunaCode,
  });

  let linhaId: string | null = null;
  if (effective.linhaCode) {
    const normalizedLinha = effective.linhaCode;
    let linha = await prisma.warehouseLinha.findFirst({
      where: {
        tenantId,
        colunaId: hierarchy.colunaId,
        code: normalizedLinha,
      },
    });
    if (!linha) {
      linha = await prisma.warehouseLinha.create({
        data: {
          tenantId,
          colunaId: hierarchy.colunaId,
          code: normalizedLinha,
          pickOrder: 0,
          active: true,
        },
      });
    }
    linhaId = linha.id;
  }

  return {
    ...hierarchy,
    linhaId,
    proximityCorredorId: null,
    proximityEstanteId: null,
    proximityLinhaId: null,
  };
}

export interface LocationLayoutInput {
  barracaoId?: string | null;
  setorId?: string | null;
  corredorId?: string | null;
  estanteId?: string | null;
  colunaId?: string | null;
  linhaId?: string | null;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
}

export interface ResolvedLocationLayout {
  barracaoId: string | null;
  setorId: string | null;
  corredorId: string | null;
  estanteId: string | null;
  colunaId: string | null;
  linhaId: string | null;
  proximityCorredorId: string | null;
  proximityEstanteId: string | null;
  proximityLinhaId: string | null;
  corridor: string;
  row: string;
}

const layoutInclude = {
  barracao: { select: { id: true, code: true, tenantId: true } },
  setor: { select: { id: true, code: true, tenantId: true, barracaoId: true } },
  corredor: { select: { id: true, code: true, tenantId: true, setorId: true } },
  estante: { select: { id: true, code: true, tenantId: true, corredorId: true } },
  coluna: { select: { id: true, code: true, tenantId: true, estanteId: true } },
  linha: { select: { id: true, code: true, tenantId: true, colunaId: true } },
  proximityCorredor: { select: { id: true, code: true } },
  proximityEstante: { select: { id: true, code: true } },
  proximityLinha: { select: { id: true, code: true } },
  product: { select: { sku: true, name: true } },
} as const;

export async function resolveLocationLayout(
  tenantId: string,
  input: LocationLayoutInput,
  fallback?: { corridor?: string; row?: string },
): Promise<ResolvedLocationLayout> {
  const ids = {
    barracaoId: input.barracaoId ?? null,
    setorId: input.setorId ?? null,
    corredorId: input.corredorId ?? null,
    estanteId: input.estanteId ?? null,
    colunaId: input.colunaId ?? null,
    linhaId: input.linhaId ?? null,
    proximityCorredorId: input.proximityCorredorId ?? null,
    proximityEstanteId: input.proximityEstanteId ?? null,
    proximityLinhaId: input.proximityLinhaId ?? null,
  };

  const [barracao, setor, corredor, estante, coluna, linha] = await Promise.all([
    ids.barracaoId
      ? prisma.warehouseBarracao.findFirst({
          where: { id: ids.barracaoId, tenantId },
        })
      : null,
    ids.setorId
      ? prisma.warehouseSetor.findFirst({
          where: { id: ids.setorId, tenantId },
        })
      : null,
    ids.corredorId
      ? prisma.warehouseCorredor.findFirst({
          where: { id: ids.corredorId, tenantId },
        })
      : null,
    ids.estanteId
      ? prisma.warehouseEstante.findFirst({
          where: { id: ids.estanteId, tenantId },
        })
      : null,
    ids.colunaId
      ? prisma.warehouseColuna.findFirst({
          where: { id: ids.colunaId, tenantId },
        })
      : null,
    ids.linhaId
      ? prisma.warehouseLinha.findFirst({
          where: { id: ids.linhaId, tenantId },
        })
      : null,
  ]);

  if (ids.barracaoId && !barracao) throw new Error("Barracão inválido");
  if (ids.setorId && !setor) throw new Error("Setor inválido");
  if (ids.corredorId && !corredor) throw new Error("Corredor inválido");
  if (ids.estanteId && !estante) throw new Error("Estante inválida");
  if (ids.colunaId && !coluna) throw new Error("Coluna inválida");
  if (ids.linhaId && !linha) throw new Error("Linha inválida");

  if (setor && barracao && setor.barracaoId !== barracao.id) {
    throw new Error("Setor não pertence ao barracão selecionado");
  }
  if (setor && !barracao) ids.barracaoId = setor.barracaoId;

  if (corredor && setor && corredor.setorId !== setor.id) {
    throw new Error("Corredor não pertence ao setor selecionado");
  }
  if (corredor && !setor) {
    const parentSetor = await prisma.warehouseSetor.findFirst({
      where: { id: corredor.setorId, tenantId },
    });
    if (!parentSetor) throw new Error("Setor do corredor não encontrado");
    ids.setorId = parentSetor.id;
    ids.barracaoId = parentSetor.barracaoId;
  }

  if (estante && corredor && estante.corredorId !== corredor.id) {
    throw new Error("Estante não pertence ao corredor selecionado");
  }
  if (estante && !corredor) {
    const parentCorredor = await prisma.warehouseCorredor.findFirst({
      where: { id: estante.corredorId, tenantId },
      include: { setor: true },
    });
    if (!parentCorredor) throw new Error("Corredor da estante não encontrado");
    ids.corredorId = parentCorredor.id;
    ids.setorId = parentCorredor.setorId;
    ids.barracaoId = parentCorredor.setor.barracaoId;
  }

  if (coluna && estante && coluna.estanteId !== estante.id) {
    throw new Error("Coluna não pertence à estante selecionada");
  }
  if (coluna && !estante) {
    const parentEstante = await prisma.warehouseEstante.findFirst({
      where: { id: coluna.estanteId, tenantId },
      include: { corredor: { include: { setor: true } } },
    });
    if (!parentEstante) throw new Error("Estante da coluna não encontrada");
    ids.estanteId = parentEstante.id;
    ids.corredorId = parentEstante.corredorId;
    ids.setorId = parentEstante.corredor.setorId;
    ids.barracaoId = parentEstante.corredor.setor.barracaoId;
  }

  if (linha && coluna && linha.colunaId !== coluna.id) {
    throw new Error("Linha não pertence à coluna selecionada");
  }
  if (linha && !coluna) {
    const parentColuna = await prisma.warehouseColuna.findFirst({
      where: { id: linha.colunaId, tenantId },
      include: {
        estante: { include: { corredor: { include: { setor: true } } } },
      },
    });
    if (!parentColuna) throw new Error("Coluna da linha não encontrada");
    ids.colunaId = parentColuna.id;
    ids.estanteId = parentColuna.estanteId;
    ids.corredorId = parentColuna.estante.corredorId;
    ids.setorId = parentColuna.estante.corredor.setorId;
    ids.barracaoId = parentColuna.estante.corredor.setor.barracaoId;
  }

  if (ids.proximityCorredorId) {
    const p = await prisma.warehouseCorredor.findFirst({
      where: { id: ids.proximityCorredorId, tenantId },
    });
    if (!p) throw new Error("Corredor de proximidade inválido");
  }
  if (ids.proximityEstanteId) {
    const p = await prisma.warehouseEstante.findFirst({
      where: { id: ids.proximityEstanteId, tenantId },
    });
    if (!p) throw new Error("Estante de proximidade inválida");
  }
  if (ids.proximityLinhaId) {
    const p = await prisma.warehouseLinha.findFirst({
      where: { id: ids.proximityLinhaId, tenantId },
    });
    if (!p) throw new Error("Linha de proximidade inválida");
    if (ids.linhaId && p.id === ids.linhaId) {
      throw new Error("Linha de proximidade não pode ser a própria posição");
    }
  }

  const corridorFromLayout = corredor?.code ?? fallback?.corridor?.trim() ?? "";
  const rowFromLayout = linha?.code ?? fallback?.row?.trim() ?? "";

  if (!corridorFromLayout || !rowFromLayout) {
    if (coluna && linha) {
      return {
        ...ids,
        corridor: corredor?.code ?? coluna.code,
        row: linha.code,
      };
    }
    throw new Error("Complete corredor, estante, coluna e linha");
  }

  return {
    ...ids,
    corridor: corridorFromLayout,
    row: rowFromLayout,
  };
}

export async function resolveLayoutCodes(
  tenantId: string,
  codes: {
    barracao?: string;
    setor?: string;
    corredor?: string;
    estante?: string;
    coluna?: string;
    linha?: string;
  },
): Promise<LocationLayoutInput> {
  const barracaoCode = codes.barracao?.trim();
  const setorCode = codes.setor?.trim();
  const corredorCode = codes.corredor?.trim();
  const estanteCode = codes.estante?.trim();
  const colunaCode = codes.coluna?.trim();
  const linhaCode = codes.linha?.trim();

  let barracaoId: string | null = null;
  let setorId: string | null = null;

  if (barracaoCode) {
    const b = await prisma.warehouseBarracao.findFirst({
      where: { tenantId, code: { equals: barracaoCode, mode: "insensitive" } },
    });
    if (!b) throw new Error(`Barracão não encontrado: ${barracaoCode}`);
    barracaoId = b.id;
  }

  if (setorCode) {
    if (!barracaoId) throw new Error("Setor exige barracão na importação");
    const s = await prisma.warehouseSetor.findFirst({
      where: {
        tenantId,
        barracaoId,
        code: { equals: setorCode, mode: "insensitive" },
      },
    });
    if (!s) throw new Error(`Setor não encontrado: ${setorCode}`);
    setorId = s.id;
  }

  if (!barracaoCode) {
    return {
      barracaoId: null,
      setorId: null,
      corredorId: null,
      estanteId: null,
      colunaId: null,
      linhaId: null,
      proximityCorredorId: null,
      proximityEstanteId: null,
      proximityLinhaId: null,
    };
  }

  let corredorId: string | null = null;
  if (corredorCode) {
    if (!setorId) throw new Error("Corredor exige setor na importação");
    const c = await prisma.warehouseCorredor.findFirst({
      where: {
        tenantId,
        setorId,
        code: { equals: corredorCode, mode: "insensitive" },
      },
    });
    if (!c) throw new Error(`Corredor não encontrado: ${corredorCode}`);
    corredorId = c.id;
  }

  let estanteId: string | null = null;
  if (estanteCode) {
    if (!corredorId) throw new Error("Estante exige corredor na importação");
    const e = await prisma.warehouseEstante.findFirst({
      where: {
        tenantId,
        corredorId,
        code: { equals: estanteCode, mode: "insensitive" },
      },
    });
    if (!e) throw new Error(`Estante não encontrada: ${estanteCode}`);
    estanteId = e.id;
  }

  let colunaId: string | null = null;
  if (colunaCode) {
    if (!estanteId) throw new Error("Coluna exige estante na importação");
    const col = await prisma.warehouseColuna.findFirst({
      where: {
        tenantId,
        estanteId,
        code: { equals: colunaCode, mode: "insensitive" },
      },
    });
    if (!col) throw new Error(`Coluna não encontrada: ${colunaCode}`);
    colunaId = col.id;
  }

  let linhaId: string | null = null;
  if (linhaCode) {
    if (!colunaId) throw new Error("Linha exige coluna na importação");
    const l = await prisma.warehouseLinha.findFirst({
      where: {
        tenantId,
        colunaId,
        code: { equals: linhaCode, mode: "insensitive" },
      },
    });
    if (!l) throw new Error(`Linha não encontrada: ${linhaCode}`);
    linhaId = l.id;
  }

  return {
    barracaoId,
    setorId,
    corredorId,
    estanteId,
    colunaId,
    linhaId,
    proximityCorredorId: null,
    proximityEstanteId: null,
    proximityLinhaId: null,
  };
}

export { layoutInclude };
