"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardStageMetrics } from "@/lib/types/dashboard";
import { formatDurationSec } from "@/lib/types/dashboard";

interface StageDurationChartProps {
  metrics: DashboardStageMetrics;
}

export function StageDurationChart({ metrics }: StageDurationChartProps) {
  const chartData = [
    {
      stage: "Separação",
      avgSec: metrics.picking.avgDurationSec,
      medianSec: metrics.picking.medianDurationSec,
    },
    {
      stage: "Conferência",
      avgSec: metrics.packing.avgDurationSec,
      medianSec: metrics.packing.medianDurationSec,
    },
  ];

  const hasData = chartData.some((d) => d.avgSec > 0);

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Comparativo de tempos</CardTitle>
        <CardDescription>Duração média por etapa (hoje)</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            Sem dados de tempo registrados hoje
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="stage"
                tick={{ fontSize: 13, fontWeight: 600 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis hide />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatDurationSec(value),
                  name === "avgSec" ? "Média" : "Mediana",
                ]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                }}
              />
              <Bar
                dataKey="avgSec"
                name="avgSec"
                fill="hsl(221 83% 53%)"
                radius={[6, 6, 0, 0]}
                barSize={48}
              />
              <Bar
                dataKey="medianSec"
                name="medianSec"
                fill="hsl(142 71% 45%)"
                radius={[6, 6, 0, 0]}
                barSize={48}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
