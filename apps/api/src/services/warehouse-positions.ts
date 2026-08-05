import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { assertMaxPickFaceLocations } from "./location-rules.js";
import { resumePausedOrdersAfterPickFace } from "./product-locations.js";
import {
  ensureWarehouseHierarchy,
  hasAnyAddressCode,
  normalizeWarehouseCode,
  resolveEffectiveAddressCodes,
  resolveLocationLayout,
  WAREHOUSE_ADDRESS_PLACEHOLDER,
} from "./warehouse-layout.js";
import {
  normalizeProximityReferences,
  primaryProximityReference,
  replaceLocationProximityReferences,
  type ProximityReferenceInput,
  validateProximityReferences,
} from "./location-proximity-references.js";

function normalizeCode(code: string): string {
  return normalizeWarehouseCode(code);
}

export interface CreateWarehousePositionInput {
  colunaId?: string;
  setorCode?: string;
  corredorCode?: string;
  estanteCode?: string;
  colunaCode?: string;
  linhaCode?: string;
  linhaName?: string | null;
  barcode: string;
  type: LocationType;
  productId?: string | null;
  capacity: number;
  minThreshold?: number;
  currentQuantity?: number;
  active?: boolean;
  barracaoId?: string | null;
  setorId?: string | null;
  corredorId?: string | null;
  estanteId?: string | null;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
  proximityReferences?: ProximityReferenceInput[];
}

