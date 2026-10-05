import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { LocationFace } from "@prisma/client";
import {
  estanteSides,
  generateEstantePositions,
  planEstantePositions,
  type EstanteSideInput,
} from "./estante-generator.js";
import { normalizeWarehouseCode } from "./warehouse-layout.js";

export interface ResizeEstanteInput {
  ld: EstanteSideInput;
  le?: EstanteSideInput | null;
  name?: string | null;
}

export interface ResizeEstanteResult {
  created: number;
  removed: number;
  errors: Array<{ address: string; message: string }>;
}

/**
 * Passa todas as posições da estante para um lado (LD = A, LE = B), mantendo coluna, linha e etiqueta.
 * Usado quando a estante é um lado só de uma gôndola formada por duas estantes de costas.
 */
export async function setEstanteFace(
  tenantId: string,
  estanteId: string,
  face: LocationFace,
): Promise<{ moved: number }> {
  const estante = await prisma.warehouseEstante.findFirst({
    where: { id: estanteId, tenantId },
    select: { id: true },
  });
  if (!estante) throw new Error("Estante não encontrada");
  const linhas = await prisma.warehouseLinha.findMany({
    where: { tenantId, coluna: { estanteId } },
    select: { colunaId: true, code: true, face: true, coluna: { select: { code: true } } },
  });
  const byAddress = new Map<string, Set<LocationFace>>();
  for (const l of linhas) {
    const key = `${l.colunaId}|${l.code}`;
    byAddress.set(key, (byAddress.get(key) ?? new Set()).add(l.face));
  }
  const clash = linhas.find((l) => (byAddress.get(`${l.colunaId}|${l.code}`)?.size ?? 0) > 1);
  if (clash) {
    throw new Error(
      `Coluna ${clash.coluna.code}, linha ${clash.code} existe no LD e no LE; ajuste antes de juntar num lado só`,
    );
  }
  const moved = linhas.filter((l) => l.face !== face).length;
  await prisma.$transaction([
    prisma.warehouseLinha.updateMany({ where: { tenantId, coluna: { estanteId } }, data: { face } }),
    prisma.location.updateMany({ where: { tenantId, estanteId }, data: { face } }),
  ]);
  return { moved };
}

const positionKey = (coluna: string, linha: string, face: string) => `${coluna}|${linha}|${face}`;

/**
 * Ajusta a estante para LD/LE (colunas × linhas): cria as posições que faltam e remove as que
 * sobram. Só remove posição vazia e sem histórico; se alguma não puder sair, nada é alterado.
 */
export async function resizeEstante(
  tenantId: string,
  estanteId: string,
  input: ResizeEstanteInput,
): Promise<ResizeEstanteResult> {
  const estante = await prisma.warehouseEstante.findFirst({
    where: { id: estanteId, tenantId },
    select: {
      id: true,
      code: true,
      corredor: { select: { setor: { select: { barracao: { select: { id: true, code: true } } } } } },
    },
  });
  if (!estante) throw new Error("Estante não encontrada");
  const barracao = estante.corredor.setor.barracao;

  const { ld, le } = estanteSides(input.ld, input.le);
  const desired = new Set(
    planEstantePositions(estante.code, ld, le).map((p) => positionKey(p.colunaCode, p.linhaCode, p.face)),
  );

  const existing = await prisma.location.findMany({
    where: { tenantId, estanteId },
    select: {
      id: true,
      barcode: true,
      type: true,
      face: true,
      productId: true,
      currentQuantity: true,
      linhaId: true,
      coluna: { select: { code: true } },
      linha: { select: { code: true } },
      _count: {
        select: {
          orderItemsPickFrom: true,
          movementsFrom: true,
          movementsTo: true,
          pickWaveLines: true,
          putawayItems: true,
          cargoTransfersFrom: true,
          cargoTransfersTo: true,
          cargoTransfersTarget: true,
          replenishmentAssignments: true,
        },
      },
    },
  });

  const toRemove = existing.filter(
    (l) => !l.coluna || !l.linha || !desired.has(positionKey(l.coluna.code, l.linha.code, l.face)),
  );
  const blocked = toRemove.filter(
    (l) => l.productId || l.currentQuantity > 0 || Object.values(l._count).some((n) => n > 0),
  );
  if (blocked.length) {
    const list = blocked
      .slice(0, 5)
      .map((l) => l.barcode)
      .join(", ");
    throw new Error(
      `${blocked.length} posição(ões) fora do novo tamanho têm SKU, saldo ou histórico e não podem ser removidas: ${list}${
        blocked.length > 5 ? "…" : ""
      }`,
    );
  }

  const addressPrefix = `${normalizeWarehouseCode(barracao.code)}-${normalizeWarehouseCode(estante.code)}-`;
  const usesAddressBarcodes = existing.some((l) => l.barcode.startsWith(addressPrefix));
  const pickFaces = existing.filter((l) => l.type === LocationType.PICK_FACE).length;
  const type = existing.length && pickFaces * 2 < existing.length ? LocationType.PULMAO : LocationType.PICK_FACE;

  await prisma.$transaction(async (tx) => {
    if (toRemove.length) {
      await tx.location.deleteMany({ where: { id: { in: toRemove.map((l) => l.id) } } });
      const linhaIds = toRemove.map((l) => l.linhaId).filter((id): id is string => Boolean(id));
      if (linhaIds.length) await tx.warehouseLinha.deleteMany({ where: { id: { in: linhaIds } } });
      await tx.warehouseColuna.deleteMany({ where: { tenantId, estanteId, linhas: { none: {} } } });
    }
    if (input.name !== undefined) {
      await tx.warehouseEstante.update({
        where: { id: estanteId },
        data: { name: input.name?.trim() || null },
      });
    }
  });

  const generated = await generateEstantePositions(tenantId, {
    barracaoId: barracao.id,
    estanteCode: estante.code,
    ld,
    le,
    type,
    addressBarcodes: usesAddressBarcodes,
  });

  return { created: generated.created, removed: toRemove.length, errors: generated.errors };
}
