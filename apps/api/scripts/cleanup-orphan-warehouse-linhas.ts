/**
 * Remove linhas sem Location e nós estruturais vazios (coluna→setor).
 *
 * Uso: pnpm --filter api exec tsx scripts/cleanup-orphan-warehouse-linhas.ts
 */
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const orphanLinhas = await prisma.warehouseLinha.deleteMany({
    where: { location: null },
  });
  console.log(`Linhas órfãs removidas: ${orphanLinhas.count}`);

  const emptyColunas = await prisma.warehouseColuna.deleteMany({
    where: { linhas: { none: {} } },
  });
  console.log(`Colunas vazias removidas: ${emptyColunas.count}`);

  const emptyEstantes = await prisma.warehouseEstante.deleteMany({
    where: { colunas: { none: {} } },
  });
  console.log(`Estantes vazias removidas: ${emptyEstantes.count}`);

  const emptyCorredores = await prisma.warehouseCorredor.deleteMany({
    where: { estantes: { none: {} } },
  });
  console.log(`Corredores vazios removidos: ${emptyCorredores.count}`);

  const emptySetores = await prisma.warehouseSetor.deleteMany({
    where: { corredores: { none: {} } },
  });
  console.log(`Setores vazios removidos: ${emptySetores.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