export async function createWarehousePosition(
  tenantId: string,
  input: CreateWarehousePositionInput,
) {
  const barcode = input.barcode?.trim().toUpperCase();
  if (!barcode) throw new Error("Código de barras obrigatório");
  if (input.capacity < 1) throw new Error("Capacidade deve ser maior que zero");

  let colunaId = input.colunaId?.trim() || "";
  let barracaoId = input.barracaoId ?? null;
  let setorId = input.setorId ?? null;
  let corredorId = input.corredorId ?? null;
  let estanteId = input.estanteId ?? null;

  const effectiveAddress = resolveEffectiveAddressCodes({
    setorCode: input.setorCode,
    corredorCode: input.corredorCode,
    estanteCode: input.estanteCode,
    colunaCode: input.colunaCode,
    linhaCode: input.linhaCode,
  });

  if (!colunaId) {
    if (!hasAnyAddressCode(input)) {
      throw new Error("Informe ao menos um nível do endereço ou selecione uma coluna");
    }
    if (!barracaoId) {
      throw new Error("Barracão obrigatório para criar endereço inline");
    }
    if (!effectiveAddress) {
      throw new Error("Informe ao menos um nível do endereço");
    }
    const hierarchy = await ensureWarehouseHierarchy(tenantId, {
      barracaoId,
      setorCode: effectiveAddress.setorCode,
      corredorCode: effectiveAddress.corredorCode,
      estanteCode: effectiveAddress.estanteCode,
      colunaCode: effectiveAddress.colunaCode,
    });
    colunaId = hierarchy.colunaId;
    barracaoId = hierarchy.barracaoId;
    setorId = hierarchy.setorId;
    corredorId = hierarchy.corredorId;
    estanteId = hierarchy.estanteId;
  }

  const linhaCode =
    effectiveAddress?.linhaCode ??
    (input.linhaCode?.trim()
      ? normalizeCode(input.linhaCode)
      : WAREHOUSE_ADDRESS_PLACEHOLDER);

  const coluna = await prisma.warehouseColuna.findFirst({
    where: { id: colunaId, tenantId },
    include: {
      estante: { include: { corredor: { include: { setor: true } } } },
    },
  });
  if (!coluna) throw new Error("Coluna inválida");

  const proximityReferences = normalizeProximityReferences(
    input.proximityReferences,
    {
      proximityCorredorId: input.proximityCorredorId,
      proximityEstanteId: input.proximityEstanteId,
      proximityLinhaId: input.proximityLinhaId,
    },
  );
  const primaryProximity = primaryProximityReference(proximityReferences);
  await validateProximityReferences(tenantId, proximityReferences);

  const layout = await resolveLocationLayout(
    tenantId,
    {
      barracaoId: barracaoId ?? coluna.estante.corredor.setor.barracaoId,
      setorId: setorId ?? coluna.estante.corredor.setorId,
      corredorId: corredorId ?? coluna.estante.corredorId,
      estanteId: estanteId ?? coluna.estanteId,
      colunaId: coluna.id,
      proximityCorredorId: primaryProximity.proximityCorredorId,
      proximityEstanteId: primaryProximity.proximityEstanteId,
      proximityLinhaId: primaryProximity.proximityLinhaId,
    },
    { row: linhaCode },
  );

  await assertMaxPickFaceLocations(
    tenantId,
    input.productId,
    input.type,
  );

  const normalizedLinhaCode = normalizeCode(linhaCode);

  const existingLinha = await prisma.warehouseLinha.findFirst({
    where: {
      tenantId,
      colunaId: coluna.id,
      code: normalizedLinhaCode,
    },
    include: { location: { select: { id: true, barcode: true } } },
  });

  if (existingLinha?.location) {
    throw new Error(
      "Já existe uma posição nesta linha. Escolha outro código de linha ou edite a posição existente.",
    );
  }

  const existingBarcode = await prisma.location.findFirst({
    where: { tenantId, barcode },
    select: { id: true },
  });
  if (existingBarcode) {
    throw new Error("Código de barras já cadastrado em outra posição");
  }

  const result = await prisma.$transaction(async (tx) => {
    const linha =
      existingLinha ??
      (await tx.warehouseLinha.create({
        data: {
          tenantId,
          colunaId: coluna.id,
          code: normalizedLinhaCode,
          name: input.linhaName?.trim() || null,
          active: input.active ?? true,
        },
      }));

    if (existingLinha && input.linhaName?.trim()) {
      await tx.warehouseLinha.update({
        where: { id: linha.id },
        data: { name: input.linhaName.trim() },
      });
    }

    const layoutWithLinha = {
      ...layout,
      linhaId: linha.id,
    };
    await validateProximityReferences(
      tenantId,
      proximityReferences,
      linha.id,
    );

    const location = await tx.location.create({
      data: {
        tenantId,
        corridor: layoutWithLinha.corridor,
        row: layoutWithLinha.row,
        barcode,
        barracaoId: layoutWithLinha.barracaoId,
        setorId: layoutWithLinha.setorId,
        corredorId: layoutWithLinha.corredorId,
        estanteId: layoutWithLinha.estanteId,
        colunaId: layoutWithLinha.colunaId,
        linhaId: linha.id,
        proximityCorredorId: layoutWithLinha.proximityCorredorId,
        proximityEstanteId: layoutWithLinha.proximityEstanteId,
        proximityLinhaId: layoutWithLinha.proximityLinhaId,
        type: input.type,
        productId: input.productId || null,
        capacity: input.capacity,
        minThreshold: input.minThreshold ?? 0,
        currentQuantity: input.currentQuantity ?? 0,
        active: input.active ?? true,
      },
      include: {
        product: { select: { sku: true, name: true } },
      },
    });

    await replaceLocationProximityReferences(
      tx,
      tenantId,
      location.id,
      proximityReferences,
    );

    return { linha, location };
  });

  let resumedOrders = { resumedOrderIds: [] as string[] };
  if (
    input.type === LocationType.PICK_FACE &&
    input.productId &&
    (input.active ?? true)
  ) {
    resumedOrders = await resumePausedOrdersAfterPickFace(
      tenantId,
      input.productId,
    );
  }

  return { ...result, resumedOrders };
}

export interface UpdateWarehousePositionInput {
  linhaId: string;
  linhaCode?: string;
  linhaName?: string | null;
  linhaActive?: boolean;
  barcode?: string;
  type?: LocationType;
  productId?: string | null;
  capacity?: number;
  minThreshold?: number;
  currentQuantity?: number;
  active?: boolean;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
  proximityReferences?: ProximityReferenceInput[];
}

