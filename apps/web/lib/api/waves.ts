import { apiFetch } from "@/lib/api/client";

export interface WaveRow {
  id: string;
  name: string;
  status: string;
  releasedAt: string | null;
  releasedBy: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  orderCount: number;
  lineCount: number;
  createdAt: string;
}

export interface WavePreview {
  orderCount: number;
  lineCount: number;
  gondolaPasses: number;
  error?: string;
  orders: Array<{
    id: string;
    erpOrderId: string;
    priority: number;
    collectionDeadline: string | null;
    marketplace: string | null;
  }>;
  lines: Array<{
    productSku: string;
    productName: string;
    locationLabel: string;
    quantityTotal: number;
    orderCount: number;
  }>;
}

export function fetchWaves() {
  return apiFetch<{ waves: WaveRow[] }>("/api/waves");
}

export interface WaveDetail {
  id: string;
  name: string;
  status: string;
  releasedAt: string | null;
  updatedAt: string;
  lines: Array<{
    id: string;
    sku: string;
    productName: string;
    locationBarcode: string;
    quantityPicked: number;
    quantityTotal: number;
    sortStatus: string;
  }>;
  orders: Array<{
    id: string;
    erpOrderId: string;
    customerName: string | null;
    status: string;
  }>;
}

export function fetchWaveDetail(id: string) {
  return apiFetch<WaveDetail>(`/api/waves/${id}`);
}

export function fetchWavePreview() {
  return apiFetch<WavePreview>("/api/waves/preview");
}

export function releaseWave(body?: { orderIds?: string[]; auto?: boolean }) {
  return apiFetch<{
    waveId: string;
    orderCount: number;
    lineCount: number;
  }>("/api/waves/release", {
    method: "POST",
    body: JSON.stringify(body ?? { auto: true }),
  });
}

export function closeWave(waveId: string) {
  return apiFetch<{ ok: boolean }>(`/api/waves/${waveId}/close`, {
    method: "POST",
  });
}

export function patchOrder(
  id: string,
  body: {
    priority?: number;
    collectionDeadline?: string | null;
    marketplace?: string | null;
  },
) {
  return apiFetch<{ order: unknown }>(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
