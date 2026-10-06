import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  generateEstantePositions,
  MAX_GENERATED_POSITIONS,
  type EstanteSideInput,
} from "./estante-generator.js";
import { assertMaxPickFaceLocations } from "./location-rules.js";
import { resumePausedOrdersAfterPickFace } from "./product-locations.js";

/**
 * Endereço da planilha de inventário:
 * - B1-D-12-7      → barracão B1, estante D, coluna 12, linha 7
 * - B1-O-E7-2-3    → estante O-E7 (rua O, estante 7), coluna 2, linha 3
 * - B1-A-E2-3 / B1-E-5 → só a coluna; linha 1
 * - sufixo /Z509 ou /Z603-604 → pulmões de reserva do produto
 */
export interface InventoryAddress {
  barracao: string;
  estante: string;
  coluna: number;
  linha: number;
  pulmoes: string[];
  /** Endereço canônico BARRACAO-ESTANTE-COLUNA-LINHA, usado como etiqueta da posição. */
  code: string;
}

function positiveInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

function parsePulmoes(suffix: string): string[] {
  return suffix
    .replace(/\s+/g, "")
    .split("-")
    .map((part) => part.replace(/^Z/, ""))
    .filter((part) => /^\d+$/.test(part))
    .map((part) => `Z${part}`);
}

export function parseInventoryAddress(raw: string): { address?: InventoryAddress; error?: string } {
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text) return { error: "Localização vazia" };
  const slash = text.indexOf("/");
  const main = (slash >= 0 ? text.slice(0, slash) : text).replace(/\s+/g, "");
  const pulmoes = slash >= 0 ? parsePulmoes(text.slice(slash + 1)) : [];

  const parts = main.split("-");
  const [barracao, rua] = parts;
  if (!barracao || !/^B\d+$/.test(barracao)) return { error: "Barracão inválido (esperado B1, B2…)" };
  if (!rua || !/^[A-Z]+$/.test(rua)) return { error: "Rua/estante inválida" };

  let rest = parts.slice(2);
  let estante = rua;
  if (rest[0] && /^E\d+$/.test(rest[0])) {
    estante = `${rua}-${rest[0]}`;
    rest = rest.slice(1);
  }
  if (rest.length < 1 || rest.length > 2) return { error: "Formato não reconhecido" };
  const coluna = positiveInt(rest[0]);
  const linha = rest.length === 2 ? positiveInt(rest[1]) : 1;
  if (!coluna || !linha) return { error: "Coluna e linha devem ser números a partir de 1" };

  return {
    address: {
      barracao,
      estante,
      coluna,
      linha,
      pulmoes,
      code: `${barracao}-${estante}-${coluna}-${linha}`,
    },
  };
}

export interface InventoryRowInput {
  address: string;
  sku?: string;
}

export interface PlannedInventoryEstante {
  barracao: string;
  estante: string;
  ld: EstanteSideInput;
  le: EstanteSideInput | null;
  /** Endereços da planilha nesta estante. */
  addressCount: number;
}

export interface InventoryLayoutPlan {
  estantes: PlannedInventoryEstante[];
  assignments: Array<{ code: string; sku: string }>;
  extraSkus: Array<{ code: string; skus: string[] }>;
  invalid: Array<{ row: number; address: string; message: string }>;
  emptyRows: number;
  /** Linhas com pulmão depois da barra (ainda não importado). */
  pulmaoRefs: number;
}

/**
 * Cada letra da planilha é um lado inteiro de gôndola (colunas 1…N). Entra no LD; no mapa, duas
 * estantes de costas (ex.: C e D) viram uma gôndola e a do LE é passada para o LE.
 */
export function defaultSides(maxColuna: number, maxLinha: number) {
  return { ld: { colunas: maxColuna, linhas: maxLinha }, le: null };
}

export function planInventoryLayout(rows: InventoryRowInput[]): InventoryLayoutPlan {
  const plan: InventoryLayoutPlan = {
    estantes: [],
    assignments: [],
    extraSkus: [],
    invalid: [],
    emptyRows: 0,
    pulmaoRefs: 0,
  };
  const dims = new Map<string, { barracao: string; estante: string; maxCol: number; maxLin: number; codes: Set<string> }>();
  const skusByCode = new Map<string, string[]>();

  rows.forEach((row, i) => {
    const rawAddress = String(row.address ?? "").trim();
    if (!rawAddress) {
      plan.emptyRows++;
      return;
    }
    const { address, error } = parseInventoryAddress(rawAddress);
    if (!address) {
      plan.invalid.push({ row: i + 2, address: rawAddress, message: error ?? "Endereço inválido" });
      return;
    }
    if (address.pulmoes.length) plan.pulmaoRefs++;

    const key = `${address.barracao}|${address.estante}`;
    const d = dims.get(key) ?? {
      barracao: address.barracao,
      estante: address.estante,
      maxCol: 0,
      maxLin: 0,
      codes: new Set<string>(),
    };
    d.maxCol = Math.max(d.maxCol, address.coluna);
    d.maxLin = Math.max(d.maxLin, address.linha);
    d.codes.add(address.code);
    dims.set(key, d);

    const sku = String(row.sku ?? "").trim();
    if (!sku) return;
    const list = skusByCode.get(address.code) ?? [];
    if (!list.some((s) => s.toLowerCase() === sku.toLowerCase())) list.push(sku);
    skusByCode.set(address.code, list);
  });

  plan.estantes = [...dims.values()]
    .sort((a, b) => a.barracao.localeCompare(b.barracao) || a.estante.localeCompare(b.estante, "pt-BR", { numeric: true }))
    .map((d) => ({
      barracao: d.barracao,
      estante: d.estante,
      ...defaultSides(d.maxCol, d.maxLin),
      addressCount: d.codes.size,
    }));

  for (const [code, skus] of skusByCode) {
    plan.assignments.push({ code, sku: skus[0]! });
    if (skus.length > 1) plan.extraSkus.push({ code, skus: skus.slice(1) });
  }
  return plan;
}

