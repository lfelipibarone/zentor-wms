import { apiFetch } from "@/lib/api/client";

export type WorkShareKind = "PICK_WAVE" | "RECEIPT_CHECK" | "PUTAWAY";
export type WorkShareStatus = "RESERVED" | "STARTED" | "FINISHED" | "DECLINED" | "CANCELLED";

export interface WorkShareSummary {
  id: string;
  kind: WorkShareKind;
  kindLabel: string;
  status: WorkShareStatus;
  shareIndex: number;
  shareCount: number;
  title: string;
  subtitle: string | null;
  assignedTo: { id: string; name: string };
  assignedBy: { id: string; name: string } | null;
  itemsTotal: number;
  unitsTotal: number;
  itemsDone: number;
  unitsDone: number;
  reservedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedSec: number | null;
  waveId: string | null;
  wavePartId: string | null;
  receiptSessionId: string | null;
  putawaySessionId: string | null;
}

export interface WorkTimeByUserStageRow {
  userId: string;
  userName: string;
  kind: WorkShareKind;
  kindLabel: string;
  tasks: number;
  items: number;
  units: number;
  totalSec: number;
  avgSec: number;
  unitsPerHour: number | null;
}

export interface DashboardWorkShares {
  byUserStage: WorkTimeByUserStageRow[];
  inProgress: WorkShareSummary[];
  updatedAt: string;
}

export const WORK_STATUS_LABEL: Record<WorkShareStatus, string> = {
  RESERVED: "Aguardando início",
  STARTED: "Em andamento",
  FINISHED: "Concluída",
  DECLINED: "Recusada",
  CANCELLED: "Cancelada",
};

export function fetchDashboardWorkShares() {
  return apiFetch<DashboardWorkShares>("/api/dashboard/work-shares");
}

export function fetchWaveWorkShares(waveId: string) {
  return apiFetch<{ shares: WorkShareSummary[] }>(`/api/waves/${waveId}/work-shares`);
}

export function fetchReceiptWorkShares(receiptId: string) {
  return apiFetch<{ shares: WorkShareSummary[] }>(`/api/purchase-receipts/${receiptId}/work-shares`);
}

export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null) return "—";
  const s = Math.max(0, Math.floor(totalSec));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
