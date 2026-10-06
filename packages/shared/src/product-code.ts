/** QR da etiqueta: o SKU, ou o código cadastrado em `qrCode`. A caixa de fábrica traz o EAN. */
export function productMatchesCode(
  product: { sku: string; barcode?: string | null; qrCode?: string | null },
  code: string | null | undefined,
): boolean {
  const scanned = code?.trim().toUpperCase();
  if (!scanned) return false;
  return [product.sku, product.barcode, product.qrCode].some(
    (c) => c?.trim().toUpperCase() === scanned,
  );
}

/** Conteúdo que a etiqueta de QR do produto deve ter. */
export function productQrValue(product: { sku: string; qrCode?: string | null }): string {
  return product.qrCode?.trim() || product.sku;
}
