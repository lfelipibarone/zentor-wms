/** O QR das etiquetas de produto é o próprio SKU; a caixa de fábrica traz o EAN. */
export function productMatchesCode(
  product: { sku: string; barcode?: string | null },
  code: string | null | undefined,
): boolean {
  const scanned = code?.trim().toUpperCase();
  if (!scanned) return false;
  return (
    product.sku.trim().toUpperCase() === scanned ||
    product.barcode?.trim().toUpperCase() === scanned
  );
}
