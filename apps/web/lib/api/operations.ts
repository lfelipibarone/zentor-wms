import { apiFetch } from "@/lib/api/client";
import type { PaginationMeta } from "@/lib/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  requiresItemScan: boolean;
  active: boolean;
}

export interface OrderRow {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: string;
  priority: number;
  pickerName: string | null;
  basketCode: string | null;
  itemCount: number;
  qtyOrdered: number;
  qtyPicked: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocationRow {
  id: string;
  corridor: string;
  row: string;
  barcode: string;
  type: string;
  productId: string | null;
  currentQuantity: number;
  capacity: number;
  minThreshold: number;
  active: boolean;
  product?: { sku: string; name: string } | null;
}

export function searchAll(q: string) {
  return apiFetch<{
    products: Array<{ id: string; sku: string; name: string; barcode: string | null }>;
    orders: Array<{
      id: string;
      erpOrderId: string;
      customerName: string | null;
      status: string;
      itemCount: number;
      createdAt: string;
    }>;
    locations: Array<{
      id: string;
      barcode: string;
      corridor: string;
      row: string;
      type: string;
      currentQuantity: number;
      productSku: string | null;
      productName: string | null;
    }>;
  }>(`/api/search?q=${encodeURIComponent(q)}`);
}

export function fetchProducts(q?: string, page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ products: ProductRow[]; pagination: PaginationMeta }>(
    `/api/products?${sp}`,
  );
}

export function fetchOrders(params?: {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  if (params?.page) sp.set("page", String(params.page));
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ orders: OrderRow[]; pagination: PaginationMeta }>(
    `/api/orders?${sp}`,
  );
}

export function fetchLocations(q?: string, page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ locations: LocationRow[]; pagination: PaginationMeta }>(
    `/api/locations?${sp}`,
  );
}

export function fetchBaskets(page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    baskets: Array<{
      id: string;
      code: string;
      barcode: string;
      active: boolean;
      ordersInUse: number;
    }>;
    pagination: PaginationMeta;
  }>(`/api/baskets?${sp}`);
}

export function fetchStockLocations(
  q?: string,
  lowOnly?: boolean,
  page?: number,
  pageSize?: number,
) {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (lowOnly) sp.set("lowOnly", "true");
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ locations: LocationRow[]; pagination: PaginationMeta }>(
    `/api/stock/locations?${sp}`,
  );
}

export function fetchMovements(page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    movements: Array<{
      id: string;
      type: string;
      quantity: number;
      createdAt: string;
      reference: string | null;
      product: { sku: string; name: string };
      user: { name: string };
      fromLocation: { barcode: string } | null;
      toLocation: { barcode: string } | null;
      order: { erpOrderId: string } | null;
    }>;
    pagination: PaginationMeta;
  }>(`/api/stock/movements?${sp}`);
}

export function fetchReceipts(page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    receipts: Array<{
      id: string;
      quantity: number;
      createdAt: string;
      reference: string | null;
      notes: string | null;
      product: { sku: string; name: string };
      user: { name: string };
      toLocation: { barcode: string; corridor: string; row: string };
    }>;
    pagination: PaginationMeta;
  }>(`/api/receipts?${sp}`);
}

export function fetchShippingQueue(page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    orders: Array<{
      id: string;
      erpOrderId: string;
      customerName: string | null;
      status: string;
      basket: { code: string } | null;
      assignedPicker: { name: string } | null;
      items: Array<{
        lineNumber: number;
        quantityOrdered: number;
        quantityPicked: number;
        product: { sku: string; name: string };
      }>;
      updatedAt: string;
    }>;
    pagination: PaginationMeta;
  }>(`/api/shipping/queue?${sp}`);
}

export {
  defaultReportPeriod,
  fetchReportData,
  fetchReportTypes,
} from "@/lib/api/reports";
export type { ReportId, ReportResult, ReportTypeMeta } from "@/lib/api/reports";