export async function updateWarehousePosition(
  tenantId: string,
  input: UpdateWarehousePositionInput,
) {
  const linha = await prisma.warehouseLinha.findFirst({
    where: { id: input.linhaId, tenantId },
    include: {
      location: true,
      coluna: {
        include: { estante: { include: { corredor: { include: { setor: true } } } } },
      },
    },
  });
  if (!linha) throw new Error("Linha não encontrada");

  const location = linha.location;
  if (!location) throw new Error("Posição sem localização vinculada");

  const type = input.type ?? location.type;
  const productId =
    input.productId !== undefined ? input.productId : location.productId;

  await assertMaxPickFaceLocations(
    tenantId,
    productId,
    type,
    location.id,
  );

  const proximityReferences = normalizeProximityReferences(
    input.proximityReferences,
    input.proximityCorredorId !== undefined ||
      input.proximityEstanteId !== undefined ||
      input.proximityLinhaId !== undefined
      ? {
          proximityCorredorId: input.proximityCorredorId,
          proximityEstanteId: input.proximityEstanteId,
          proximityLinhaId: input.proximityLinhaId,
        }
      : {
          proximityCorredorId: location.proximityCorredorId,
          proximityEstanteId: location.proximityEstanteId,
          proximityLinhaId: location.proximityLinhaId,
        },
  );
  const primaryProximity = primaryProximityReference(proximityReferences);
  await validateProximityReferences(
    tenantId,
    proximityReferences,
    linha.id,
  );

  const layout = await resolveLocationLayout(tenantId, {
    barracaoId: linha.coluna.estante.corredor.setor.barracaoId,
    setorId: linha.coluna.estante.corredor.setorId,
    corredorId: linha.coluna.estante.corredorId,
    estanteId: linha.coluna.estanteId,
    colunaId: linha.colunaId,
    linhaId: linha.id,
    proximityCorredorId: primaryProximity.proximityCorredorId,
    proximityEstanteId: primaryProximity.proximityEstanteId,
    proximityLinhaId: primaryProximity.proximityLinhaId,
  });

  const updated = await prisma.$transaction(async (tx) => {
    if (
      input.linhaCode !== undefined ||
      input.linhaName !== undefined ||
      input.linhaActive !== undefined
    ) {
      await tx.warehouseLinha.update({
        where: { id: linha.id },
        data: {
          ...(input.linhaCode !== undefined
            ? { code: normalizeCode(input.linhaCode) }
            : {}),
          ...(input.linhaName !== undefined
            ? { name: input.linhaName?.trim() || null }
            : {}),
          ...(input.linhaActive !== undefined ? { active: input.linhaActive } : {}),
        },
      });
    }

    const locationUpdated = await tx.location.update({
      where: { id: location.id },
      data: {
        corridor: layout.corridor,
        row: layout.row,
        ...(input.barcode !== undefined
          ? { barcode: input.barcode.trim().toUpperCase() }
          : {}),
        proximityCorredorId: layout.proximityCorredorId,
        proximityEstanteId: layout.proximityEstanteId,
        proximityLinhaId: layout.proximityLinhaId,
        colunaId: layout.colunaId,
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.productId !== undefined ? { productId: input.productId } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.minThreshold !== undefined
          ? { minThreshold: input.minThreshold }
          : {}),
        ...(input.currentQuantity !== undefined
          ? { currentQuantity: input.currentQuantity }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: {
        product: { select: { sku: true, name: true } },
        linha: true,
      },
    });

    if (
      input.proximityReferences !== undefined ||
      input.proximityCorredorId !== undefined ||
      input.proximityEstanteId !== undefined ||
      input.proximityLinhaId !== undefined
    ) {
      await replaceLocationProximityReferences(
        tx,
        tenantId,
        location.id,
        proximityReferences,
      );
    }

    return locationUpdated;
  });

  let resumedOrders = { resumedOrderIds: [] as string[] };
  if (updated.type === LocationType.PICK_FACE && updated.productId && updated.active) {
    resumedOrders = await resumePausedOrdersAfterPickFace(
      tenantId,
      updated.productId,
    );
  }

  return { location: updated, resumedOrders };
}
