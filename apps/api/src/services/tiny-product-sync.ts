import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type TinyProductPayload = {
  tinyId: number;
  sku: string;
  name: string;
  barcode: string | null;
  unit: string | null;
  weight: number | null;
  imageUrl: string | null;
  supplierName: string | null;
  erpStockQuantity: number | null;
  active: boolean;
};

export const TINY_PRODUCT_SITUACAO_EXCLUIDA = "E";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isTinyProductSituacaoSyncable(situacao: string | null | undefined): boolean {
  if (!situacao) return true;
  return situacao.toUpperCase() !== TINY_PRODUCT_SITUACAO_EXCLUIDA;
}

export function extractImageUrlFromTinyProduct(
  rec: Record<string, unknown>,
): string | null {
  const anexos = asArray(rec.anexos)
    .map((raw) => asRecord(raw))
    .filter(Boolean)
    .map((a) => ({
      url: str(a!.url),
      externo: a!.externo === true,
    }))
    .filter((a) => a.url);

  if (anexos.length === 0) return null;

  const internal = anexos.find((a) => !a.externo);
  return (internal?.url ?? anexos[0]?.url) ?? null;
}

export function extractSupplierNameFromTinyProduct(
  rec: Record<string, unknown>,
): string | null {
  for (const raw of asArray(rec.fornecedores)) {
    const fornecedor = asRecord(raw);
    const nome = str(fornecedor?.nome);
    if (nome) return nome;
  }
  return null;
}

export function extractErpStockQuantityFromTinyProduct(
  rec: Record<string, unknown>,
): number | null {
  const estoque = asRecord(rec.estoque);
  if (!estoque || estoque.quantidade === null || estoque.quantidade === undefined) {
    return null;
  }
  const qty = num(estoque.quantidade);
  return Number.isFinite(qty) ? qty : null;
}

function payloadFromTinyRecord(
  rec: Record<string, unknown>,
  fallbackImageUrl: string | null,
  fallbackTinyId: number,
): TinyProductPayload | null {
  const sku = str(rec.sku);
  if (!sku) return null;

  const situacao = str(rec.situacao)?.toUpperCase() ?? "A";
  if (!isTinyProductSituacaoSyncable(situacao)) return null;

  const tributacao = asRecord(rec.tributacao);
  const gtin = str(rec.gtin) ?? str(tributacao?.gtinEmbalagem);

  const dimensoes = asRecord(rec.dimensoes);
  const pesoLiquido = num(dimensoes?.pesoLiquido);
  const pesoBruto = num(dimensoes?.pesoBruto);
  const weight =
    pesoLiquido > 0 ? pesoLiquido : pesoBruto > 0 ? pesoBruto : null;

  return {
    tinyId: num(rec.id) || fallbackTinyId,
    sku,
    name: str(rec.descricao) ?? sku,
    barcode: gtin ?? null,
    unit: str(rec.unidade) ?? null,
    weight,
    imageUrl: extractImageUrlFromTinyProduct(rec) ?? fallbackImageUrl,
    supplierName: extractSupplierNameFromTinyProduct(rec),
    erpStockQuantity: extractErpStockQuantityFromTinyProduct(rec),
    active: situacao === "A",
  };
}

/** Converte GET /produtos/{id} em um ou mais payloads WMS (produto + variações). */
export function parseTinyProductDetail(
  detail: Record<string, unknown>,
): TinyProductPayload[] {
  const parentImage = extractImageUrlFromTinyProduct(detail);
  const parentId = num(detail.id);
  const out: TinyProductPayload[] = [];
  const seen = new Set<string>();

  const push = (payload: TinyProductPayload | null) => {
    if (!payload) return;
    const key = payload.sku.trim().toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(payload);
  };

  push(payloadFromTinyRecord(detail, parentImage, parentId));

  for (const raw of asArray(detail.variacoes)) {
    const row = asRecord(raw);
    if (!row) continue;
    push(payloadFromTinyRecord(row, parentImage, parentId));
  }

  return out;
}

function isUniqueConstraintError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

export async function upsertProductFromTiny(
  tenantId: string,
  payload: TinyProductPayload,
): Promise<{ productId: string; created: boolean }> {
  const sku = payload.sku.trim().toUpperCase();
  if (!sku) {
    throw new Error("SKU obrigatório");
  }

  const existing = await prisma.product.findFirst({
    where: {
      tenantId,
      sku: { equals: sku, mode: "insensitive" },
    },
  });

  const baseData = {
    name: payload.name.trim(),
    unit: payload.unit?.trim() || null,
    weight: payload.weight,
    imageUrl: payload.imageUrl?.trim() || null,
    supplierName: payload.supplierName?.trim() || null,
    erpStockQuantity: payload.erpStockQuantity,
    active: payload.active,
  };

  const applyBarcode = async (productId: string, barcode: string | null) => {
    if (!barcode) {
      await prisma.product.update({
        where: { id: productId },
        data: { barcode: null },
      });
      return;
    }
    try {
      await prisma.product.update({
        where: { id: productId },
        data: { barcode },
      });
    } catch (e) {
      if (!isUniqueConstraintError(e)) throw e;
      await prisma.product.update({
        where: { id: productId },
        data: { barcode: null },
      });
    }
  };

  if (existing) {
    await prisma.product.update({
      where: { id: existing.id },
      data: baseData,
    });
    await applyBarcode(existing.id, payload.barcode);
    return { productId: existing.id, created: false };
  }

  try {
    const created = await prisma.product.create({
      data: {
        tenantId,
        sku,
        ...baseData,
        barcode: payload.barcode,
        requiresItemScan: false,
      },
    });
    return { productId: created.id, created: true };
  } catch (e) {
    if (isUniqueConstraintError(e) && payload.barcode) {
      const created = await prisma.product.create({
        data: {
          tenantId,
          sku,
          ...baseData,
          barcode: null,
          requiresItemScan: false,
        },
      });
      return { productId: created.id, created: true };
    }
    throw e;
  }
}
