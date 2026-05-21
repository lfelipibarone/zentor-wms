import { LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sortLocationsByRoute } from "./location-route.js";
import { PickFaceError } from "./pick-face-resolve.js";

export type PickSegment = {
  locationId: string;
  barcode: string;
  corridor: string;
  row: string;
  quantity: number;
  label: string;
};

function formatLocation(loc: { corridor: string; row: string; barcode: string }) {
  return `${loc.corridor}-${loc.row} · ${loc.barcode}`;
}

/**
 * Distribui quantidade entre gôndolas de giro (menor saldo primeiro na rota).
 * Se saldo total < necessário, completa na face de menor saldo e marca shortfall.
 */
export async function allocateQuantityAcrossPickFaces(
  productId: string,
  tenantId: string,
  quantityNeeded: number,
): Promise<{ segments: PickSegment[]; shortfall: number }> {
  const qty = Math.max(0, Math.floor(quantityNeeded));
  if (qty === 0) return { segments: [], shortfall: 0 };

  const locations = await prisma.location.findMany({
    where: {
      tenantId,
      type: LocationType.PICK_FACE,
      active: true,
      productId,
    },
  });

  if (locations.length === 0) {
    throw new PickFaceError(
      "Nenhum endereço de estoque de giro ativo para este produto.",
    );
  }

  const sorted = sortLocationsByRoute(
    [...locations].sort((a, b) => a.currentQuantity - b.currentQuantity),
  );

  const segments: PickSegment[] = [];
  let remaining = qty;
  let totalAvailable = 0;

  for (const loc of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(loc.currentQuantity, remaining);
    if (take <= 0) continue;
    totalAvailable += loc.currentQuantity;
    segments.push({
      locationId: loc.id,
      barcode: loc.barcode,
      corridor: loc.corridor,
      row: loc.row,
      quantity: take,
      label: formatLocation(loc),
    });
    remaining -= take;
  }

  if (remaining > 0) {
    const fallback = sorted[0]!;
    const existing = segments.find((s) => s.locationId === fallback.id);
    if (existing) {
      existing.quantity += remaining;
    } else {
      segments.push({
        locationId: fallback.id,
        barcode: fallback.barcode,
        corridor: fallback.corridor,
        row: fallback.row,
        quantity: remaining,
        label: formatLocation(fallback),
      });
    }
    const shortfall = Math.max(0, qty - totalAvailable);
    return { segments, shortfall };
  }

  return { segments, shortfall: 0 };
}

export function buildMultiGondolaHint(segments: PickSegment[]): string | null {
  if (segments.length <= 1) return null;
  return segments
    .map((s) => `${s.quantity} un. em ${s.corridor}-${s.row}`)
    .join(" · ");
}
