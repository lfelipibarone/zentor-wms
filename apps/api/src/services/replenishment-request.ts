import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  adjustLocationQuantity,
  LocationAdjustError,
} from "./location-adjust.js";

export type ReplenishmentInputMode = "UNITS" | "PERCENT";

export type RequestReplenishmentInput = {
  tenantId: string;
  userId: string;
  barcode: string;
  inputMode: ReplenishmentInputMode;
  value: number;
};

export type RequestReplenishmentResult = {
  location: {
    id: string;
    barcode: string;
    label: string;
    currentQuantity: number;
    capacity: number;
    minThreshold: number;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
    } | null;
  };
  previousQuantity: number;
  countedQuantity: number;
  inputMode: ReplenishmentInputMode;
  inputValue: number;
  needsReplenishment: boolean;
  deficit: number;
  message: string;
};

function computeDeficit(
  currentQuantity: number,
  minThreshold: number,
  capacity: number,
): number {
  const deficit = Math.max(0, minThreshold - currentQuantity);
  const room = Math.max(0, capacity - currentQuantity);
  return Math.min(deficit > 0 ? deficit : room, room || deficit || 1);
}

function resolveCountedQuantity(
  inputMode: ReplenishmentInputMode,
  value: number,
  capacity: number,
): number {
  if (inputMode === "PERCENT") {
    const percent = Math.floor(Number(value));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new LocationAdjustError("Percentual deve estar entre 0 e 100");
    }
    return Math.min(capacity, Math.round((capacity * percent) / 100));
  }

  const units = Math.floor(Number(value));
  if (!Number.isFinite(units) || units < 0) {
    throw new LocationAdjustError("Quantidade em unidades inválida");
  }
  return units;
}

export async function requestReplenishmentFromPickFace(
  input: RequestReplenishmentInput,
): Promise<RequestReplenishmentResult> {
  const barcode = input.barcode.trim();
  if (!barcode) {
    throw new LocationAdjustError("Código da gôndola obrigatório");
  }

  const location = await prisma.location.findFirst({
    where: {
      tenantId: input.tenantId,
      barcode,
      active: true,
    },
    include: { product: true },
  });

  if (!location) {
    throw new LocationAdjustError("Gôndola não encontrada", 404);
  }

  if (location.type !== LocationType.PICK_FACE) {
    throw new LocationAdjustError(
      "Solicitação de reabastecimento apenas em estoque de giro (gôndola)",
    );
  }

  if (!location.productId || !location.product) {
    throw new LocationAdjustError(
      "Gôndola sem produto alocado — aloque um SKU antes de solicitar reabastecimento",
    );
  }

  const countedQuantity = resolveCountedQuantity(
    input.inputMode,
    input.value,
    location.capacity,
  );

  const adjust = await adjustLocationQuantity({
    tenantId: input.tenantId,
    userId: input.userId,
    barcode,
    countedQuantity,
    reason: "Solicitação de reabastecimento",
  });

  const needsReplenishment =
    adjust.location.currentQuantity <= adjust.location.minThreshold;
  const deficit = needsReplenishment
    ? computeDeficit(
        adjust.location.currentQuantity,
        adjust.location.minThreshold,
        adjust.location.capacity,
      )
    : 0;

  const message = needsReplenishment
    ? `Saldo atualizado. Gôndola na fila de reposição (repor ~${deficit} un.).`
    : "Saldo atualizado. Gôndola ainda acima do mínimo — não entrou na fila.";

  return {
    location: {
      id: adjust.location.id,
      barcode: adjust.location.barcode,
      label: adjust.location.label,
      currentQuantity: adjust.location.currentQuantity,
      capacity: adjust.location.capacity,
      minThreshold: adjust.location.minThreshold,
      product: adjust.location.product,
    },
    previousQuantity: adjust.previousQuantity,
    countedQuantity: adjust.location.currentQuantity,
    inputMode: input.inputMode,
    inputValue: input.value,
    needsReplenishment,
    deficit,
    message,
  };
}

export { LocationAdjustError };
