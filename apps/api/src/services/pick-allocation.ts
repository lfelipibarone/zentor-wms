import { resolvePickFaceForProduct } from "./pick-face-resolve.js";

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
