import { LocationFace, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { DEFAULT_MIN_PERCENT } from "./stock-percent.js";
import {
  ensureWarehouseHierarchy,
  gondolaCode,
  inheritGondolaParentCodes,
  normalizeWarehouseCode,
  WAREHOUSE_ADDRESS_PLACEHOLDER,
} from "./warehouse-layout.js";

export const MAX_GENERATED_POSITIONS = 2000;

/** LD = Face A, LE = Face B. */
export const SIDE_LABEL: Record<LocationFace, "LD" | "LE"> = {
  [LocationFace.A]: "LD",
  [LocationFace.B]: "LE",
};

export interface EstanteSideInput {
  colunas: number;
  linhas: number;
}

export interface GenerateEstanteInput {
  barracaoId: string;
  estanteCode: string;
  ld: EstanteSideInput;
  le?: EstanteSideInput | null;
  type?: LocationType;
  capacity?: number;
  /** % mínima das gôndolas geradas */
  minPercent?: number;
  /**
   * Etiqueta no padrão do galpão BARRACAO-ESTANTE-COLUNA-LINHA (ex.: B1-D-12-7).
   * Posições já existentes com outra etiqueta passam a usar esta, se estiver livre.
   */
  addressBarcodes?: boolean;
}

export interface PlannedPosition {
  colunaCode: string;
  linhaCode: string;
  face: LocationFace;
  /**
   * Sem `barracaoCode`: etiqueta provisória ESTANTE-LADO-COLUNA-LINHA.
   * Com `barracaoCode`: endereço BARRACAO-ESTANTE-COLUNA-LINHA (as colunas já distinguem o lado).
   */
  barcode: string;
}

export function addressBarcode(
  barracaoCode: string,
  estanteCode: string,
  coluna: string | number,
  linha: string | number,
): string {
  return `${normalizeWarehouseCode(barracaoCode)}-${normalizeWarehouseCode(estanteCode)}-${coluna}-${linha}`;
}

/** As colunas do LE continuam a numeração do LD (LD 1–7 → LE 8–14). */
export function planEstantePositions(
  estanteCode: string,
  ld: EstanteSideInput,
  le?: EstanteSideInput | null,
  barracaoCode?: string,
): PlannedPosition[] {
  const estante = normalizeWarehouseCode(estanteCode);
  const sides: Array<{ face: LocationFace; first: number; side: EstanteSideInput }> = [];
  if (ld.colunas > 0) sides.push({ face: LocationFace.A, first: 1, side: ld });
  if (le && le.colunas > 0) {
    sides.push({ face: LocationFace.B, first: ld.colunas + 1, side: le });
  }
  const out: PlannedPosition[] = [];
  for (const { face, first, side } of sides) {
    for (let c = first; c < first + side.colunas; c++) {
      for (let l = 1; l <= side.linhas; l++) {
        out.push({
          colunaCode: String(c),
          linhaCode: String(l),
          face,
          barcode: barracaoCode
            ? addressBarcode(barracaoCode, estante, c, l)
            : `${estante}-${SIDE_LABEL[face]}-${c}-${l}`,
        });
      }
    }
  }
  return out;
}

export interface GenerateEstanteResult {
  estanteId: string;
  created: number;
  skipped: number;
  /** Posições existentes cuja etiqueta foi trocada para o endereço (só com `addressBarcodes`). */
  relabeled: number;
  errors: Array<{ address: string; message: string }>;
}

export function sideCounts(side: EstanteSideInput | null | undefined, label: string, optional: boolean) {
  if (!side || (optional && !(side.colunas > 0))) return null;
  const colunas = Math.floor(side.colunas);
  const linhas = Math.floor(side.linhas);
  if (!(colunas >= 1) || !(linhas >= 1)) {
    throw new Error(`${label}: quantidade de colunas e linhas deve ser pelo menos 1`);
  }
  return { colunas, linhas };
}

/** LD ou LE pode ter 0 colunas (estante de um lado só), mas não os dois. */
export function estanteSides(ld: EstanteSideInput | null | undefined, le: EstanteSideInput | null | undefined) {
  const sideLD = sideCounts(ld, "LD", true);
  const sideLE = sideCounts(le, "LE", true);
  if (!sideLD && !sideLE) throw new Error("Informe colunas e linhas do LD ou do LE");
  return { ld: sideLD ?? { colunas: 0, linhas: 0 }, le: sideLE };
}

export async function generateEstantePositions(
  tenantId: string,
  input: GenerateEstanteInput,
): Promise<GenerateEstanteResult> {
  const estanteCode = normalizeWarehouseCode(input.estanteCode ?? "");
  if (!estanteCode || estanteCode === WAREHOUSE_ADDRESS_PLACEHOLDER) {
    throw new Error("Informe o código da estante");
  }
  const { ld, le } = estanteSides(input.ld, input.le);
  let barracaoCode: string | undefined;
  if (input.addressBarcodes) {
    const barracao = await prisma.warehouseBarracao.findFirst({
      where: { id: input.barracaoId, tenantId },
      select: { code: true },
    });
    if (!barracao) throw new Error("Barracão inválido");
    barracaoCode = barracao.code;
  }
  const planned = planEstantePositions(estanteCode, ld, le, barracaoCode);
  if (planned.length > MAX_GENERATED_POSITIONS) {
    throw new Error(`Máximo de ${MAX_GENERATED_POSITIONS} posições por vez`);
  }
  const capacity = Math.floor(input.capacity ?? 100);
  if (!(capacity >= 1)) throw new Error("Capacidade deve ser maior que zero");
  const minPercent = Math.min(100, Math.max(0, Math.floor(input.minPercent ?? DEFAULT_MIN_PERCENT)));
  const type = input.type ?? LocationType.PULMAO;

  const parents = await inheritGondolaParentCodes(tenantId, input.barracaoId, {
    estante: estanteCode,
  });
  const setorCode = parents.setor ?? WAREHOUSE_ADDRESS_PLACEHOLDER;
  const corredorCode = parents.corredor ?? WAREHOUSE_ADDRESS_PLACEHOLDER;
  const corridor = gondolaCode(estanteCode, corredorCode);

  const result: GenerateEstanteResult = {
    estanteId: "",
    created: 0,
    skipped: 0,
    relabeled: 0,
    errors: [],
  };
  const hierarchyByColuna = new Map<string, Awaited<ReturnType<typeof ensureWarehouseHierarchy>>>();

  for (const pos of planned) {
    const address = pos.barcode;
    try {
      let hierarchy = hierarchyByColuna.get(pos.colunaCode);
      if (!hierarchy) {
        hierarchy = await ensureWarehouseHierarchy(tenantId, {
          barracaoId: input.barracaoId,
          setorCode,
          corredorCode,
          estanteCode,
          colunaCode: pos.colunaCode,
        });
        hierarchyByColuna.set(pos.colunaCode, hierarchy);
        result.estanteId = hierarchy.estanteId;
      }

      const existingLinha = await prisma.warehouseLinha.findFirst({
        where: { tenantId, colunaId: hierarchy.colunaId, code: pos.linhaCode, face: pos.face },
        select: { id: true, location: { select: { id: true, barcode: true } } },
      });
      const barcodeTaken = await prisma.location.findFirst({
        where: { tenantId, barcode: pos.barcode },
        select: { id: true },
      });
      if (existingLinha?.location) {
        const current = existingLinha.location;
        if (input.addressBarcodes && current.barcode !== pos.barcode) {
          if (barcodeTaken) {
            result.errors.push({ address, message: `Etiqueta ${pos.barcode} já usada em outra posição` });
            continue;
          }
          await prisma.location.update({ where: { id: current.id }, data: { barcode: pos.barcode } });
          result.relabeled++;
        }
        result.skipped++;
        continue;
      }
      if (barcodeTaken) {
        result.errors.push({ address, message: `Etiqueta ${pos.barcode} já usada em outra posição` });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const linha =
          existingLinha ??
          (await tx.warehouseLinha.create({
            data: {
              tenantId,
              colunaId: hierarchy.colunaId,
              code: pos.linhaCode,
              face: pos.face,
              pickOrder: Number(pos.linhaCode),
              active: true,
            },
          }));
        await tx.location.create({
          data: {
            tenantId,
            barcode: pos.barcode,
            corridor,
            row: `${pos.colunaCode}-${pos.linhaCode}`,
            barracaoId: hierarchy.barracaoId,
            setorId: hierarchy.setorId,
            corredorId: hierarchy.corredorId,
            estanteId: hierarchy.estanteId,
            colunaId: hierarchy.colunaId,
            linhaId: linha.id,
            face: pos.face,
            type,
            capacity,
            minPercent,
            fillPercent: 0,
            active: true,
          },
        });
      });
      result.created++;
    } catch (e) {
      result.errors.push({ address, message: e instanceof Error ? e.message : "Erro ao criar posição" });
    }
  }

  return result;
}
