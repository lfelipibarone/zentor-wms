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
  const res = await fetch(url, {
    ...options,
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
  itemCount: number;
  totalUnits: number;
}

export interface PickLocationDto {
  id: string;
  corridor: string;
  row: string;
  barcode: string;
  label: string;
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
    basket: { id: string; code: string; barcode: string } | null;
  };
  items: PickingItemDto[];
  nextItem: {
    id: string;
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    remaining: number;
    product: Product;
    pickLocation: PickLocationDto | null;
  } | null;
  allPicked: boolean;
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

export const api = {
  getQueue: () => request<QueueOrder[]>("/mobile/orders/queue"),

  acceptOrder: (orderId: string) =>
    request<{ id: string; status: OrderStatus }>(
      `/mobile/orders/${orderId}/accept`,
      { method: "POST" }
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

  getMobileConfig: () =>
    request<{ waveEnabled: boolean }>("/mobile/config"),

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
      };
      lines: WaveLineSummary[];
    }>("/mobile/waves/current"),

  acceptCurrentWave: () =>
    request<{ waveId: string; acceptedAt: string }>(
      "/mobile/waves/current/accept",
      { method: "POST" }
    ),

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
};

export interface WaveLineSummary {
  id: string;
  sortStatus: string;
  product: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
  };
  pickLocation: {
    id: string;
    barcode: string;
    label: string;
    corridor: string;
    row: string;
    currentQuantity: number;
  };
  quantityTotal: number;
  quantityPicked: number;
  remaining: number;
  ordersCount: number;
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
