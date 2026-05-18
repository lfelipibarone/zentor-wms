import { apiFetch } from "@/lib/api/client";
import { authHeaders, clearAuthToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export type ReportId =
  | "dispatched"
  | "orders"
  | "picking"
  | "movements"
  | "low_stock";

export interface ReportColumn {
  key: string;
  header: string;
}

export interface ReportResult {
  report: ReportId;
  title: string;
  from: string | null;
  to: string | null;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totalRows: number;
}

export interface ReportTypeMeta {
  id: ReportId;
  label: string;
  description: string;
  requiresPeriod: boolean;
}

export function defaultReportPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function fetchReportTypes() {
  return apiFetch<{ types: ReportTypeMeta[] }>("/api/reports/types");
}

export function fetchReportsSummary(from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const q = qs.toString();
  return apiFetch<{
    periodFrom: string;
    periodTo: string;
    ordersByStatus: Array<{ status: string; count: number }>;
    productsCount: number;
    locationsCount: number;
    lowStockCount: number;
    movementsInPeriod: number;
    dispatchedInPeriod: number;
    topPickers: Array<{ userName: string; itemsPicked: number }>;
    lowStock: Array<{
      barcode: string;
      sku?: string;
      currentQuantity: number;
      minThreshold: number;
    }>;
  }>(`/api/reports/summary${q ? `?${q}` : ""}`);
}

export function fetchReportData(params: {
  report: ReportId;
  from?: string;
  to?: string;
  status?: string;
  movementType?: string;
}) {
  const qs = new URLSearchParams({ report: params.report });
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.status) qs.set("status", params.status);
  if (params.movementType) qs.set("movementType", params.movementType);
  return apiFetch<ReportResult>(`/api/reports/data?${qs}`);
}

export async function downloadReportCsv(params: {
  report: ReportId;
  from?: string;
  to?: string;
  status?: string;
  movementType?: string;
}): Promise<void> {
  const qs = new URLSearchParams({
    report: params.report,
    format: "csv",
  });
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.status) qs.set("status", params.status);
  if (params.movementType) qs.set("movementType", params.movementType);

  const res = await fetch(`${API_BASE}/api/reports/data?${qs}`, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (res.status === 401) {
    clearAuthToken();
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : `Erro ${res.status}`;
    throw new Error(msg);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  const filenameMatch = disposition?.match(/filename="([^"]+)"/);
  const filename =
    filenameMatch?.[1] ??
    `help-route-${params.report}-${params.from ?? "periodo"}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
