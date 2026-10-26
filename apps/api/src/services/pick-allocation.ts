import type { Location } from "@prisma/client";
import {
  PickFaceError,
  resolvePickFaceForProduct,
} from "./pick-face-resolve.js";

export type PickSegment = {
  locationId: string;
  barcode: string;
  corridor: string;
  row: string;
  quantity: number;
  label: string;
};

function formatLocation(loc: { barcode: string }) {
  return loc.barcode;
}

/**
 * Gôndola de onde sai a quantidade do pedido. O estoque da gôndola é controlado em %, então
 * não há como dividir unidades entre gôndolas: tudo sai da gôndola escolhida para pick.
 */
export async function allocateQuantityAcrossPickFaces(
  productId: string,
  tenantId: string,
  quantityNeeded: number,
): Promise<{ segments: PickSegment[] }> {
  const qty = Math.max(0, Math.floor(quantityNeeded));
  if (qty === 0) return { segments: [] };
  const loc = await resolvePickFaceForProduct(productId, tenantId, "pick");
  return {
    segments: [
      {
        locationId: loc.id,
        barcode: loc.barcode,
        corridor: loc.corridor,
        row: loc.row,
        quantity: qty,
        label: formatLocation(loc),
      },
    ],
  };
}

export function buildMultiGondolaHint(segments: PickSegment[]): string | null {
  if (segments.length <= 1) return null;
  return segments
    .map((s) => `${s.quantity} un. em ${s.barcode}`)
    .join(" · ");
}

/** Gôndola atual do produto, sem gravar no pedido. */
export async function resolveCurrentPickFace(
  tenantId: string,
  productId: string | null | undefined,
): Promise<Location | null> {
  if (!productId) return null;
  try {
    return await resolvePickFaceForProduct(productId, tenantId, "pick");
  } catch (e) {
    if (e instanceof PickFaceError) return null;
    throw e;
  }
}

/**
 * Endereço para exibir/validar no picking avulso: usa a gôndola já ligada ao
 * item (onda) ou, se não houver, a pick face atual do produto — sem persistir.
 */
export async function displayPickLocationForItems<
  T extends { id: string; productId: string | null; pickLocation: Location | null },
>(tenantId: string, items: T[]): Promise<Map<string, Location>> {
  const byItem = new Map<string, Location>();
  const byProduct = new Map<string, Location | null>();

  for (const item of items) {
    if (item.pickLocation) {
      byItem.set(item.id, item.pickLocation);
      continue;
    }
    if (!item.productId) continue;
    if (!byProduct.has(item.productId)) {
      byProduct.set(
        item.productId,
        await resolveCurrentPickFace(tenantId, item.productId),
      );
    }
    const loc = byProduct.get(item.productId);
    if (loc) byItem.set(item.id, loc);
  }

  return byItem;
}
