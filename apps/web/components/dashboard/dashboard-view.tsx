"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { fetchDashboardProductivity } from "@/lib/api/dashboard";
import type { DashboardProductivity } from "@/lib/types/dashboard";
import { KpiCards } from "./kpi-cards";
import { HourlyChart } from "./hourly-chart";
import { PickerRanking } from "./picker-ranking";
import { ShelfAlerts } from "./shelf-alerts";

export function DashboardView() {
  const [data, setData] = useState<DashboardProductivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDashboardProductivity();
      setData(result);
    } catch (e) {
      if (e instanceof Error && e.message === "Sessão expirada") return;
      setError(
        e instanceof Error && e.message !== "Failed to fetch"
          ? e.message
          : "Não foi possível carregar o dashboard. Verifique se a API está rodando (pnpm dev:api).",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-medium">Carregando produtividade...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-4 text-sm font-semibold text-primary underline"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Visão operacional em tempo real · atualizado{" "}
            {new Date(data.updatedAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-semibold shadow-sm hover:bg-muted/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </header>

      <KpiCards kpis={data.kpis} />

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HourlyChart data={data.hourly} />
        </div>
        <PickerRanking data={data.pickerRanking} />
      </section>

      <ShelfAlerts alerts={data.shelfAlerts} />
    </div>
  );
}

