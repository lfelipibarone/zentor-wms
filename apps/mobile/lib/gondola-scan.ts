import { productMatchesCode } from "@wms/shared";

function normalizeScanCode(code: string): string {
  return code
    .replace(/\uFEFF/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\u2013\u2014]/g, "-");
}

/** Endereço da gôndola ou QR/SKU/EAN do produto que está nela. */
export function gondolaScanMatches(opts: {
  locationBarcode: string;
  scanned: string;
  product?: {
    sku: string;
    barcode?: string | null;
    qrCode?: string | null;
  } | null;
}): boolean {
  if (normalizeScanCode(opts.locationBarcode) === normalizeScanCode(opts.scanned)) {
    return true;
  }
  return Boolean(opts.product && productMatchesCode(opts.product, opts.scanned));
}
