/**
 * Limpa posições (Location) com SKU e recria apenas a hierarquia estrutural:
 * Barracão → Setor → Corredor → Estante → Coluna → Linha (sem barcode / PICK_FACE).
 *
 * Layout por barracão (BAURU e GARCA):
 * - 5 setores (A–E)
 * - 10 corredores (2 por setor: A1, A2, …)
 * - 30 estantes (3 por corredor)
 * - 20 colunas por estante
 * - 30 linhas por coluna
 *
 * Uso:
 *   pnpm --filter @wms/api seed:warehouse-layout
 *   pnpm --filter @wms/api seed:warehouse-layout -- --tenant-slug default
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BARRACOES = [
  { code: "BAURU", name: "Bauru" },
  { code: "GARCA", name: "Garça" },
] as const;

const SETOR_CODES = ["A", "B", "C", "D", "E"] as const;
const CORREDORES_POR_SETOR = 2;
const ESTANTES_POR_CORREDOR = 3;
const COLUNAS_POR_ESTANTE = 20;
const LINHAS_POR_COLUNA = 30;

const CREATE_MANY_BATCH = 2_000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseArgs(argv: string[]) {
  let tenantSlug = "default";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant-slug" && argv[i + 1]) tenantSlug = argv[++i]!;
    else if (a === "--tenant-id" && argv[i + 1]) return { tenantId: argv[++i]! };
  }
  return { tenantSlug };
}

async function clearWarehouseAndLocations(tenantId: string) {
  console.log("Limpando dados operacionais ligados a localizações…");

  const replenishment = await prisma.replenishmentAssignment.deleteMany({
    where: { pickFace: { tenantId } },
  });
  const cargo = await prisma.cargoTransfer.deleteMany({ where: { tenantId } });
  const movements = await prisma.inventoryMovement.deleteMany({ where: { tenantId } });
  const waves = await prisma.pickWave.deleteMany({ where: { tenantId } });
  const orderItems = await prisma.orderItem.updateMany({
    where: { order: { tenantId } },
    data: { pickLocationId: null },
  });
  const locations = await prisma.location.deleteMany({ where: { tenantId } });
  const linhas = await prisma.warehouseLinha.deleteMany({ where: { tenantId } });
  const colunas = await prisma.warehouseColuna.deleteMany({ where: { tenantId } });
  const estantes = await prisma.warehouseEstante.deleteMany({ where: { tenantId } });
  const corredores = await prisma.warehouseCorredor.deleteMany({ where: { tenantId } });
  const setores = await prisma.warehouseSetor.deleteMany({ where: { tenantId } });
  const barracoes = await prisma.warehouseBarracao.deleteMany({ where: { tenantId } });

  console.log(
    [
      `  replenishment: ${replenishment.count}`,
      `cargo: ${cargo.count}`,
      `movements: ${movements.count}`,
      `waves: ${waves.count}`,
      `orderItems cleared: ${orderItems.count}`,
      `locations: ${locations.count}`,
      `linhas: ${linhas.count}`,
      `colunas: ${colunas.count}`,
      `estantes: ${estantes.count}`,
      `corredores: ${corredores.count}`,
      `setores: ${setores.count}`,
      `barracoes: ${barracoes.count}`,
    ].join("\n"),
  );
}

async function createManyBatched<T extends Record<string, unknown>>(
  label: string,
  rows: T[],
  insert: (batch: T[]) => Promise<{ count: number }>,
) {
  let created = 0;
  for (let i = 0; i < rows.length; i += CREATE_MANY_BATCH) {
    const batch = rows.slice(i, i + CREATE_MANY_BATCH);
    const result = await insert(batch);
    created += result.count;
    if (rows.length > CREATE_MANY_BATCH) {
      process.stdout.write(
        `\r  ${label}: ${created}/${rows.length}`,
      );
    }
  }
  if (rows.length > CREATE_MANY_BATCH) process.stdout.write("\n");
  return created;
}

async function seedStructuralLayout(tenantId: string) {
  console.log("Criando hierarquia estrutural (sem posições / SKU)…");

  let totalLinhas = 0;

  for (const barracaoDef of BARRACOES) {
    const barracao = await prisma.warehouseBarracao.create({
      data: {
        tenantId,
        code: barracaoDef.code,
        name: barracaoDef.name,
      },
    });
    console.log(`\nBarracão ${barracao.code}`);

    for (const setorCode of SETOR_CODES) {
      const setor = await prisma.warehouseSetor.create({
        data: {
          tenantId,
          barracaoId: barracao.id,
          code: setorCode,
        },
      });

      for (let c = 1; c <= CORREDORES_POR_SETOR; c++) {
        const corredor = await prisma.warehouseCorredor.create({
          data: {
            tenantId,
            setorId: setor.id,
            code: `${setorCode}${c}`,
          },
        });

        for (let e = 1; e <= ESTANTES_POR_CORREDOR; e++) {
          const estante = await prisma.warehouseEstante.create({
            data: {
              tenantId,
              corredorId: corredor.id,
              code: pad2(e),
            },
          });

          const colunaRows = Array.from({ length: COLUNAS_POR_ESTANTE }, (_, i) => ({
            tenantId,
            estanteId: estante.id,
            code: pad2(i + 1),
          }));

          await createManyBatched(
            `colunas ${barracao.code}/${corredor.code}/${estante.code}`,
            colunaRows,
            (batch) => prisma.warehouseColuna.createMany({ data: batch }),
          );

          const colunas = await prisma.warehouseColuna.findMany({
            where: { tenantId, estanteId: estante.id },
            select: { id: true },
            orderBy: { code: "asc" },
          });

          const linhaRows = colunas.flatMap((coluna) =>
            Array.from({ length: LINHAS_POR_COLUNA }, (_, i) => ({
              tenantId,
              colunaId: coluna.id,
              code: pad2(i + 1),
            })),
          );

          const created = await createManyBatched(
            `linhas ${barracao.code}/${corredor.code}/${estante.code}`,
            linhaRows,
            (batch) => prisma.warehouseLinha.createMany({ data: batch }),
          );
          totalLinhas += created;
        }
      }
    }
  }

  const counts = await prisma.$transaction([
    prisma.warehouseBarracao.count({ where: { tenantId } }),
    prisma.warehouseSetor.count({ where: { tenantId } }),
    prisma.warehouseCorredor.count({ where: { tenantId } }),
    prisma.warehouseEstante.count({ where: { tenantId } }),
    prisma.warehouseColuna.count({ where: { tenantId } }),
    prisma.warehouseLinha.count({ where: { tenantId } }),
    prisma.location.count({ where: { tenantId } }),
  ]);

  console.log("\nResumo:");
  console.log(`  barracões:  ${counts[0]}`);
  console.log(`  setores:    ${counts[1]}`);
  console.log(`  corredores: ${counts[2]}`);
  console.log(`  estantes:   ${counts[3]}`);
  console.log(`  colunas:    ${counts[4]}`);
  console.log(`  linhas:     ${counts[5]} (criadas nesta execução: ${totalLinhas})`);
  console.log(`  locations:  ${counts[6]} (esperado: 0)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const tenant =
    "tenantId" in args && args.tenantId
      ? await prisma.tenant.findUnique({ where: { id: args.tenantId } })
      : await prisma.tenant.findUnique({
          where: { slug: args.tenantSlug },
        });

  if (!tenant) {
    throw new Error(
      "tenantId" in args && args.tenantId
        ? `Tenant não encontrado: ${args.tenantId}`
        : `Tenant não encontrado (slug: ${args.tenantSlug})`,
    );
  }

  console.log(`Tenant: ${tenant.name} (${tenant.slug})`);

  const started = Date.now();
  await clearWarehouseAndLocations(tenant.id);
  await seedStructuralLayout(tenant.id);
  console.log(`\nConcluído em ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
