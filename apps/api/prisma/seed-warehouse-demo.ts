import {
  LocationType,
  type Location,
  type PrismaClient,
  type Product,
} from "@prisma/client";

export type SeedWarehouseDemoResult = {
  barracaoId: string;
  barracaoCode: string;
  pickFaces: Location[];
  pulmoes: Location[];
  /** Produto cadastrado sem endereço de giro — gera PAUSED_ISSUE no sync Tiny. */
  productWithoutPickFace: Product;
  locations: Location[];
};

type ProductInput = { id: string; sku: string; name: string };

/**
 * Layout mínimo completo para Gestão do Barracão + Estoque:
 * Barracão → Setor → Corredor → Estante → Coluna → Linha + Location (PICK_FACE / PULMAO).
 *
 * Compacto (não usa o script gigante seed:warehouse-layout).
 */
export async function seedWarehouseDemo(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    products: ProductInput[];
  },
): Promise<SeedWarehouseDemoResult> {
  const { tenantId, products } = input;
  if (products.length < 3) {
    throw new Error("seedWarehouseDemo: precisa de pelo menos 3 produtos");
  }

  // Limpa hierarquia/localizações do tenant (pedidos já limpos pelo cleanup do seed)
  await prisma.replenishmentAssignment.deleteMany({
    where: { pickFace: { tenantId } },
  });
  await prisma.cargoTransfer.deleteMany({ where: { tenantId } });
  await prisma.inventoryMovement.deleteMany({ where: { tenantId } });
  await prisma.locationProximityReference.deleteMany({ where: { tenantId } });
  await prisma.location.deleteMany({ where: { tenantId } });
  await prisma.warehouseLinha.deleteMany({ where: { tenantId } });
  await prisma.warehouseColuna.deleteMany({ where: { tenantId } });
  await prisma.warehouseEstante.deleteMany({ where: { tenantId } });
  await prisma.warehouseCorredor.deleteMany({ where: { tenantId } });
  await prisma.warehouseSetor.deleteMany({ where: { tenantId } });
  await prisma.warehouseBarracao.deleteMany({ where: { tenantId } });

  const productWithoutPickFace = await prisma.product.upsert({
    where: { tenantId_sku: { tenantId, sku: "SEM-GONDOLA" } },
    create: {
      tenantId,
      sku: "SEM-GONDOLA",
      name: "Produto sem estoque de giro (erro seed)",
      barcode: "7891999000001",
      requiresItemScan: false,
    },
    update: {
      name: "Produto sem estoque de giro (erro seed)",
      active: true,
    },
  });

  const barracao = await prisma.warehouseBarracao.create({
    data: {
      tenantId,
      code: "BAURU",
      name: "Bauru — CD Demo",
      pickOrder: 1,
    },
  });

  const setorA = await prisma.warehouseSetor.create({
    data: { tenantId, barracaoId: barracao.id, code: "A", pickOrder: 1 },
  });
  const setorB = await prisma.warehouseSetor.create({
    data: { tenantId, barracaoId: barracao.id, code: "B", pickOrder: 2 },
  });

  const corredorA1 = await prisma.warehouseCorredor.create({
    data: { tenantId, setorId: setorA.id, code: "A1", pickOrder: 1 },
  });
  const corredorB1 = await prisma.warehouseCorredor.create({
    data: { tenantId, setorId: setorB.id, code: "B1", pickOrder: 1 },
  });

  const estanteGiro = await prisma.warehouseEstante.create({
    data: { tenantId, corredorId: corredorA1.id, code: "01", pickOrder: 1 },
  });
  const estantePulmao = await prisma.warehouseEstante.create({
    data: { tenantId, corredorId: corredorB1.id, code: "01", pickOrder: 1 },
  });

  const colunaGiro = await prisma.warehouseColuna.create({
    data: { tenantId, estanteId: estanteGiro.id, code: "01", pickOrder: 1 },
  });
  const colunaPulmao = await prisma.warehouseColuna.create({
    data: { tenantId, estanteId: estantePulmao.id, code: "01", pickOrder: 1 },
  });

  const pickFaces: Location[] = [];
  const pulmoes: Location[] = [];

  // Estoque de giro: 1 linha/gôndola por produto seed
  for (let i = 0; i < products.length; i++) {
    const product = products[i]!;
    const linhaCode = String(i + 1).padStart(2, "0");
    const linha = await prisma.warehouseLinha.create({
      data: {
        tenantId,
        colunaId: colunaGiro.id,
        code: linhaCode,
        pickOrder: i + 1,
      },
    });

    const qtyPlans = [8, 1, 5, 12, 2];
    const caps = [100, 10, 80, 40, 30];
    const mins = [20, 2, 15, 10, 8];
    const location = await prisma.location.create({
      data: {
        tenantId,
        corridor: "A",
        row: linhaCode,
        barcode: `GIRO-A1-01-${linhaCode}`,
        type: LocationType.PICK_FACE,
        productId: product.id,
        currentQuantity: qtyPlans[i] ?? 5,
        capacity: caps[i] ?? 50,
        minThreshold: mins[i] ?? 5,
        barracaoId: barracao.id,
        setorId: setorA.id,
        corredorId: corredorA1.id,
        estanteId: estanteGiro.id,
        colunaId: colunaGiro.id,
        linhaId: linha.id,
      },
    });
    pickFaces.push(location);
  }

  // Pulmão: estoque de reserva para os 3 primeiros produtos
  for (let i = 0; i < Math.min(3, products.length); i++) {
    const product = products[i]!;
    const linhaCode = String(i + 1).padStart(2, "0");
    const linha = await prisma.warehouseLinha.create({
      data: {
        tenantId,
        colunaId: colunaPulmao.id,
        code: linhaCode,
        pickOrder: i + 1,
      },
    });

    const qtyPlans = [500, 80, 300];
    const location = await prisma.location.create({
      data: {
        tenantId,
        corridor: "P",
        row: linhaCode,
        barcode: `PUL-B1-01-${linhaCode}`,
        type: LocationType.PULMAO,
        productId: product.id,
        currentQuantity: qtyPlans[i] ?? 100,
        capacity: 2000,
        minThreshold: 50,
        barracaoId: barracao.id,
        setorId: setorB.id,
        corredorId: corredorB1.id,
        estanteId: estantePulmao.id,
        colunaId: colunaPulmao.id,
        linhaId: linha.id,
      },
    });
    pulmoes.push(location);
  }

  return {
    barracaoId: barracao.id,
    barracaoCode: barracao.code,
    pickFaces,
    pulmoes,
    productWithoutPickFace,
    locations: [...pickFaces, ...pulmoes],
  };
}

export function printWarehouseDemoGuide(result: SeedWarehouseDemoResult) {
  console.log("\n=== Layout demo (Gestão do Barracão) ===\n");
  console.log(`  Barracão: ${result.barracaoCode}`);
  console.log(`  Estoque de giro: ${result.pickFaces.length} gôndolas`);
  console.log(`  Pulmão:          ${result.pulmoes.length} posições`);
  console.log(
    `  Produto sem giro: ${result.productWithoutPickFace.sku} (pedido deve pausar)\n`,
  );
}
