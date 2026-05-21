import { apiFetch } from "@/lib/api/client";
import type { PaginationMeta } from "@/lib/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  imageUrl?: string | null;
  unit?: string | null;
  weight?: string | number | null;
  requiresItemScan: boolean;
  active: boolean;
}

export interface OrderRow {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: string;
  priority: number;
  collectionDeadline: string | null;
  marketplace: string | null;
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
  product?: {
    sku: string;
    name: string;
    unit?: string | null;
    weight?: string | number | null;
  } | null;
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

export type BoardKind = "all" | "order" | "wave";

export type BoardOrderEntry = OrderRow & { kind: "order" };

export interface BoardWaveEntry {
  kind: "wave";
  id: string;
  name: string;
  status: string;
  orderCount: number;
  lineCount: number;
  qtyPicked: number;
  qtyTotal: number;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BoardEntry = BoardOrderEntry | BoardWaveEntry;

export interface BoardCounts {
  pending: number;
  picking: number;
  paused: number;
  separated: number;
  dispatching: number;
  waves: number;
  all: number;
}

export function fetchOrdersBoard(params?: {
  kind?: BoardKind;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.kind) sp.set("kind", params.kind);
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  if (params?.page) sp.set("page", String(params.page));
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    entries: BoardEntry[];
    pagination: PaginationMeta;
    counts: BoardCounts;
  }>(`/api/orders/board?${sp}`);
}

export interface OrderDetail {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: string;
  priority: number;
  collectionDeadline: string | null;
  marketplace: string | null;
  pickerName: string | null;
  basketCode: string | null;
  updatedAt: string;
  items: Array<{
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    product: { sku: string; name: string };
  }>;
}

export function fetchOrderDetail(id: string) {
  return apiFetch<OrderDetail>(`/api/orders/${id}`);
}

export function fetchLocations(
  q?: string,
  page?: number,
  pageSize?: number,
  type?: "PULMAO" | "PICK_FACE",
) {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (type) sp.set("type", type);
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
  type?: "PULMAO" | "PICK_FACE",
) {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (lowOnly) sp.set("lowOnly", "true");
  if (type) sp.set("type", type);
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ locations: LocationRow[]; pagination: PaginationMeta }>(
    `/api/stock/locations?${sp}`,
  );
}

export function fetchMovements(
  page?: number,
  pageSize?: number,
  locationType?: "PULMAO" | "PICK_FACE",
) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  if (locationType) sp.set("type", locationType);
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    movements: Array<{
      id: string;
      type: string;
      quantity: number;
      createdAt: string;
      reference: string | null;
      notes: string | null;
      product: { sku: string; name: string };
      userName: string;
      fromLocation: { barcode: string; type?: string } | null;
      toLocation: { barcode: string; type?: string } | null;
      orderErpId: string | null;
      purchaseReceiptSessionId: string | null;
      putawaySessionId: string | null;
      pickWaveLineId: string | null;
      cargoTransferId: string | null;
      startedAt: string | null;
      completedAt: string | null;
      durationSeconds: number | null;
      cargoTransfer: {
        id: string;
        status: string;
        withdrawnByName: string;
        depositedByName: string | null;
      } | null;
    }>;
    pagination: PaginationMeta;
  }>(`/api/stock/movements?${sp}`);
}

export function fetchPurchaseReceipts(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  kind?: "ENTRY" | "RETURN";
}) {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.status) sp.set("status", params.status);
  if (params?.kind) sp.set("kind", params.kind);
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    sessions: Array<{
      id: string;
      kind: string;
      reference: string | null;
      tinyNotaId: number | null;
      accessKey: string;
      invoiceNumber: string | null;
      supplierName: string | null;
      status: string;
      tinySyncStatus: string | null;
      operatorName: string;
      startedAt: string;
      conferenceStartedAt: string | null;
      conferenceEndedAt: string | null;
      completedAt: string | null;
      receiptDurationMs: number | null;
      conferenceDurationMs: number | null;
      itemCount: number;
      itemsChecked: number;
      putaway: {
        status: string;
        operatorName: string | null;
        startedAt: string | null;
        completedAt: string | null;
        durationMs: number | null;
      } | null;
    }>;
    pagination: PaginationMeta;
  }>(`/api/purchase-receipts?${sp}`);
}

