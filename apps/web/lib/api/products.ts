import { apiFetch } from "./client";
import type { PaginationMeta } from "@/lib/pagination";

export type ProductMissingFilter = "location" | "image" | "barcode";
export type ProductLocationType = "PICK_FACE" | "PULMAO";

export interface ProductLocationSummary {
  id: string;
  barcode: string;
  type: ProductLocationType;
  currentQuantity: number;
}

export interface ProductLocationDetail extends ProductLocationSummary {
  face: "A" | "B";
  capacity: number;
  minThreshold: number;
  active: boolean;
  barracao: { code: string; name: string } | null;
}

export interface ProductBase {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  qrCode: string | null;
  imageUrl: string | null;
  unit: string | null;
  weight: string | null;
  active: boolean;
  requiresItemScan: boolean;
  supplierName: string | null;
  erpStockQuantity: string | null;
}

export interface ProductListItem extends ProductBase {
  locations: ProductLocationSummary[];
}

export interface ProductDetail extends ProductBase {
  locations: ProductLocationDetail[];
}

export interface LocationOption {
  id: string;
  barcode: string;
  type: ProductLocationType;
  currentQuantity: number;
  active: boolean;
  product: { sku: string; name: string } | null;
}

export function fetchProducts(params: {
  q?: string;
  missing?: ProductMissingFilter;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.missing) sp.set("missing", params.missing);
  sp.set("page", String(params.page ?? 1));
  sp.set("pageSize", String(params.pageSize ?? 20));
  return apiFetch<{ products: ProductListItem[]; pagination: PaginationMeta }>(
    `/api/products?${sp.toString()}`,
  );
}

export function fetchProduct(id: string) {
  return apiFetch<{ product: ProductDetail }>(`/api/products/${id}`);
}

export function setProductQrCode(id: string, qrCode: string | null) {
  return apiFetch<{ product: ProductBase }>(`/api/products/${id}/qr-code`, {
    method: "PUT",
    body: JSON.stringify({ qrCode }),
  });
}

export function assignProductLocation(id: string, locationId: string, replace = false) {
  return apiFetch<{ location: ProductLocationDetail; resumedOrderIds: string[] }>(
    `/api/products/${id}/locations`,
    { method: "POST", body: JSON.stringify({ locationId, replace }) },
  );
}

export function unassignProductLocation(id: string, locationId: string) {
  return apiFetch<{ ok: boolean }>(`/api/products/${id}/locations/${locationId}`, {
    method: "DELETE",
  });
}

export function searchLocations(q: string) {
  const sp = new URLSearchParams({ q, page: "1", pageSize: "10" });
  return apiFetch<{ locations: LocationOption[] }>(`/api/locations?${sp.toString()}`);
}
