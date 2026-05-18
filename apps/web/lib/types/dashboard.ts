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

export interface DashboardProductivity {
  kpis: DashboardKpis;
  hourly: HourlyProductivityPoint[];
  pickerRanking: PickerRankingItem[];
  shelfAlerts: ShelfAlertItem[];
  updatedAt: string;
}
