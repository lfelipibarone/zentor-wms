import { prisma } from "../lib/prisma.js";

const order = [{ pickOrder: "asc" as const }, { code: "asc" as const }];

const treeInclude = {
  setores: {
    orderBy: order,
    include: {
      corredores: {
        orderBy: order,
        include: { fileiras: { orderBy: order } },
      },
      estantes: {
        orderBy: order,
        include: {
          prateleiras: {
            orderBy: order,
            include: { colunas: { orderBy: order } },
          },
        },
      },
    },
  },
} as const;

export async function getWarehouseTree(tenantId: string, barracaoId: string) {
  const barracao = await prisma.warehouseBarracao.findFirst({
    where: { id: barracaoId, tenantId },
    include: treeInclude,
  });
  if (!barracao) {
    throw new Error("Barracão não encontrado");
  }
  return barracao;
}

export async function listWarehouseBarracoes(tenantId: string) {
  return prisma.warehouseBarracao.findMany({
    where: { tenantId },
    orderBy: order,
    select: { id: true, code: true, name: true, pickOrder: true, active: true },
  });
}

export async function getFullWarehouseTree(tenantId: string) {
  return prisma.warehouseBarracao.findMany({
    where: { tenantId },
    orderBy: order,
    include: treeInclude,
  });
}
