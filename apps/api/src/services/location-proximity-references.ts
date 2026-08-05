import { randomUUID } from "node:crypto";
import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type ProximityReferenceInput = {
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
};

export type ProximityReferenceRow = {
  proximityCorredorId: string | null;
  proximityEstanteId: string | null;
  proximityLinhaId: string | null;
};

export const proximityReferenceSelect = {
  proximityCorredorId: true,
  proximityEstanteId: true,
  proximityLinhaId: true,
} as const;

export function isEmptyProximityReference(ref: ProximityReferenceInput): boolean {
  return !(
    ref.proximityCorredorId?.trim() ||
    ref.proximityEstanteId?.trim() ||
    ref.proximityLinhaId?.trim()
  );
}

export function normalizeProximityReferences(
  refs: ProximityReferenceInput[] | undefined,
  legacy?: ProximityReferenceInput,
): ProximityReferenceInput[] {
  const list =
    refs
      ?.map((ref) => ({
        proximityCorredorId: ref.proximityCorredorId?.trim() || null,
        proximityEstanteId: ref.proximityEstanteId?.trim() || null,
        proximityLinhaId: ref.proximityLinhaId?.trim() || null,
      }))
      .filter((ref) => !isEmptyProximityReference(ref)) ?? [];

  if (list.length > 0) return list;

  if (!legacy || isEmptyProximityReference(legacy)) return [];

  return [
    {
      proximityCorredorId: legacy.proximityCorredorId?.trim() || null,
      proximityEstanteId: legacy.proximityEstanteId?.trim() || null,
      proximityLinhaId: legacy.proximityLinhaId?.trim() || null,
    },
  ];
}

export function primaryProximityReference(
  refs: ProximityReferenceInput[],
): ProximityReferenceInput {
  return (
    refs[0] ?? {
      proximityCorredorId: null,
      proximityEstanteId: null,
      proximityLinhaId: null,
    }
  );
}

export async function validateProximityReferences(
  tenantId: string,
  refs: ProximityReferenceInput[],
  ownLinhaId?: string | null,
): Promise<void> {
  for (const ref of refs) {
    if (ref.proximityCorredorId) {
      const corredor = await prisma.warehouseCorredor.findFirst({
        where: { id: ref.proximityCorredorId, tenantId },
      });
      if (!corredor) throw new Error("Corredor de proximidade inválido");
    }
    if (ref.proximityEstanteId) {
      const estante = await prisma.warehouseEstante.findFirst({
        where: { id: ref.proximityEstanteId, tenantId },
      });
      if (!estante) throw new Error("Estante de proximidade inválida");
    }
    if (ref.proximityLinhaId) {
      const linha = await prisma.warehouseLinha.findFirst({
        where: { id: ref.proximityLinhaId, tenantId },
      });
      if (!linha) throw new Error("Linha de proximidade inválida");
      if (ownLinhaId && linha.id === ownLinhaId) {
        throw new Error("Linha de proximidade não pode ser a própria posição");
      }
    }
  }
}

type ProximityReferenceDbRow = ProximityReferenceRow & { locationId: string };

async function deleteLocationProximityReferences(
  client: PrismaTypes.TransactionClient | typeof prisma,
  tenantId: string,
  locationId: string,
): Promise<void> {
  await client.$executeRaw`
    DELETE FROM location_proximity_references
    WHERE "locationId" = ${locationId} AND "tenantId" = ${tenantId}
  `;
}

async function insertLocationProximityReferences(
  client: PrismaTypes.TransactionClient | typeof prisma,
  tenantId: string,
  locationId: string,
  refs: ProximityReferenceInput[],
): Promise<void> {
  for (let sortOrder = 0; sortOrder < refs.length; sortOrder++) {
    const ref = refs[sortOrder]!;
    await client.$executeRaw`
      INSERT INTO location_proximity_references (
        id,
        "tenantId",
        "locationId",
        "sortOrder",
        "proximityCorredorId",
        "proximityEstanteId",
        "proximityLinhaId",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${randomUUID()},
        ${tenantId},
        ${locationId},
        ${sortOrder},
        ${ref.proximityCorredorId || null},
        ${ref.proximityEstanteId || null},
        ${ref.proximityLinhaId || null},
        NOW(),
        NOW()
      )
    `;
  }
}

export async function replaceLocationProximityReferences(
  tx: PrismaTypes.TransactionClient,
  tenantId: string,
  locationId: string,
  refs: ProximityReferenceInput[],
): Promise<void> {
  await deleteLocationProximityReferences(tx, tenantId, locationId);
  if (refs.length === 0) return;
  await insertLocationProximityReferences(tx, tenantId, locationId, refs);
}

export async function listLocationProximityReferences(
  locationId: string,
): Promise<ProximityReferenceRow[]> {
  return prisma.$queryRaw<ProximityReferenceRow[]>`
    SELECT
      "proximityCorredorId",
      "proximityEstanteId",
      "proximityLinhaId"
    FROM location_proximity_references
    WHERE "locationId" = ${locationId}
    ORDER BY "sortOrder" ASC
  `;
}

export async function listLocationProximityReferencesByLocationIds(
  locationIds: string[],
): Promise<Map<string, ProximityReferenceRow[]>> {
  const result = new Map<string, ProximityReferenceRow[]>();
  if (locationIds.length === 0) return result;

  const rows = await prisma.$queryRaw<ProximityReferenceDbRow[]>`
    SELECT
      "locationId",
      "proximityCorredorId",
      "proximityEstanteId",
      "proximityLinhaId"
    FROM location_proximity_references
    WHERE "locationId" IN (${Prisma.join(locationIds)})
    ORDER BY "sortOrder" ASC
  `;

  for (const row of rows) {
    const list = result.get(row.locationId) ?? [];
    list.push({
      proximityCorredorId: row.proximityCorredorId,
      proximityEstanteId: row.proximityEstanteId,
      proximityLinhaId: row.proximityLinhaId,
    });
    result.set(row.locationId, list);
  }

  return result;
}
