import { prisma } from "../lib/prisma.js";

export interface LocationLayoutInput {
  barracaoId?: string | null;
  setorId?: string | null;
  corredorId?: string | null;
  fileiraId?: string | null;
  estanteId?: string | null;
  prateleiraId?: string | null;
  colunaId?: string | null;
}

export interface ResolvedLocationLayout {
  barracaoId: string | null;
  setorId: string | null;
  corredorId: string | null;
  fileiraId: string | null;
  estanteId: string | null;
  prateleiraId: string | null;
  colunaId: string | null;
  corridor: string;
  row: string;
}

const layoutInclude = {
  barracao: { select: { id: true, code: true, tenantId: true } },
  setor: { select: { id: true, code: true, tenantId: true, barracaoId: true } },
  corredor: { select: { id: true, code: true, tenantId: true, setorId: true } },
  fileira: { select: { id: true, code: true, tenantId: true, corredorId: true } },
  estante: { select: { id: true, code: true, tenantId: true, setorId: true } },
  prateleira: {
    select: { id: true, code: true, tenantId: true, estanteId: true },
  },
  coluna: {
    select: { id: true, code: true, tenantId: true, prateleiraId: true },
  },
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
    fileiraId: input.fileiraId ?? null,
    estanteId: input.estanteId ?? null,
    prateleiraId: input.prateleiraId ?? null,
    colunaId: input.colunaId ?? null,
  };

  const [
    barracao,
    setor,
    corredor,
    fileira,
    estante,
    prateleira,
    coluna,
  ] = await Promise.all([
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
    ids.fileiraId
      ? prisma.warehouseFileira.findFirst({
          where: { id: ids.fileiraId, tenantId },
        })
      : null,
    ids.estanteId
      ? prisma.warehouseEstante.findFirst({
          where: { id: ids.estanteId, tenantId },
        })
      : null,
    ids.prateleiraId
      ? prisma.warehousePrateleira.findFirst({
          where: { id: ids.prateleiraId, tenantId },
        })
      : null,
    ids.colunaId
      ? prisma.warehouseColuna.findFirst({
          where: { id: ids.colunaId, tenantId },
        })
      : null,
  ]);

  if (ids.barracaoId && !barracao) throw new Error("Barracão inválido");
  if (ids.setorId && !setor) throw new Error("Setor inválido");
  if (ids.corredorId && !corredor) throw new Error("Corredor inválido");
  if (ids.fileiraId && !fileira) throw new Error("Fileira inválida");
  if (ids.estanteId && !estante) throw new Error("Estante inválida");
  if (ids.prateleiraId && !prateleira) throw new Error("Prateleira inválida");
  if (ids.colunaId && !coluna) throw new Error("Coluna inválida");

  if (setor && barracao && setor.barracaoId !== barracao.id) {
    throw new Error("Setor não pertence ao barracão selecionado");
  }
  if (setor && !barracao) {
    ids.barracaoId = setor.barracaoId;
  }
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
  if (fileira && corredor && fileira.corredorId !== corredor.id) {
    throw new Error("Fileira não pertence ao corredor selecionado");
  }
  if (estante && setor && estante.setorId !== setor.id) {
    throw new Error("Estante não pertence ao setor selecionado");
  }
  if (prateleira && estante && prateleira.estanteId !== estante.id) {
    throw new Error("Prateleira não pertence à estante selecionada");
  }
  if (coluna && prateleira && coluna.prateleiraId !== prateleira.id) {
    throw new Error("Coluna não pertence à prateleira selecionada");
  }

  const corridor = corredor?.code ?? fallback?.corridor?.trim() ?? "";
  const row = fileira?.code ?? fallback?.row?.trim() ?? "";

  if (!corridor || !row) {
    throw new Error("Corredor e fileira são obrigatórios (via layout ou manual)");
  }

  return {
    ...ids,
    corridor,
    row,
  };
}

export async function resolveLayoutCodes(
  tenantId: string,
  codes: {
    barracao?: string;
    setor?: string;
    corredor?: string;
    fileira?: string;
    estante?: string;
    prateleira?: string;
    coluna?: string;
  },
): Promise<LocationLayoutInput> {
  const barracaoCode = codes.barracao?.trim();
  const setorCode = codes.setor?.trim();
  const corredorCode = codes.corredor?.trim();
  const fileiraCode = codes.fileira?.trim();
  const estanteCode = codes.estante?.trim();
  const prateleiraCode = codes.prateleira?.trim();
  const colunaCode = codes.coluna?.trim();

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
      fileiraId: null,
      estanteId: null,
      prateleiraId: null,
      colunaId: null,
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

  let fileiraId: string | null = null;
  if (fileiraCode) {
    if (!corredorId) throw new Error("Fileira exige corredor na importação");
    const f = await prisma.warehouseFileira.findFirst({
      where: {
        tenantId,
        corredorId,
        code: { equals: fileiraCode, mode: "insensitive" },
      },
    });
    if (!f) throw new Error(`Fileira não encontrada: ${fileiraCode}`);
    fileiraId = f.id;
  }

  let estanteId: string | null = null;
  if (estanteCode) {
    if (!setorId) throw new Error("Estante exige setor na importação");
    const e = await prisma.warehouseEstante.findFirst({
      where: {
        tenantId,
        setorId,
        code: { equals: estanteCode, mode: "insensitive" },
      },
    });
    if (!e) throw new Error(`Estante não encontrada: ${estanteCode}`);
    estanteId = e.id;
  }

  let prateleiraId: string | null = null;
  if (prateleiraCode) {
    if (!estanteId) throw new Error("Prateleira exige estante na importação");
    const p = await prisma.warehousePrateleira.findFirst({
      where: {
        tenantId,
        estanteId,
        code: { equals: prateleiraCode, mode: "insensitive" },
      },
    });
    if (!p) throw new Error(`Prateleira não encontrada: ${prateleiraCode}`);
    prateleiraId = p.id;
  }

  let colunaId: string | null = null;
  if (colunaCode) {
    if (!prateleiraId) throw new Error("Coluna exige prateleira na importação");
    const col = await prisma.warehouseColuna.findFirst({
      where: {
        tenantId,
        prateleiraId,
        code: { equals: colunaCode, mode: "insensitive" },
      },
    });
    if (!col) throw new Error(`Coluna não encontrada: ${colunaCode}`);
    colunaId = col.id;
  }

  return {
    barracaoId,
    setorId,
    corredorId,
    fileiraId,
    estanteId,
    prateleiraId,
    colunaId,
  };
}

export { layoutInclude };
