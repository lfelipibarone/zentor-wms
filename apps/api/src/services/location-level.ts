import { LocationStockMode, LocationType, type Prisma } from "@prisma/client";
import { StockPercentError } from "./stock-percent.js";

type QuantityShape = { capacity: number; minQuantity: number };

type LevelLocation = {
  id: string;
  type: LocationType;
  stockMode: LocationStockMode;
  stockQuantity: number;
  capacity: number;
  minQuantity: number;
  fillPercent: number;
};

export function isQuantityMode(loc: { type: LocationType; stockMode: LocationStockMode }) {
  return loc.type !== LocationType.PULMAO && loc.stockMode === LocationStockMode.QUANTITY;
}

/**
 * % derivada das unidades. Garante que `fillPercent <= minPercent` ⇔ `quantidade <= mínimo`,
 * para que todo o código que compara % (ressuprimento, alertas, relatórios) continue certo.
 */
export function levelFromQuantity(quantity: number, loc: QuantityShape) {
  const capacity = Math.max(1, loc.capacity);
  const toPercent = (n: number) => Math.min(100, Math.max(0, Math.round((n * 100) / capacity)));
  const minPercent = Math.min(99, toPercent(loc.minQuantity));
  let fillPercent = toPercent(quantity);
  if (quantity > loc.minQuantity) fillPercent = Math.max(fillPercent, minPercent + 1);
  else fillPercent = Math.min(fillPercent, minPercent);
  return { fillPercent, minPercent };
}

/** Dados para gravar uma gôndola por quantidade com `quantity` unidades. */
export function quantityLevelData(quantity: number, loc: QuantityShape) {
  const units = Math.max(0, Math.floor(quantity));
  return { stockQuantity: units, ...levelFromQuantity(units, loc) };
}

export function parseUnits(value: unknown, label = "Quantidade"): number {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
    throw new StockPercentError(`Informe a ${label.toLowerCase()} em unidades`);
  }
  if (n < 0) throw new StockPercentError(`${label} não pode ser negativa`);
  return Math.floor(n);
}

/** Campos de modo que as telas usam para mostrar "12 un." em vez de "%". */
export function stockModeFields(loc: {
  type: LocationType;
  stockMode: LocationStockMode;
  stockQuantity: number;
  capacity: number;
  minQuantity: number;
}) {
  const quantity = isQuantityMode(loc);
  return {
    stockMode: quantity ? LocationStockMode.QUANTITY : LocationStockMode.PERCENT,
    stockQuantity: quantity ? loc.stockQuantity : null,
    minQuantity: quantity ? loc.minQuantity : null,
    capacity: loc.capacity,
  };
}

export type StockModeChange = {
  stockMode?: LocationStockMode | "PERCENT" | "QUANTITY";
  capacity?: number;
  stockQuantity?: number;
  minQuantity?: number;
};

/**
 * Dados para gravar o modo/capacidade/unidades de uma gôndola. Ao passar de % para quantidade,
 * estima as unidades e o mínimo pela capacidade (o operador corrige na próxima contagem).
 * Retorna null quando não há nada de modo para mudar.
 */
export function stockModeUpdateData(
  loc: {
    type: LocationType;
    stockMode: LocationStockMode;
    stockQuantity: number;
    capacity: number;
    minQuantity: number;
    fillPercent: number;
    minPercent: number;
  },
  change: StockModeChange,
) {
  if (loc.type === LocationType.PULMAO) {
    return change.capacity !== undefined ? { capacity: assertCapacity(change.capacity) } : null;
  }
  const mode = (change.stockMode ?? loc.stockMode) as LocationStockMode;
  const capacity = change.capacity !== undefined ? assertCapacity(change.capacity) : loc.capacity;
  if (mode !== LocationStockMode.QUANTITY) {
    if (change.stockMode === undefined && change.capacity === undefined) return null;
    return { stockMode: LocationStockMode.PERCENT, capacity };
  }
  const switching = loc.stockMode !== LocationStockMode.QUANTITY;
  const minQuantity =
    change.minQuantity !== undefined
      ? Math.max(0, Math.floor(change.minQuantity))
      : switching
        ? Math.round((loc.minPercent * capacity) / 100)
        : loc.minQuantity;
  const units =
    change.stockQuantity !== undefined
      ? change.stockQuantity
      : switching
        ? Math.round((loc.fillPercent * capacity) / 100)
        : loc.stockQuantity;
  return {
    stockMode: LocationStockMode.QUANTITY,
    capacity,
    minQuantity,
    ...quantityLevelData(units, { capacity, minQuantity }),
  };
}

function assertCapacity(value: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) throw new StockPercentError("Capacidade deve ser maior que zero");
  return n;
}

/**
 * Baixa automática do picking em gôndola por quantidade.
 * Retorna as % antes/depois para o histórico, ou null se a gôndola é por %.
 */
export async function decrementFaceOnPick(
  tx: Prisma.TransactionClient,
  loc: LevelLocation,
  units: number,
) {
  if (!isQuantityMode(loc) || units <= 0) return null;
  const current = await tx.location.findUniqueOrThrow({
    where: { id: loc.id },
    select: { stockQuantity: true, fillPercent: true, capacity: true, minQuantity: true },
  });
  const data = quantityLevelData(current.stockQuantity - units, current);
  await tx.location.update({ where: { id: loc.id }, data });
  return {
    before: current.fillPercent,
    after: data.fillPercent,
    unitsBefore: current.stockQuantity,
    unitsAfter: data.stockQuantity,
  };
}

/** Desfaz a baixa do picking quando o item volta para a gôndola. Null se a gôndola é por %. */
export async function restoreFaceOnReturn(
  tx: Prisma.TransactionClient,
  loc: LevelLocation,
  units: number,
) {
  if (!isQuantityMode(loc) || units <= 0) return null;
  const current = await tx.location.findUniqueOrThrow({
    where: { id: loc.id },
    select: { stockQuantity: true, fillPercent: true, capacity: true, minQuantity: true },
  });
  const data = quantityLevelData(current.stockQuantity + units, current);
  await tx.location.update({ where: { id: loc.id }, data });
  return { before: current.fillPercent, after: data.fillPercent };
}
