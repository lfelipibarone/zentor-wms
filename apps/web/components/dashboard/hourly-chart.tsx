"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import type { HourlyProductivityPoint } from "@/lib/types/dashboard";

interface HourlyChartProps {
  data: HourlyProductivityPoint[];
}

export function HourlyChart({ data }: HourlyChartProps) {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Separação e Conferência por Hora</CardTitle>
        <CardDescription>
          Itens separados vs itens conferidos — hoje
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--card))",
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="itemsPicked"
              name="Itens Separados"
              stroke="hsl(var(--chart-pick))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="itemsConferenced"
              name="Itens Conferidos"
              stroke="hsl(var(--chart-conference))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