export interface ApplyInventoryLayoutInput {
  rows: InventoryRowInput[];
  /** Dimensões revisadas na tela; estantes do plano que não vierem aqui não são criadas. */
  estantes: Array<{ barracao: string; estante: string; ld: EstanteSideInput; le: EstanteSideInput | null }>;
}

export interface ApplyInventoryLayoutResult {
  estantes: number;
  created: number;
  skipped: number;
  relabeled: number;
  errors: Array<{ address: string; message: string }>;
  skus: {
    associated: number;
    unchanged: number;
    notFound: string[];
  };
}

export async function applyInventoryLayout(
  tenantId: string,
  input: ApplyInventoryLayoutInput,
): Promise<ApplyInventoryLayoutResult> {
  const total = input.estantes.reduce(
    (sum, e) => sum + e.ld.colunas * e.ld.linhas + (e.le ? e.le.colunas * e.le.linhas : 0),
    0,
  );
  if (total > MAX_GENERATED_POSITIONS * 5) {
    throw new Error(`Máximo de ${MAX_GENERATED_POSITIONS * 5} posições por importação`);
  }

  const result: ApplyInventoryLayoutResult = {
    estantes: 0,
    created: 0,
    skipped: 0,
    relabeled: 0,
    errors: [],
    skus: { associated: 0, unchanged: 0, notFound: [] },
  };

  const barracaoIds = new Map<string, string | null>();
  const barracaoId = async (code: string) => {
    if (!barracaoIds.has(code)) {
      const b = await prisma.warehouseBarracao.findFirst({
        where: { tenantId, code: { equals: code, mode: "insensitive" } },
        select: { id: true },
      });
      barracaoIds.set(code, b?.id ?? null);
    }
    return barracaoIds.get(code) ?? null;
  };

  for (const e of input.estantes) {
    const id = await barracaoId(e.barracao);
    if (!id) {
      result.errors.push({ address: `${e.barracao}-${e.estante}`, message: `Barracão ${e.barracao} não cadastrado` });
      continue;
    }
    try {
      const r = await generateEstantePositions(tenantId, {
        barracaoId: id,
        estanteCode: e.estante,
        ld: e.ld,
        le: e.le,
        type: LocationType.PICK_FACE,
        addressBarcodes: true,
      });
      result.estantes++;
      result.created += r.created;
      result.skipped += r.skipped;
      result.relabeled += r.relabeled;
      result.errors.push(...r.errors);
    } catch (err) {
      result.errors.push({
        address: `${e.barracao}-${e.estante}`,
        message: err instanceof Error ? err.message : "Erro ao gerar estante",
      });
    }
  }

  const { assignments } = planInventoryLayout(input.rows);
  const productIds = new Map<string, string | null>();
  const notFound = new Set<string>();
  const toResume = new Set<string>();

  for (const { code, sku } of assignments) {
    const key = sku.toLowerCase();
    if (!productIds.has(key)) {
      const product = await prisma.product.findFirst({
        where: {
          tenantId,
          OR: [
            { sku: { equals: sku, mode: "insensitive" } },
            { barcode: { equals: sku, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      productIds.set(key, product?.id ?? null);
    }
    const productId = productIds.get(key);
    if (!productId) {
      notFound.add(sku);
      continue;
    }

    const location = await prisma.location.findFirst({
      where: { tenantId, barcode: code },
      select: { id: true, type: true, productId: true, currentQuantity: true, active: true },
    });
    if (!location) {
      result.errors.push({ address: code, message: "Posição não criada (fora das dimensões da estante)" });
      continue;
    }
    if (location.type === LocationType.PULMAO) {
      result.errors.push({ address: code, message: `Pulmão não tem SKU fixo; ${sku} não associado` });
      continue;
    }
    if (location.productId === productId) {
      result.skus.unchanged++;
      continue;
    }
    if (location.productId && location.currentQuantity > 0) {
      result.errors.push({ address: code, message: `Posição tem saldo de outro SKU; ${sku} não associado` });
      continue;
    }
    try {
      await assertMaxPickFaceLocations(tenantId, productId, location.type, location.id);
      await prisma.location.update({ where: { id: location.id }, data: { productId } });
      result.skus.associated++;
      if (location.type === LocationType.PICK_FACE && location.active) toResume.add(productId);
    } catch (err) {
      result.errors.push({
        address: code,
        message: `${sku}: ${err instanceof Error ? err.message : "erro ao associar"}`,
      });
    }
  }

  for (const productId of toResume) {
    await resumePausedOrdersAfterPickFace(tenantId, productId);
  }
  result.skus.notFound = [...notFound].sort();
  return result;
}
