/** Contratos dos endpoints consolidados GET /api/dashboard/productivity */

export interface DashboardKpis {
  awaitingPicking: number;
  awaitingConference: number;
  readyToShip: number;
  deltaPicking?: number;
  deltaConference?: number;
  deltaShip?: number;
}

export interface HourlyProductivityPoint {
  hour: string;
  itemsPicked: number;
  itemsConferenced: number;
}

export interface PickerRankingItem {
  userId: string;
  userName: string;
  itemsPicked: number;
}

export interface ShelfAlertItem {
  locationId: string;
  corridor: string;
  row: string;
  barcode: string;
  productSku: string | null;
  productName: string | null;
  currentQuantity: number;
  minThreshold: number;
  capacity: number;
}

export interface StageMetrics {
  avgDurationSec: number;
  medianDurationSec: number;
  ordersCount: number;
  deltaVsYesterday?: number;
}

export interface ReturnReasonCount {
  type: string;
  label: string;
  count: number;
}

export interface PackingReturnMetrics {
  countToday: number;
  inQueue: number;
  avgResolutionSec: number;
  deltaVsYesterday?: number;
  byReason: ReturnReasonCount[];
}

export interface DashboardStageMetrics {
  picking: StageMetrics;
  packing: StageMetrics;
  packingReturns: PackingReturnMetrics;
}

export interface DashboardProductivity {
  kpis: DashboardKpis;
  hourly: HourlyProductivityPoint[];
  pickerRanking: PickerRankingItem[];
  shelfAlerts: ShelfAlertItem[];
  stageMetrics: DashboardStageMetrics;
  updatedAt: string;
}

export function formatDurationSec(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}
