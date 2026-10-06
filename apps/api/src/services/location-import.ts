import { LocationFace, LocationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  assertLocationTypeChange,
  assertMaxPickFaceLocations,
  assertPulmaoWithoutFixedSku,
} from "./location-rules.js";
import { resumePausedOrdersAfterPickFace } from "./product-locations.js";
import {
  resolveLocationLayout,
  resolveOrCreateLayoutCodes,
} from "./warehouse-layout.js";

export interface LocationImportInput {
  barcode: string;
  /** Corredor de layouts antigos; vazio quando a planilha só traz a estante. */
  corridor?: string;
  row: string;
  barracao?: string;
  setor?: string;
  estante?: string;
  coluna?: string;
  linha?: string;
  face?: LocationFace;
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

function parseFace(raw: unknown): LocationFace | null {
  const v = String(raw ?? "").trim().toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!v || v === "A" || v === "LD" || v === "FRENTE") return LocationFace.A;
  if (v === "B" || v === "LE" || v === "VERSO") return LocationFace.B;
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
  const estante = String(raw.estante ?? "").trim();
  const row = String(raw.linha ?? "").trim() || String(raw.row ?? "").trim();
  const typeRaw = String(raw.type ?? "").trim();

  if (!barcode) {
    return {
      error: { row: rowIndex, message: "Barcode obrigatório" },
    };
  }
  if ((!estante && !corridor) || !row) {
    return {
      error: {
        row: rowIndex,
        barcode,
        message: "Estante e linha são obrigatórias",
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

  const face = parseFace(raw.face);
  if (!face) {
    return {
      error: {
        row: rowIndex,
        barcode,
        message: `Face inválida: "${String(raw.face)}". Use LD ou LE`,
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
      corridor: corridor || undefined,
      row,
      barracao: optionalText("barracao"),
      setor: optionalText("setor"),
      estante: optionalText("estante"),
      coluna: optionalText("coluna"),
      linha: optionalText("linha"),
      face,
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
      assertPulmaoWithoutFixedSku(input.type, input.productSku);
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
        face: input.face,
      });
      const layout = await resolveLocationLayout(tenantId, layoutIds, {
        corridor: input.corridor,
        row: input.row,
      });

      const existingSelect = { id: true, barcode: true, type: true, currentQuantity: true } as const;
      const byBarcode = await prisma.location.findFirst({
        where: { tenantId, barcode: input.barcode },
        select: existingSelect,
      });
      const byAddress = layout.linhaId
        ? await prisma.location.findFirst({
            where: { tenantId, linhaId: layout.linhaId },
            select: existingSelect,
          })
        : null;

      if ((byBarcode || byAddress) && mode === "createOnly") {
        result.skipped++;
        continue;
      }
      if (byBarcode && byAddress && byBarcode.id !== byAddress.id) {
        result.errors.push({
          row: rowNum,
          barcode: input.barcode,
          message: `Endereço já ocupado pela etiqueta ${byAddress.barcode}`,
        });
        continue;
      }
      const existing = byBarcode ?? byAddress;

      const baseData = {
        corridor: layout.corridor,
        row: layout.row,
        barracaoId: layout.barracaoId,
        setorId: layout.setorId,
        corredorId: layout.corredorId,
        estanteId: layout.estanteId,
        colunaId: layout.colunaId,
        linhaId: layout.linhaId,
        face: input.face ?? LocationFace.A,
        type: input.type,
        capacity: input.capacity,
        minThreshold: input.minThreshold,
        active: input.active ?? true,
      };
      // Saldo do pulmão vem de LocationStock (por SKU); a planilha só define saldo de gôndola.
      const importedQuantity =
        input.type === LocationType.PULMAO ? undefined : input.currentQuantity;

      if (existing) assertLocationTypeChange(existing, input.type);
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
            barcode: input.barcode,
            ...(importedQuantity !== undefined
              ? { currentQuantity: importedQuantity }
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
            currentQuantity: importedQuantity ?? 0,
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
