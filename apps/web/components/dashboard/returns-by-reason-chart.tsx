"use client";

import {
  Bar,
  BarChart,
  Cell,
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
import type { ReturnReasonCount } from "@/lib/types/dashboard";

const BAR_COLORS = [
  "hsl(24 95% 53%)",
  "hsl(24 95% 58%)",
  "hsl(24 95% 63%)",
  "hsl(24 95% 68%)",
  "hsl(24 95% 73%)",
];

interface ReturnsByReasonChartProps {
  data: ReturnReasonCount[];
}

export function ReturnsByReasonChart({ data }: ReturnsByReasonChartProps) {
  const chartData = [...data]
    .sort((a, b) => b.count - a.count)
    .map((d) => ({
      name: d.label,
      count: d.count,
    }));

  return (
    <Card className="shadow-md h-full">
      <CardHeader>
        <CardTitle>Devoluções por motivo</CardTitle>
        <CardDescription>
          Problemas reportados na conferência hoje
        </CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            Nenhuma devolução registrada hoje
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 12, fontWeight: 600 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number) => [`${value}`, "Devoluções"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                }}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={28}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
