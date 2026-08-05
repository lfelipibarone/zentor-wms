import type { OrderStatus, Product } from "@wms/shared";
import { clearStoredToken, getStoredToken } from "./auth";
import { getApiBaseUrl } from "./api-config";
import { notifySessionExpired } from "./session-events";

export { getApiBaseUrl } from "./api-config";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const token = await getStoredToken();
  const method = (options.method ?? "GET").toUpperCase();
  const needsJsonBody = ["POST", "PUT", "PATCH"].includes(method);
  const requestBody =
    options.body ?? (needsJsonBody ? JSON.stringify({}) : undefined);

  const res = await fetch(url, {
    ...options,
    method,
    body: requestBody,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await clearStoredToken();
    notifySessionExpired();
    throw new ApiError("Sessão expirada. Faça login novamente.", 401, body);
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : `Erro ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

// --- Tipos de resposta da API mobile ---

export interface QueueOrder {
  id: string;
  erpOrderId: string;
  priority: number;
  customerName: string | null;
  marketplace?: string | null;
  marketplaceLabel?: string;
  collectionDeadline: string | null;
  itemCount: number;
  totalUnits: number;
  returnedFromPacking?: boolean;
  resumingPicking?: boolean;
  issueSummary?: string | null;
  routeHint?: string | null;
  proximityNeighborCount?: number;
}

export interface ProximityGroupDto {
  id: string;
  orderIds: string[];
  routeHint: string;
  proximityScore: number;
  orders: Array<{
    id: string;
    erpOrderId: string;
    marketplace: string | null;
  }>;
}

export interface OrderQueueResponse {
  orders: QueueOrder[];
  proximityGroups: ProximityGroupDto[];
}

export interface PickLocationDto {
  id: string;
  corridor: string;
  row: string;
  barcode: string;
  label: string;
  currentQuantity?: number;
  capacity?: number;
  minThreshold?: number;
}

export interface PickingItemDto {
  id: string;
  lineNumber: number;
  quantityOrdered: number;
  quantityPicked: number;
  product: Product;
  pickLocation: PickLocationDto | null;
  completed: boolean;
}

export interface PickingSession {
  order: {
    id: string;
    erpOrderId: string;
    status: OrderStatus;
    marketplace?: string | null;
    marketplaceLabel?: string;
    basket: { id: string; code: string; barcode: string } | null;
    collectionDeadline: string | null;
  };
  items: PickingItemDto[];
  routeQueue?: Array<{
    id: string;
    lineNumber: number;
    pickLocation: PickLocationDto | null;
  }>;
  nextItem: {
    id: string;
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    remaining: number;
    product: Product;
    pickLocation: PickLocationDto | null;
    stockMismatchHint?: string | null;
  } | null;
  allPicked: boolean;
}

export interface AdjustLocationResult {
  location: {
    id: string;
    barcode: string;
    type: string;
    currentQuantity: number;
    capacity: number;
    label: string;
    product: { id: string; sku: string; name: string; barcode: string | null } | null;
  };
  previousQuantity: number;
  adjustmentDelta: number;
  reconciliation: {
    pulmaoOnly: boolean;
    orderItems: Array<{
      orderItemId: string;
      orderId: string;
      erpOrderId: string;
      oldLocationBarcode: string | null;
      newLocationBarcode: string;
    }>;
    waveLines: Array<{
      waveLineId: string;
      waveName: string;
      action: string;
      message?: string;
      newLocationBarcode: string | null;
    }>;
    warnings: string[];
    pickingSession?: Pick<
      PickingSession,
      "order" | "nextItem" | "routeQueue" | "allPicked"
    >;
  };
}

export interface LocationLookup {
  id: string;
  corridor: string;
  row: string;
  barcode: string;
  type: string;
  currentQuantity: number;
  capacity: number;
  minThreshold: number;
  label: string;
  product: Product | null;
  needsReplenishment: boolean;
}

export interface RequestReplenishmentResult {
  location: {
    id: string;
    barcode: string;
    label: string;
    currentQuantity: number;
    capacity: number;
    minThreshold: number;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
    } | null;
  };
  previousQuantity: number;
  countedQuantity: number;
  inputMode: "UNITS" | "PERCENT";
  inputValue: number;
  needsReplenishment: boolean;
  deficit: number;
  message: string;
}

export interface ReplenishmentNeed {
  id: string;
  pickFaceId: string;
  pickFaceBarcode: string;
  routeLabel: string;
  productId: string;
  sku: string;
  productName: string;
  imageUrl?: string | null;
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
  assignmentId?: string | null;
  assignedToId?: string | null;
  assignedToName?: string | null;
  assignmentStatus?: string | null;
  isMine?: boolean;
  canAccept?: boolean;
  canWork?: boolean;
}

export interface PickingIssueDetail {
  source: "PACKING" | "PAUSE";
  typeLabel: string;
  sku: string;
  productName: string | null;
  quantity: number;
  description: string | null;
  summary: string;
}

export interface ProblemOrder {
  id: string;
  erpOrderId: string;
  status: OrderStatus;
  priority: number;
  customerName: string | null;
  marketplaceLabel?: string;
  collectionDeadline: string | null;
  returnedFromPacking: boolean;
  pausedIssue: boolean;
  issueSummary: string | null;
  issueDetail: PickingIssueDetail | null;
  waveName: string | null;
  itemCount: number;
  totalUnits: number;
  qtyPicked: number;
}

export interface ProblemWaveOrder {
  id: string;
  erpOrderId: string;
  status: string;
  customerName: string | null;
  marketplaceLabel?: string;
  returnedFromPacking: boolean;
  pausedIssue: boolean;
  issueSummary: string | null;
  issueDetail: PickingIssueDetail | null;
}

export interface ProblemWave {
  id: string;
  name: string;
  problemOrders: ProblemWaveOrder[];
}

export interface ProductLocationOption {
  id: string;
  barcode: string;
  label: string;
  currentQuantity: number;
  capacity: number;
  isSuggested: boolean;
}

export interface CargoTransferSummary {
  id: string;
  status: string;
  quantity: number;
  withdrawnAt: string;
  depositedAt: string | null;
  durationSeconds: number;
  targetPickFaceId: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
    imageUrl?: string | null;
  };
  fromLocation: { id: string; barcode: string; label: string };
  toLocation: { id: string; barcode: string; label: string } | null;
  targetPickFace: { id: string; barcode: string; label: string } | null;
  withdrawnByName: string;
}

export const api = {
  getQueue: () => request<OrderQueueResponse>("/mobile/orders/queue"),

  getProblemOrders: () =>
    request<{ orders: ProblemOrder[] }>("/mobile/picking/problem-orders"),

  getProblemWaves: () =>
    request<{ waves: ProblemWave[] }>("/mobile/waves/problem-waves"),

  acceptOrder: (orderId: string) =>
    request<{ id: string; status: OrderStatus }>(
      `/mobile/orders/${orderId}/accept`,
      { method: "POST" }
    ),

  acceptOrdersBatch: (orderIds: string[]) =>
    request<{
      accepted: string[];
      errors: Array<{ orderId: string; message: string }>;
    }>("/mobile/orders/accept-batch", {
      method: "POST",
      body: JSON.stringify({ orderIds }),
    }),

  releaseOrderAccept: (orderId: string) =>
    request<{ released: boolean; status: OrderStatus }>(
      `/mobile/orders/${orderId}/release`,
      { method: "POST" },
    ),

  attachBasket: (orderId: string, basketBarcode: string) =>
    request<{ basketId: string; basketCode: string }>(
      `/mobile/orders/${orderId}/basket`,
      {
        method: "POST",
        body: JSON.stringify({ basketBarcode }),
      }
    ),

  getPickingSession: (orderId: string) =>
    request<PickingSession>(`/mobile/orders/${orderId}/picking`),

  validateLocation: (
    orderId: string,
    itemId: string,
    locationBarcode: string
  ) =>
    request<{ valid: boolean; location: string }>(
      `/mobile/orders/${orderId}/items/${itemId}/validate-location`,
      {
        method: "POST",
        body: JSON.stringify({ locationBarcode }),
      }
    ),

  pickItem: (orderId: string, itemId: string, quantity: number) =>
    request<{ quantityPicked: number; completed: boolean }>(
      `/mobile/orders/${orderId}/items/${itemId}/pick`,
      {
        method: "POST",
        body: JSON.stringify({ quantity }),
      }
    ),

  reportIssue: (orderId: string, reason: string) =>
    request<{ status: OrderStatus; notified: boolean }>(
      `/mobile/orders/${orderId}/report-issue`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      }
    ),

  completePicking: (orderId: string) =>
    request<{ status: OrderStatus }>(
      `/mobile/orders/${orderId}/complete-picking`,
      { method: "POST" }
    ),

  getLocationByBarcode: (barcode: string) =>
    request<LocationLookup>(
      `/mobile/locations/barcode/${encodeURIComponent(barcode)}`
    ),

  requestReplenishment: (
    barcode: string,
    inputMode: "UNITS" | "PERCENT",
    value: number,
  ) =>
    request<RequestReplenishmentResult>(
      `/mobile/locations/barcode/${encodeURIComponent(barcode)}/request-replenishment`,
      {
        method: "POST",
        body: JSON.stringify({ inputMode, value }),
      },
    ),

  replenishLocation: (
    locationId: string,
    quantity: number,
    productBarcode?: string
  ) =>
    request<{ currentQuantity: number; added: number }>(
      `/mobile/locations/${locationId}/replenish`,
      {
        method: "POST",
        body: JSON.stringify({ quantity, productBarcode }),
      }
    ),

  stockLocation: (
    locationId: string,
    productBarcode: string,
    quantity?: number
  ) =>
    request<{
      location: {
        id: string;
        currentQuantity: number;
        capacity: number;
        minThreshold: number;
        product: Product | null;
      };
      added: number;
      movementType: "ENTRY" | "REPLENISHMENT";
    }>(`/mobile/locations/${locationId}/stock`, {
      method: "POST",
      body: JSON.stringify({ productBarcode, quantity }),
    }),

  adjustLocationQuantity: (params: {
    locationId: string;
    countedQuantity: number;
    productBarcode?: string | null;
    reason?: string;
    orderId?: string;
    itemId?: string;
    waveLineId?: string;
  }) =>
    request<AdjustLocationResult>(
      `/mobile/locations/${params.locationId}/adjust-quantity`,
      {
        method: "POST",
        body: JSON.stringify({
          countedQuantity: params.countedQuantity,
          productBarcode: params.productBarcode ?? undefined,
          reason: params.reason,
          orderId: params.orderId,
          itemId: params.itemId,
          waveLineId: params.waveLineId,
        }),
      },
    ),

  transferReplenishment: (body: {
    fromLocationBarcode: string;
    toLocationBarcode: string;
    productBarcode: string;
    quantity: number;
  }) =>
    request<{
      fromLocation: { id: string; barcode: string; currentQuantity: number };
      toLocation: {
        id: string;
        barcode: string;
        currentQuantity: number;
        productId: string | null;
      };
      transferred: number;
    }>("/mobile/replenishment/transfer", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listReplenishmentNeeds: () =>
    request<{ needs: ReplenishmentNeed[]; myAssignmentCount: number }>(
      "/mobile/replenishment/needs",
    ),

  acceptReplenishmentNeed: (pickFaceId: string) =>
    request<{ assignmentId: string; pickFaceId: string; status: string }>(
      `/mobile/replenishment/needs/${pickFaceId}/accept`,
      { method: "POST" },
    ),

  releaseReplenishmentNeed: (pickFaceId: string) =>
    request<{ released: boolean }>(
      `/mobile/replenishment/needs/${pickFaceId}/release`,
      { method: "POST" },
    ),

  listProductLocations: (code: string, type: "PULMAO" | "PICK_FACE") =>
    request<{
      product: {
        id: string;
        sku: string;
        name: string;
        barcode: string | null;
        imageUrl?: string | null;
      };
      locations: ProductLocationOption[];
    }>(
      `/mobile/products/${encodeURIComponent(code)}/locations?type=${type}`,
    ),

  stockPulmao: (body: {
    locationBarcode: string;
    productBarcode: string;
    quantity: number;
  }) =>
    request<{ location: { barcode: string; currentQuantity: number }; added: number }>(
      "/mobile/locations/pulmao/stock",
      { method: "POST", body: JSON.stringify(body) },
    ),

  cancelCargoTransfer: (id: string) =>
    request<{ cancelled: boolean }>(`/mobile/cargo-transfers/${id}/cancel`, {
      method: "POST",
    }),

  withdrawCargoTransfer: (body: {
    fromLocationBarcode: string;
    productBarcode: string;
    quantity: number;
    targetPickFaceId?: string;
  }) =>
    request<{
      transfer: CargoTransferSummary;
      fromLocation: { barcode: string; currentQuantity: number };
    }>("/mobile/cargo-transfers/withdraw", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listPendingCargoTransfers: () =>
    request<{
      transfers: CargoTransferSummary[];
      allTransfers: CargoTransferSummary[];
    }>("/mobile/cargo-transfers/pending"),

  getCargoTransfer: (id: string) =>
    request<CargoTransferSummary>(`/mobile/cargo-transfers/${id}`),

  depositCargoTransfer: (
    id: string,
    body: {
      toLocationBarcode: string;
      productBarcode?: string;
      quantity?: number;
    },
  ) =>
    request<{
      transfer: CargoTransferSummary;
      toLocation: { barcode: string; currentQuantity: number };
    }>(`/mobile/cargo-transfers/${id}/deposit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getMobileConfig: () =>
    request<{ waveEnabled: boolean }>("/mobile/config"),

  getOpenWave: () =>
    request<{
      wave: {
        id: string;
        name: string;
        orderCount: number;
        lineCount: number;
      } | null;
    }>("/mobile/waves/open"),

  createWaveFromOrders: (orderIds: string[], appendToWaveId?: string) =>
    request<{
      waveId: string;
      orderCount: number;
      lineCount: number;
      waveCount?: number;
    }>("/mobile/waves/create-from-orders", {
      method: "POST",
      body: JSON.stringify({ orderIds, appendToWaveId }),
    }),

  listReleasedWaves: () =>
    request<{
      waves: Array<{
        id: string;
        name: string;
        releasedAt: string | null;
        orderCount: number;
        lineCount: number;
        acceptedById: string | null;
        acceptedByName: string | null;
        packingUrgency: number;
        collectionDeadline: string | null;
        marketplaces?: string[];
      }>;
    }>("/mobile/waves/released"),

  getWaveById: (waveId: string) =>
    request<{
      wave: {
        id: string;
        name: string;
        status: string;
        releasedAt: string | null;
        orderCount: number;
        gondolaPasses: number;
        acceptedById: string | null;
        acceptedByName: string | null;
        acceptedAt: string | null;
        canAccept: boolean;
        canWork: boolean;
        isMine: boolean;
        collectionDeadline: string | null;
        marketplaces?: string[];
      };
      lines: WaveLineSummary[];
    }>(`/mobile/waves/${waveId}`),

  acceptWave: (waveId: string) =>
    request<{ waveId: string; acceptedAt: string }>(
      `/mobile/waves/${waveId}/accept`,
      { method: "POST" },
    ),

  getCurrentWave: () =>
    request<{
      wave: {
        id: string;
        name: string;
        status: string;
        releasedAt: string | null;
        orderCount: number;
        gondolaPasses: number;
        acceptedById: string | null;
        acceptedByName: string | null;
        acceptedAt: string | null;
        canAccept: boolean;
        canWork: boolean;
        isMine: boolean;
        collectionDeadline: string | null;
        marketplaces?: string[];
      };
      lines: WaveLineSummary[];
    }>("/mobile/waves/current"),

  acceptCurrentWave: () =>
    request<{ waveId: string; acceptedAt: string }>(
      "/mobile/waves/current/accept",
      { method: "POST" },
    ),

  releaseWaveAccept: (waveId: string) =>
    request<{ released: boolean }>(
      `/mobile/waves/${waveId}/release`,
      { method: "POST" },
    ),

  releaseCurrentWaveAccept: () =>
    request<{ released: boolean }>("/mobile/waves/current/release", {
      method: "POST",
    }),

  getWaveLine: (lineId: string) =>
    request<{ line: WaveLineDetail }>(`/mobile/waves/lines/${lineId}`),

  waveLinePick: (
    lineId: string,
    body: {
      locationBarcode: string;
      productBarcode?: string;
      quantity: number;
    }
  ) =>
    request<{
      quantityPicked: number;
      quantityTotal: number;
      sortStatus: string;
      readyForSort: boolean;
    }>(`/mobile/waves/lines/${lineId}/pick`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  waveLineSort: (
    lineId: string,
    body: {
      allocationId: string;
      quantity: number;
      basketBarcode?: string;
    }
  ) =>
    request<{
      quantitySorted: number;
      allocationRemaining: number;
      lineSortStatus: string;
      basketCode: string | null;
    }>(`/mobile/waves/lines/${lineId}/sort`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getPurchaseReceiptQueue: () =>
    request<{ queue: PurchaseReceiptQueueItem[] }>(
      "/mobile/purchase-receipts/queue"
    ),

  startPurchaseReceipt: (barcode: string) =>
    request<PurchaseReceiptSessionDto>("/mobile/purchase-receipts/start", {
      method: "POST",
      body: JSON.stringify({ barcode }),
    }),

  getPurchaseReceiptSession: (sessionId: string) =>
    request<PurchaseReceiptSessionDto>(
      `/mobile/purchase-receipts/${sessionId}`
    ),

  scanPurchaseReceiptItem: (
    sessionId: string,
    barcode: string,
    quantity?: number
  ) =>
    request<PurchaseReceiptSessionDto>(
      `/mobile/purchase-receipts/${sessionId}/scan`,
      {
        method: "POST",
        body: JSON.stringify({ barcode, quantity }),
      }
    ),

  confirmPurchaseReceiptItem: (
    sessionId: string,
    itemId: string,
    quantity: number
  ) =>
    request<PurchaseReceiptSessionDto>(
      `/mobile/purchase-receipts/${sessionId}/confirm-item`,
      {
        method: "POST",
        body: JSON.stringify({ itemId, quantity }),
      }
    ),

  completePurchaseReceipt: (sessionId: string) =>
    request<PurchaseReceiptSessionDto>(
      `/mobile/purchase-receipts/${sessionId}/complete`,
      { method: "POST" }
    ),

  startReturnReceipt: (reference?: string) =>
    request<ReturnReceiptSessionDto>("/mobile/purchase-receipts/return/start", {
      method: "POST",
      body: JSON.stringify({ reference }),
    }),

  getReturnReceiptSession: (sessionId: string) =>
    request<ReturnReceiptSessionDto>(
      `/mobile/purchase-receipts/return/${sessionId}`,
    ),

  scanReturnReceiptProduct: (
    sessionId: string,
    barcode: string,
    quantity?: number,
  ) =>
    request<ReturnReceiptSessionDto>(
      `/mobile/purchase-receipts/return/${sessionId}/scan`,
      {
        method: "POST",
        body: JSON.stringify({ barcode, quantity }),
      },
    ),

  completeReturnReceipt: (
    sessionId: string,
    pulmaoLocationBarcode: string,
  ) =>
    request<ReturnReceiptSessionDto>(
      `/mobile/purchase-receipts/return/${sessionId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ pulmaoLocationBarcode }),
      },
    ),

  suggestCargoTransferFace: (transferId: string) =>
    request<{
      suggested: {
        barcode: string;
        corridor: string;
        row: string;
        label: string;
        currentQuantity: number;
        capacity: number;
      };
    }>(`/mobile/cargo-transfers/${transferId}/suggest-face`),

  markPurchaseReceiptConferenceStart: (sessionId: string) =>
    request<{ ok: boolean }>(
      `/mobile/purchase-receipts/${sessionId}/conference-start`,
      { method: "POST" }
    ),

  getPutawayQueue: () =>
    request<{ queue: PutawayQueueItem[] }>("/mobile/putaway/queue"),

  startPutaway: (purchaseReceiptId: string) =>
    request<PutawaySessionDto>("/mobile/putaway/start", {
      method: "POST",
      body: JSON.stringify({ purchaseReceiptId }),
    }),

  getPutawaySession: (sessionId: string) =>
    request<PutawaySessionDto>(`/mobile/putaway/${sessionId}`),

  storePutawayItem: (
    sessionId: string,
    body: {
      itemId: string;
      locationBarcode: string;
      productBarcode?: string;
      quantity?: number;
    }
  ) =>
    request<PutawaySessionDto>(`/mobile/putaway/${sessionId}/store`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  completePutaway: (sessionId: string) =>
    request<PutawaySessionDto>(`/mobile/putaway/${sessionId}/complete`, {
      method: "POST",
    }),
};

export interface PurchaseReceiptQueueItem {
  tinyNotaId: number;
  accessKey: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  issueDate: string | null;
  value: number | null;
}

export interface PutawayQueueItem {
  purchaseReceiptId: string;
  putawaySessionId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  completedAt: string | null;
  receiptOperator: string;
  itemCount: number;
  status: string;
}

export interface PutawaySessionDto {
  session: {
    id: string;
    purchaseReceiptId: string;
    status: string;
    startedAt: string | null;
  };
  items: Array<{
    id: string;
    productCode: string | null;
    description: string | null;
    barcode: string | null;
    quantityExpected: number;
    quantityStored: number;
    locationBarcode: string | null;
    completed: boolean;
  }>;
  nextItem: {
    id: string;
    productCode: string | null;
    description: string | null;
    barcode: string | null;
    imageUrl?: string | null;
    remaining: number;
  } | null;
  allStored: boolean;
}

export interface PurchaseReceiptSessionDto {
  session: {
    id: string;
    tinyNotaId: number;
    accessKey: string;
    invoiceNumber: string | null;
    supplierName: string | null;
    status: string;
    tinySyncStatus: string | null;
    tinySyncMessage: string | null;
  };
  items: Array<{
    id: string;
    lineNumber: number;
    productCode: string | null;
    description: string | null;
    barcode: string | null;
    quantityExpected: number;
    quantityChecked: number;
    completed: boolean;
  }>;
  nextItem: {
    id: string;
    lineNumber: number;
    productCode: string | null;
    description: string | null;
    barcode: string | null;
    quantityExpected: number;
    quantityChecked: number;
    remaining: number;
  } | null;
  allChecked: boolean;
}

export interface ReturnReceiptSessionDto {
  session: {
    id: string;
    kind: string;
    reference: string | null;
    status: string;
    startedAt: string;
  };
  items: Array<{
    id: string;
    lineNumber: number;
    productCode: string | null;
    description: string | null;
    barcode: string | null;
    quantityExpected: number;
    quantityChecked: number;
  }>;
  totalUnits: number;
  hasItems: boolean;
}

export interface WaveLineSummary {
  id: string;
  sortStatus: string;
  product: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
    imageUrl?: string | null;
  };
  pickLocation: {
    id: string;
    barcode: string;
    label: string;
    corridor: string;
    row: string;
    currentQuantity: number;
    capacity?: number;
    minThreshold?: number;
  };
  quantityTotal: number;
  quantityPicked: number;
  remaining: number;
  ordersCount: number;
  collectionDeadline: string | null;
  gondolaHint?: string;
  orders: Array<{
    orderId: string;
    erpOrderId: string;
    quantity: number;
    basketCode: string | null;
  }>;
}

export interface WaveLineDetail extends WaveLineSummary {
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
}
