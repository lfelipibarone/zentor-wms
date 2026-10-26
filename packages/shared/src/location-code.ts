import { productMatchesCode } from "./product-code.js";

/** QR/código lido da gôndola: ignora maiúsculas, espaços e traços tipográficos. */
export function normalizeScanCode(code: string): string {
  return code
    .replace(/\uFEFF/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\u2013\u2014]/g, "-");
}

export function locationBarcodeMatches(
  locationBarcode: string,
  scanned: string,
): boolean {
  return normalizeScanCode(locationBarcode) === normalizeScanCode(scanned);
}

/**
 * Etiqueta da gôndola: o endereço (barcode) ou o QR/SKU/EAN do produto
 * que está nela — o mesmo QR usado em Atualizar gôndola.
 */
export function gondolaScanMatches(opts: {
  locationBarcode: string;
  scanned: string;
  product?: {
    sku: string;
    barcode?: string | null;
    qrCode?: string | null;
  } | null;
}): boolean {
  if (locationBarcodeMatches(opts.locationBarcode, opts.scanned)) return true;
  if (opts.product && productMatchesCode(opts.product, opts.scanned)) return true;
  return false;
}
