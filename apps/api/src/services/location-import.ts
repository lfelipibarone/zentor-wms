import { LocationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { assertMaxPickFaceLocations } from "./location-rules.js";
import { resumePausedOrdersAfterPickFace } from "./product-locations.js";
import {
  resolveLocationLayout,
  resolveOrCreateLayoutCodes,
} from "./warehouse-layout.js";

export interface LocationImportInput {
  barcode: string;
  corridor: string;
  row: string;
  barracao?: string;
  setor?: string;
  estante?: string;
  coluna?: string;
  linha?: string;
  type: LocationType;
  productSku?: string;
  capacity: number;
  minThreshold: number;
  currentQuantity?: number;
  active?: boolean;
}

export type LocationImportMode = "upsert" | "createOnly";

export interface LocationImportRowError {
  row: number;
  barcode?: string;
  message: string;
}

export interface LocationImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: LocationImportRowError[];
}

function parseLocationType(raw: string): LocationType | null {
  const v = raw.trim().toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (v === "PICK_FACE" || v === "GONDOLA") return "PICK_FACE";
  if (v === "PULMAO" || v === "PULMAO_RESERVA") return "PULMAO";
  if (v.includes("GIRO") || v.includes("ESTOQUE")) return "PICK_FACE";
  if (v.includes("GOND") || v.includes("PICK") || v === "FRENTE") return "PICK_FACE";
  if (v.includes("PULM") || v.includes("RESERV")) return "PULMAO";
  return null;
}

function parseBool(raw: unknown): boolean | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const v = String(raw).trim().toLowerCase();
  if (["sim", "s", "yes", "y", "true", "1", "ativo"].includes(v)) return true;
  if (["nao", "não", "n", "no", "false", "0", "inativo"].includes(v)) return false;
  return undefined;
}

function parseNumber(raw: unknown, fallback?: number): number | undefined {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeImportRow(
  raw: Record<string, unknown>,
  rowIndex: number,
): { data?: LocationImportInput; error?: LocationImportRowError } {
  const barcode = String(raw.barcode ?? "").trim().toUpperCase();
  const corridor = String(raw.corridor ?? "").trim();
  const row = String(raw.row ?? "").trim();
  const typeRaw = String(raw.type ?? "").trim();

  if (!barcode) {
    return {
      error: { row: rowIndex, message: "Barcode obrigatório" },
    };
  }
  if (!corridor || !row) {
    return {
      error: {
        row: rowIndex,
        barcode,
        message: "Corredor e linha são obrigatórios",
      },
    };
  }

  const type = parseLocationType(typeRaw);
  if (!type) {
    return {
      error: {
        row: rowIndex,
        barcode,
        message: `Tipo inválido: "${typeRaw}". Use Estoque de giro ou Pulmão`,
      },
    };
  }

  const capacity = parseNumber(raw.capacity, 100);
  const minThreshold = parseNumber(raw.minThreshold, 0);
  if (capacity === undefined || capacity < 1) {
    return {
      error: {
        row: rowIndex,
        barcode,
        message: "Capacidade deve ser um número maior que zero",
      },
    };
  }
  if (minThreshold === undefined || minThreshold < 0) {
    return {
      error: {
        row: rowIndex,
        barcode,
        message: "Mínimo inválido",
      },
    };
  }

  const currentQuantity = parseNumber(raw.currentQuantity, 0);
  const productSku = raw.productSku
    ? String(raw.productSku).trim()
    : undefined;
  const optionalText = (key: string) => {
    const v = String(raw[key] ?? "").trim();
    return v || undefined;
  };

  return {
    data: {
      barcode,
      corridor,
      row,
      barracao: optionalText("barracao"),
      setor: optionalText("setor"),
      estante: optionalText("estante"),
      coluna: optionalText("coluna"),
      linha: optionalText("linha"),
      type,
      productSku: productSku || undefined,
      capacity: Math.floor(capacity),
      minThreshold: Math.floor(minThreshold),
      currentQuantity:
        currentQuantity !== undefined
          ? Math.max(0, Math.floor(currentQuantity))
          : 0,
      active: parseBool(raw.active),
    },
  };
}

async function resolveProductId(
  tenantId: string,
  sku?: string,
): Promise<string | null> {
  if (!sku) return null;
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
  return product?.id ?? null;
}

export async function importLocations(
  tenantId: string,
  rows: LocationImportInput[],
  mode: LocationImportMode = "upsert",
): Promise<LocationImportResult> {
  const result: LocationImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const productCache = new Map<string, string | null>();
  const pickFaceProductsToResume = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const input = rows[i]!;
    const rowNum = i + 2;

    try {
      let productId: string | null = null;
      if (input.productSku) {
        const key = input.productSku.toLowerCase();
        if (!productCache.has(key)) {
          productCache.set(
            key,
            await resolveProductId(tenantId, input.productSku),
          );
        }
        productId = productCache.get(key) ?? null;
        if (!productId) {
          result.errors.push({
            row: rowNum,
            barcode: input.barcode,
            message: `Produto não encontrado: ${input.productSku}`,
          });
          continue;
        }
      }

      const layoutIds = await resolveOrCreateLayoutCodes(tenantId, {
        barracao: input.barracao,
        setor: input.setor,
        corredor: input.corridor,
        linha: input.linha ?? input.row,
        estante: input.estante,
        coluna: input.coluna,
      });
      const layout = await resolveLocationLayout(tenantId, layoutIds, {
        corridor: input.corridor,
        row: input.row,
      });

      const existing = await prisma.location.findFirst({
        where: { tenantId, barcode: input.barcode },
        select: { id: true },
      });

      if (existing && mode === "createOnly") {
        result.skipped++;
        continue;
      }

      const baseData = {
        corridor: layout.corridor,
        row: layout.row,
        barracaoId: layout.barracaoId,
        setorId: layout.setorId,
        corredorId: layout.corredorId,
        estanteId: layout.estanteId,
        colunaId: layout.colunaId,
        linhaId: layout.linhaId,
        type: input.type,
        capacity: input.capacity,
        minThreshold: input.minThreshold,
        currentQuantity: input.currentQuantity ?? 0,
        active: input.active ?? true,
      };

      if (productId && input.type === "PICK_FACE") {
        await assertMaxPickFaceLocations(
          tenantId,
          productId,
          input.type,
          existing?.id,
        );
      }

      if (existing) {
        await prisma.location.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            ...(input.currentQuantity !== undefined
              ? { currentQuantity: input.currentQuantity }
              : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            productId: input.productSku ? productId : undefined,
          },
        });
        result.updated++;
        if (input.type === LocationType.PICK_FACE && productId && baseData.active) {
          pickFaceProductsToResume.add(productId);
        }
      } else {
        await prisma.location.create({
          data: {
            tenantId,
            barcode: input.barcode,
            ...baseData,
            productId,
          },
        });
        result.created++;
        if (input.type === LocationType.PICK_FACE && productId && baseData.active) {
          pickFaceProductsToResume.add(productId);
        }
      }
    } catch (e) {
      const msg =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
          ? "Código de barras duplicado"
          : e instanceof Error
            ? e.message
            : "Erro ao importar linha";
      result.errors.push({
        row: rowNum,
        barcode: input.barcode,
        message: msg,
      });
    }
  }

  for (const productId of pickFaceProductsToResume) {
    await resumePausedOrdersAfterPickFace(tenantId, productId);
  }

  return result;
}
