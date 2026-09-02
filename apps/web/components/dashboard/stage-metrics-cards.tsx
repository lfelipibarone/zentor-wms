import {
  Clock,
  PackageCheck,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardStageMetrics } from "@/lib/types/dashboard";
import { formatDurationSec } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

interface StageMetricsCardsProps {
  metrics: DashboardStageMetrics;
}

function DeltaBadge({ value }: { value?: number }) {
  if (value === undefined) return null;
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold",
        up
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
      )}
    >
      <Icon className="h-3 w-3" />
      {up ? "+" : ""}
      {value}% vs ontem
    </span>
  );
}

const cards = [
  {
    key: "picking",
    title: "Tempo médio — Separação",
    subtitle: (m: DashboardStageMetrics) =>
      `${m.picking.ordersCount} pedido(s) concluído(s) hoje`,
    icon: Clock,
    accent: "border-l-blue-500",
    value: (m: DashboardStageMetrics) =>
      formatDurationSec(m.picking.avgDurationSec),
    delta: (m: DashboardStageMetrics) => m.picking.deltaVsYesterday,
  },
  {
    key: "packing",
    title: "Tempo médio — Conferência",
    subtitle: (m: DashboardStageMetrics) =>
      `${m.packing.ordersCount} pedido(s) conferido(s) hoje`,
    icon: PackageCheck,
    accent: "border-l-emerald-500",
    value: (m: DashboardStageMetrics) =>
      formatDurationSec(m.packing.avgDurationSec),
    delta: (m: DashboardStageMetrics) => m.packing.deltaVsYesterday,
  },
  {
    key: "returns",
    title: "Devoluções do packing",
    subtitle: (m: DashboardStageMetrics) =>
      m.packingReturns.inQueue > 0
        ? `${m.packingReturns.inQueue} aguardando re-separação`
        : m.packingReturns.avgResolutionSec > 0
          ? `Resolução média: ${formatDurationSec(m.packingReturns.avgResolutionSec)}`
          : "Retornos packing → picking hoje",
    icon: RotateCcw,
    accent: "border-l-orange-500",
    value: (m: DashboardStageMetrics) => String(m.packingReturns.countToday),
    delta: (m: DashboardStageMetrics) => m.packingReturns.deltaVsYesterday,
  },
] as const;

export function StageMetricsCards({ metrics }: StageMetricsCardsProps) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((item) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.key}
            className={cn("border-l-4 shadow-md", item.accent)}
          >
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {item.title}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {item.subtitle(metrics)}
                </p>
              </div>
              <Icon className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <p className="text-3xl font-bold tracking-tight">
                  {item.value(metrics)}
                </p>
                <DeltaBadge value={item.delta(metrics)} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
