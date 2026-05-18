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
import type { PickerRankingItem } from "@/lib/types/dashboard";

const BAR_COLORS = [
  "hsl(221 83% 53%)",
  "hsl(221 83% 58%)",
  "hsl(221 83% 63%)",
  "hsl(221 83% 68%)",
  "hsl(221 83% 73%)",
];

interface PickerRankingProps {
  data: PickerRankingItem[];
}

export function PickerRanking({ data }: PickerRankingProps) {
  const chartData = [...data]
    .sort((a, b) => b.itemsPicked - a.itemsPicked)
    .map((d) => ({
      name: d.userName.split(" ")[0],
      fullName: d.userName,
      items: d.itemsPicked,
    }));

  return (
    <Card className="shadow-md h-full">
      <CardHeader>
        <CardTitle>Separação por Usuário</CardTitle>
        <CardDescription>Itens separados hoje</CardDescription>
      </CardHeader>
      <CardContent>
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
              width={72}
              tick={{ fontSize: 13, fontWeight: 600 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(value: number) => [`${value} itens`, "Separados"]}
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.fullName ?? ""
              }
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--card))",
              }}
            />
            <Bar dataKey="items" radius={[0, 6, 6, 0]} barSize={28}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
