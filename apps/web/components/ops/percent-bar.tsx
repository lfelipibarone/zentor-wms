import { cn } from "@/lib/utils";

/** % da gôndola com barra; fica âmbar/vermelha quando chega na % mínima. */
export function PercentBar({
  percent,
  minPercent,
  className,
}: {
  percent: number;
  minPercent?: number | null;
  className?: string;
}) {
  const value = Math.max(0, Math.round(percent));
  const low = minPercent != null && value <= minPercent;
  const empty = value <= 0;
  return (
    <div className={cn("flex min-w-[96px] items-center gap-2", className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full",
            empty ? "bg-red-500" : low ? "bg-amber-500" : "bg-teal-600",
          )}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span
        className={cn(
          "w-10 text-right text-sm font-semibold tabular-nums",
          empty ? "text-red-600" : low ? "text-amber-700" : "text-slate-700",
        )}
      >
        {value}%
      </span>
    </div>
  );
}
