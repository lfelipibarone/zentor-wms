import { InventoryMovementType, LocationType, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/** % mínima padrão da gôndola. */
export const DEFAULT_MIN_PERCENT = 20;

/** Marca, por tenant, que o estoque já está em % (a conversão das unidades roda uma vez). */
export const STOCK_PERCENT_SETTING_KEY = "stock.percent_mode";

export class StockPercentError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "StockPercentError";
  }
}

/** Valida uma % informada (inteiro de 0 a 100). */
export function parsePercent(value: unknown, label = "Porcentagem"): number {
  const n = typeof value === "string" ? Number(value.replace("%", "").trim()) : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
    throw new StockPercentError(`Informe a ${label.toLowerCase()} (0 a 100%)`);
  }
  if (n < 0 || n > 100) throw new StockPercentError(`${label} deve ficar entre 0 e 100%`);
  return Math.round(n);
}

export function needsReplenishment(fillPercent: number, minPercent: number): boolean {
  return fillPercent <= minPercent;
}

/** Quanto falta (em pontos de %) para a gôndola ficar cheia. */
export function percentToFill(fillPercent: number): number {
  return Math.max(0, 100 - fillPercent);
}

/** Registra no histórico uma mudança de % de uma posição. */
export async function recordPercentMovement(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    userId: string;
    productId: string;
    locationId: string;
    before: number;
    after: number;
    type?: InventoryMovementType;
    reference?: string;
    notes?: string | null;
    orderId?: string | null;
    pickWaveLineId?: string | null;
    cargoTransferId?: string | null;
    putawaySessionId?: string | null;
    putawayItemId?: string | null;
    purchaseReceiptSessionId?: string | null;
    quantity?: number;
  },
) {
  const increased = params.after >= params.before;
  return tx.inventoryMovement.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      productId: params.productId,
      type: params.type ?? InventoryMovementType.ADJUSTMENT,
      quantity: params.quantity ?? 0,
      percentBefore: params.before,
      percentAfter: params.after,
      ...(increased ? { toLocationId: params.locationId } : { fromLocationId: params.locationId }),
      reference: params.reference ?? null,
      notes: params.notes ?? null,
      orderId: params.orderId ?? null,
      pickWaveLineId: params.pickWaveLineId ?? null,
      cargoTransferId: params.cargoTransferId ?? null,
      putawaySessionId: params.putawaySessionId ?? null,
      putawayItemId: params.putawayItemId ?? null,
      purchaseReceiptSessionId: params.purchaseReceiptSessionId ?? null,
      completedAt: new Date(),
    },
  });
}

/** Marca o tenant como já estando no estoque em % (tenant novo não tem saldos em unidades). */
export async function markTenantStockPercent(db: Prisma.TransactionClient | PrismaClient, tenantId: string) {
  await db.systemSetting.upsert({
    where: { tenantId_key: { tenantId, key: STOCK_PERCENT_SETTING_KEY } },
    create: {
      tenantId,
      key: STOCK_PERCENT_SETTING_KEY,
      value: "1",
      description: "Estoque das posições controlado em %",
    },
    update: {},
  });
}

/**
 * Converte, uma vez por tenant, os saldos em unidades para % (quantidade ÷ capacidade).
 * Gôndola: % de 0 a 100 e % mínima (0 vira o padrão de 20%). Pulmão: % de cada SKU (mín. 1%)
 * e ocupação = soma.
 */
export async function convertStockToPercent(db: PrismaClient = prisma) {
  const tenants = await db.tenant.findMany({
    where: { systemSettings: { none: { key: STOCK_PERCENT_SETTING_KEY } } },
    select: { id: true },
  });
  let converted = 0;
  for (const { id: tenantId } of tenants) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE locations SET
          "currentQuantity" = CASE
            WHEN capacity > 0 THEN LEAST(100, GREATEST(0, ROUND("currentQuantity" * 100.0 / capacity)))
            WHEN "currentQuantity" > 0 THEN 100 ELSE 0 END,
          "minThreshold" = CASE
            WHEN "minThreshold" > 0 AND capacity > 0
              THEN LEAST(100, GREATEST(1, ROUND("minThreshold" * 100.0 / capacity)))
            ELSE ${DEFAULT_MIN_PERCENT} END
        WHERE "tenantId" = ${tenantId} AND type = ${LocationType.PICK_FACE}::"LocationType"`;
      await tx.$executeRaw`
        UPDATE location_stocks ls SET quantity = CASE
            WHEN l.capacity > 0 THEN LEAST(100, GREATEST(1, ROUND(ls.quantity * 100.0 / l.capacity)))
            ELSE 100 END
        FROM locations l
        WHERE l.id = ls."locationId" AND ls."tenantId" = ${tenantId} AND ls.quantity > 0`;
      await tx.$executeRaw`DELETE FROM location_stocks WHERE "tenantId" = ${tenantId} AND quantity <= 0`;
      await tx.$executeRaw`
        UPDATE locations l SET
          "currentQuantity" = COALESCE((SELECT SUM(ls.quantity) FROM location_stocks ls WHERE ls."locationId" = l.id), 0),
          "minThreshold" = ${DEFAULT_MIN_PERCENT}
        WHERE l."tenantId" = ${tenantId} AND l.type = ${LocationType.PULMAO}::"LocationType"`;
      await markTenantStockPercent(tx, tenantId);
    });
    converted++;
  }
  return { converted };
}
