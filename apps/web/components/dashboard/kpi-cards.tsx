import {
  ClipboardList,
  PackageCheck,
  Truck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardKpis } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

interface KpiCardsProps {
  kpis: DashboardKpis;
}

const items: Array<{
  key: string;
  title: string;
  subtitle?: string;
  icon: typeof ClipboardList;
  accent: string;
  valueKey: "awaitingPicking" | "awaitingConference" | "readyToShip";
  deltaKey: "deltaPicking" | "deltaConference" | "deltaShip";
}> = [
  {
    key: "awaitingPicking",
    title: "Aguardando Separação",
    icon: ClipboardList,
    accent: "border-l-blue-500",
    valueKey: "awaitingPicking",
    deltaKey: "deltaPicking",
  },
  {
    key: "awaitingConference",
    title: "Aguardando Conferência",
    subtitle: "Pedidos na cesta",
    icon: PackageCheck,
    accent: "border-l-emerald-500",
    valueKey: "awaitingConference",
    deltaKey: "deltaConference",
  },
  {
    key: "readyToShip",
    title: "Prontos para Expedir",
    icon: Truck,
    accent: "border-l-amber-500",
    valueKey: "readyToShip",
    deltaKey: "deltaShip",
  },
];

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
          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
      )}
    >
      <Icon className="h-3 w-3" />
      {up ? "+" : ""}
      {value}% vs ontem
    </span>
  );
}

export function KpiCards({ kpis }: KpiCardsProps) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        const value = kpis[item.valueKey];
        const delta = kpis[item.deltaKey];
        return (
          <Card
            key={item.key}
            className={cn("border-l-4 shadow-md", item.accent)}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {item.title}
              </CardTitle>
              <Icon className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {item.subtitle ? (
                <p className="mb-1 text-xs text-muted-foreground">
                  {item.subtitle}
                </p>
              ) : null}
              <p className="text-4xl font-bold tracking-tight">
                {typeof value === "number" ? value : "—"}
              </p>
              <div className="mt-2">
                <DeltaBadge value={delta} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
