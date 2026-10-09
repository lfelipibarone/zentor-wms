import { LocationFace, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { DEFAULT_MIN_PERCENT, parsePercent } from "./stock-percent.js";
import { stockModeUpdateData, type StockModeChange } from "./location-level.js";
import {
  assertLocationTypeChange,
  assertMaxPickFaceLocations,
  assertPulmaoWithoutFixedSku,
} from "./location-rules.js";
import { resumePausedOrdersAfterPickFace } from "./product-locations.js";
import {
  ensureWarehouseHierarchy,
  hasAnyAddressCode,
  inheritGondolaParentCodes,
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


function clampPercent(value: number | undefined, fallback: number): number {
  return value === undefined || value === null ? fallback : parsePercent(value);
}

export function parseLocationFace(face: unknown): LocationFace {
  return String(face ?? "").trim().toUpperCase() === "B" ? LocationFace.B : LocationFace.A;
}

export interface CreateWarehousePositionInput {
  colunaId?: string;
  setorCode?: string;
  corredorCode?: string;
  estanteCode?: string;
  colunaCode?: string;
  linhaCode?: string;
  linhaName?: string | null;
  face?: LocationFace | "A" | "B";
  barcode: string;
  type: LocationType;
  productId?: string | null;
  /** Capacidade em unidades (só informativa) */
  capacity?: number;
  /** % mínima da gôndola */
  minPercent?: number;
  /** % atual da gôndola */
  fillPercent?: number;
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
  const capacity = input.capacity ?? 100;
  if (capacity < 1) throw new Error("Capacidade deve ser maior que zero");
  const minPercent = clampPercent(input.minPercent, DEFAULT_MIN_PERCENT);
  const fillPercent = clampPercent(input.fillPercent, 0);

  let colunaId = input.colunaId?.trim() || "";
  let barracaoId = input.barracaoId ?? null;
  let setorId = input.setorId ?? null;
  let corredorId = input.corredorId ?? null;
  let estanteId = input.estanteId ?? null;

  const parents =
    !colunaId && barracaoId
      ? await inheritGondolaParentCodes(tenantId, barracaoId, {
          setor: input.setorCode,
          corredor: input.corredorCode,
          estante: input.estanteCode,
        })
      : { setor: input.setorCode, corredor: input.corredorCode };
  const effectiveAddress = resolveEffectiveAddressCodes({
    setorCode: parents.setor,
    corredorCode: parents.corredor,
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

  assertPulmaoWithoutFixedSku(input.type, input.productId);
  await assertMaxPickFaceLocations(
    tenantId,
    input.productId,
    input.type,
  );

  const normalizedLinhaCode = normalizeCode(linhaCode);
  const face = parseLocationFace(input.face);

  const existingLinha = await prisma.warehouseLinha.findFirst({
    where: {
      tenantId,
      colunaId: coluna.id,
      code: normalizedLinhaCode,
      face,
    },
    include: { location: { select: { id: true, barcode: true } } },
  });

  if (existingLinha?.location) {
    throw new Error(
      face === LocationFace.B
        ? "Já existe uma posição no LE desta coluna e linha. Escolha outra linha ou edite a posição existente."
        : "Já existe uma posição no LD desta coluna e linha. Escolha outra linha ou edite a posição existente.",
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
          face,
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
        face,
        proximityCorredorId: layoutWithLinha.proximityCorredorId,
        proximityEstanteId: layoutWithLinha.proximityEstanteId,
        proximityLinhaId: layoutWithLinha.proximityLinhaId,
        type: input.type,
        productId: input.productId || null,
        capacity,
        minPercent,
        fillPercent: input.type === LocationType.PULMAO ? 0 : fillPercent,
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
  face?: LocationFace | "A" | "B";
  barcode?: string;
  type?: LocationType;
  productId?: string | null;
  capacity?: number;
  minPercent?: number;
  fillPercent?: number;
  stockMode?: "PERCENT" | "QUANTITY";
  stockQuantity?: number;
  minQuantity?: number;
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
  assertLocationTypeChange(location, input.type);
  assertPulmaoWithoutFixedSku(type, input.productId);
  const productId =
    type === LocationType.PULMAO
      ? null
      : input.productId !== undefined
        ? input.productId
        : location.productId;

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

  const face = input.face !== undefined ? parseLocationFace(input.face) : linha.face;
  if (face !== linha.face || input.linhaCode !== undefined) {
    const code = input.linhaCode !== undefined ? normalizeCode(input.linhaCode) : linha.code;
    const clash = await prisma.warehouseLinha.findFirst({
      where: { tenantId, colunaId: linha.colunaId, code, face, id: { not: linha.id } },
      select: { id: true },
    });
    if (clash) {
      throw new Error(
        `Já existe uma posição na linha ${code} ${face === LocationFace.B ? "(LE)" : "(LD)"} desta coluna`,
      );
    }
  }

  const modeData = stockModeUpdateData(
    {
      ...location,
      type,
      minPercent:
        input.minPercent !== undefined
          ? clampPercent(input.minPercent, DEFAULT_MIN_PERCENT)
          : location.minPercent,
      fillPercent:
        input.fillPercent !== undefined ? clampPercent(input.fillPercent, 0) : location.fillPercent,
    },
    {
      stockMode: input.stockMode,
      capacity: input.capacity,
      stockQuantity: input.stockQuantity,
      minQuantity: input.minQuantity,
    },
  );

  const updated = await prisma.$transaction(async (tx) => {
    if (
      input.linhaCode !== undefined ||
      input.linhaName !== undefined ||
      input.linhaActive !== undefined ||
      face !== linha.face
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
          face,
        },
      });
    }

    const locationUpdated = await tx.location.update({
      where: { id: location.id },
      data: {
        corridor: layout.corridor,
        row:
          input.linhaCode !== undefined
            ? `${linha.coluna.code}-${normalizeCode(input.linhaCode)}`
            : layout.row,
        face,
        ...(input.barcode !== undefined
          ? { barcode: input.barcode.trim().toUpperCase() }
          : {}),
        proximityCorredorId: layout.proximityCorredorId,
        proximityEstanteId: layout.proximityEstanteId,
        proximityLinhaId: layout.proximityLinhaId,
        colunaId: layout.colunaId,
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.productId !== undefined || type === LocationType.PULMAO
          ? { productId }
          : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.minPercent !== undefined
          ? { minPercent: clampPercent(input.minPercent, DEFAULT_MIN_PERCENT) }
          : {}),
        ...(input.fillPercent !== undefined && type !== LocationType.PULMAO
          ? { fillPercent: clampPercent(input.fillPercent, 0) }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(modeData ?? {}),
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

/** Aplica o modo de ocupação (% ou quantidade) a todas as gôndolas de uma estante. */
export async function setEstanteStockMode(
  tenantId: string,
  estanteId: string,
  change: Pick<StockModeChange, "stockMode" | "capacity" | "minQuantity">,
) {
  if (change.stockMode !== "PERCENT" && change.stockMode !== "QUANTITY") {
    throw new Error("Escolha % ou quantidade");
  }
  const faces = await prisma.location.findMany({
    where: { tenantId, estanteId, type: LocationType.PICK_FACE },
  });
  if (faces.length === 0) throw new Error("Estante sem gôndolas");
  await prisma.$transaction(
    faces.flatMap((loc) => {
      const data = stockModeUpdateData(loc, change);
      return data ? [prisma.location.update({ where: { id: loc.id }, data })] : [];
    }),
  );
  return { updated: faces.length };
}
