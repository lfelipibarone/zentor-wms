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

export type WavePartitionStrategy = "SINGLE_ITEM" | "PROXIMITY" | "BY_PRODUCT";

export interface WavePreview {
  orderCount: number;
  lineCount: number;
  gondolaPasses: number;
  waveCount?: number;
  partitionStrategy?: WavePartitionStrategy;
  marketplace?: string | null;
  excludedOrderIds?: string[];
  excludedOrderDetails?: Array<{
    orderId: string;
    reason: "too_many_skus" | "no_link" | "below_min_wave" | "not_single_item";
  }>;
  proximityGroups?: Array<{
    id: string;
    orderIds: string[];
    routeHint: string;
    proximityScore: number;
  }>;
  waves?: Array<{
    index: number;
    orderCount: number;
    lineCount: number;
    gondolaPasses: number;
    orderIds: string[];
    orders: WavePreview["orders"];
    lines: WavePreview["lines"];
  }>;
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
    marketplace: string | null;
  }>;
}

export interface OpenWaveSummary {
  id: string;
  name: string;
  releasedAt: string | null;
  orderCount: number;
  lineCount: number;
}

export function fetchWaveDetail(id: string) {
  return apiFetch<WaveDetail>(`/api/waves/${id}`);
}

export function fetchWavePreview(opts?: {
  orderIds?: string[];
  marketplace?: string;
  partitionStrategy?: WavePartitionStrategy;
}) {
  return apiFetch<WavePreview>("/api/waves/preview", {
    method: "POST",
    body: JSON.stringify({
      orderIds: opts?.orderIds,
      marketplace: opts?.marketplace,
      partitionStrategy: opts?.partitionStrategy,
    }),
  });
}

export interface WaveSchedule {
  dayOfWeek: number;
  time: string;
}

export interface WaveSettings {
  enabled: boolean;
  autoReleaseEnabled: boolean;
  autoReleaseTime: string;
  autoReleaseSchedules: WaveSchedule[];
  autoReleaseMaxOrders: number;
  onlyDeadlineToday: boolean;
  partitionEnabled: boolean;
  minOrdersPerWave: number;
  maxWavesPerBatch: number;
  defaultPartitionStrategy: WavePartitionStrategy;
  proximityMaxDistance: number;
  autoReleaseMarketplace: string | null;
}

export interface WaveSettingMetaItem {
  key: string;
  label: string;
  description: string;
}

export interface WaveSettingsResponse {
  settings: WaveSettings;
  meta: WaveSettingMetaItem[];
}

export function fetchWaveSettings() {
  return apiFetch<WaveSettingsResponse>("/api/waves/settings");
}

export function updateWaveSettings(payload: Partial<WaveSettings>) {
  return apiFetch<WaveSettingsResponse>("/api/waves/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchOpenWave() {
  return apiFetch<{ wave: OpenWaveSummary | null }>("/api/waves/open");
}

export function addOrdersToWave(waveId: string, orderIds: string[]) {
  return apiFetch<{ ok: boolean; added: number; lineCount: number }>(
    `/api/waves/${waveId}/orders`,
    {
      method: "POST",
      body: JSON.stringify({ orderIds }),
    },
  );
}

export function removeOrderFromWave(waveId: string, orderId: string) {
  return apiFetch<{ ok: boolean }>(`/api/waves/${waveId}/orders/${orderId}`, {
    method: "DELETE",
  });
}

export function releaseWave(body?: {
  orderIds?: string[];
  auto?: boolean;
  appendToWaveId?: string;
  marketplace?: string;
  partitionStrategy?: WavePartitionStrategy;
}) {
  return apiFetch<{
    waveId: string;
    orderCount: number;
    lineCount: number;
    waveCount?: number;
    waves?: Array<{ waveId: string; orderCount: number; lineCount: number; name: string }>;
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