export function fetchPurchaseReceiptDetail(id: string) {
  return apiFetch<{
    id: string;
    invoiceNumber: string | null;
    supplierName: string | null;
    accessKey: string;
    status: string;
    operatorName: string;
    items: Array<{
      lineNumber: number;
      productCode: string | null;
      description: string | null;
      quantityExpected: number;
      quantityChecked: number;
    }>;
    timeLogs: Array<{ event: string; at: string; userName: string }>;
    putaway: unknown;
  }>(`/api/purchase-receipts/${id}`);
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

export type PickSegmentDto = {
  locationId: string;
  barcode: string;
  corridor: string;
  row: string;
  quantity: number;
  label: string;
};

export interface PackingOrder {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: string;
  priority?: number;
  collectionDeadline?: string | null;
  packingUrgency?: number;
  routeLabel?: string | null;
  basket: { id: string; code: string; barcode: string } | null;
  assignedPicker: { name: string } | null;
  allPacked: boolean;
  packingInProgress?: boolean;
  packingOperatorName?: string | null;
  items: Array<{
    id: string;
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    quantityPacked: number;
    remaining: number;
    pickSegments?: PickSegmentDto[];
    multiGondolaHint?: string | null;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
      imageUrl?: string | null;
      unit?: string | null;
      weight?: string | number | null;
    };
  }>;
}

export type PackingWaveLineSummary = {
  id: string;
  waveId: string;
  waveName: string;
  waveReleasedAt?: string | null;
  waveUrgency?: number;
  collectionDeadline?: string | null;
  sku: string;
  productName: string;
  locationBarcode: string;
  routeLabel?: string;
  quantityPicked: number;
  quantityTotal: number;
  sortStatus: string;
};

export type ReplenishmentNeedSummary = {
  id: string;
  pickFaceId: string;
  pickFaceBarcode: string;
  routeLabel: string;
  productId: string;
  sku: string;
  productName: string;
  currentQuantity: number;
  minThreshold: number;
  capacity: number;
  deficit: number;
  suggestedPulmao: {
    id: string;
    barcode: string;
    label: string;
    currentQuantity: number;
  } | null;
};

export type PackingQueueItem =
  | { kind: "wave_line"; sortKey: number; line: PackingWaveLineSummary }
  | { kind: "order"; sortKey: number; order: PackingOrder }
  | { kind: "replenishment"; sortKey: number; need: ReplenishmentNeedSummary };

export function scanPackingBasket(barcode: string) {
  return apiFetch<{ order: PackingOrder }>("/api/packing/baskets/scan", {
    method: "POST",
    body: JSON.stringify({ barcode }),
  });
}

export function fetchPackingQueue() {
  return apiFetch<{ orders: PackingOrder[] }>("/api/packing/orders/queue");
}

export function fetchUnifiedPackingQueue() {
  return apiFetch<{ items: PackingQueueItem[] }>("/api/packing/queue/unified");
}

export function searchPackingOrder(q: string) {
  return apiFetch<{ order: PackingOrder }>(
    `/api/packing/orders/search?q=${encodeURIComponent(q)}`,
  );
}

export function fetchPackingSession(orderId: string) {
  return apiFetch<PackingOrder>(`/api/packing/orders/${orderId}`);
}

export function confirmPackingItem(
  orderId: string,
  itemId: string,
  quantity: number,
) {
  return apiFetch<PackingOrder>(`/api/packing/orders/${orderId}/confirm-item`, {
    method: "POST",
    body: JSON.stringify({ itemId, quantity }),
  });
}

export function fetchWavePackingLines() {
  return apiFetch<{
    lines: Array<{
      id: string;
      waveId: string;
      waveName: string;
      sku: string;
      productName: string;
      locationBarcode: string;
      quantityPicked: number;
      quantityTotal: number;
      sortStatus: string;
    }>;
  }>("/api/packing/waves/lines");
}

export function fetchWavePackingLine(lineId: string) {
  return apiFetch<{
    collectionDeadline: string | null;
    line: {
      id: string;
      waveId: string;
      waveName: string;
      product: { sku: string; name: string };
      quantityPicked: number;
      quantityTotal: number;
      sortStatus: string;
      allocations: Array<{
        id: string;
        quantity: number;
        quantitySorted: number;
        remaining: number;
        order: {
          id: string;
          erpOrderId: string;
          priority: number;
          basketCode: string | null;
          basketId: string | null;
        };
      }>;
    };
  }>(`/api/packing/waves/lines/${lineId}`);
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
