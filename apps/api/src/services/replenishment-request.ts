import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { adjustLocationPercent, LocationAdjustError } from "./location-adjust.js";

export type RequestReplenishmentInput = {
  tenantId: string;
  userId: string;
  barcode: string;
  percent: unknown;
};

export type RequestReplenishmentResult = {
  location: {
    id: string;
    barcode: string;
    label: string;
    fillPercent: number;
    minPercent: number;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
    } | null;
  };
  previousPercent: number;
  needsReplenishment: boolean;
  message: string;
};

/** Correção da gôndola: grava a % atual; abaixo ou igual à % mínima entra na fila de reposição. */
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
      barcode: { equals: barcode, mode: "insensitive" },
      active: true,
    },
    select: { type: true, productId: true },
  });

  if (!location) {
    throw new LocationAdjustError("Gôndola não encontrada", 404);
  }

  if (location.type !== LocationType.PICK_FACE) {
    throw new LocationAdjustError(
      "Solicitação de reabastecimento apenas em estoque de giro (gôndola)",
    );
  }

  if (!location.productId) {
    throw new LocationAdjustError(
      "Gôndola sem produto alocado — aloque um SKU antes de solicitar reabastecimento",
    );
  }

  const adjust = await adjustLocationPercent({
    tenantId: input.tenantId,
    userId: input.userId,
    barcode,
    percent: input.percent,
    reason: "Correção / solicitação de reabastecimento",
  });

  const { needsReplenishment } = adjust.location;
  const message = needsReplenishment
    ? `Gôndola em ${adjust.location.fillPercent}% — entrou na fila de reposição.`
    : `Gôndola em ${adjust.location.fillPercent}% — acima do mínimo (${adjust.location.minPercent}%), não entrou na fila.`;

  return {
    location: {
      id: adjust.location.id,
      barcode: adjust.location.barcode,
      label: adjust.location.label,
      fillPercent: adjust.location.fillPercent,
      minPercent: adjust.location.minPercent,
      product: adjust.location.product,
    },
    previousPercent: adjust.previousPercent,
    needsReplenishment,
    message,
  };
}

export { LocationAdjustError };
