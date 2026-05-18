import { mockDashboardProductivity } from "@/lib/mock/dashboard";
import { apiFetch } from "@/lib/api/client";
import type { DashboardProductivity } from "@/lib/types/dashboard";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

/** Use mock apenas quando explicitamente true */
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

/**
 * GET /api/dashboard/productivity
 */
export async function fetchDashboardProductivity(): Promise<DashboardProductivity> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return {
      ...mockDashboardProductivity,
      updatedAt: new Date().toISOString(),
    };
  }

  return apiFetch<DashboardProductivity>("/api/dashboard/productivity");
}
