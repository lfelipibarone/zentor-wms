"use client";

import {
  collectionUrgencyTailwindDot,
  getCollectionUrgency,
} from "@wms/shared";
import { cn } from "@/lib/utils";

type Props = {
  deadline: string | null | undefined;
  className?: string;
  /** "card" = linha compacta; "detail" = bloco maior no cabeçalho */
  variant?: "card" | "detail";
};

export function CollectionDeadlineIndicator({
  deadline,
  className,
  variant = "card",
}: Props) {
  const urgency = getCollectionUrgency(deadline);

  if (variant === "detail") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-2",
          urgency.isOverdue && "border-red-200 bg-red-50",
          urgency.level === "critical" && !urgency.isOverdue && "border-orange-200 bg-orange-50",
          urgency.level === "warning" && "border-amber-200 bg-amber-50",
          !urgency.isOverdue &&
            urgency.level !== "critical" &&
            urgency.level !== "warning" &&
            "border-slate-200 bg-slate-50",
          className,
        )}
      >
        <span
          className={cn(
            "h-3 w-3 shrink-0 rounded-full",
            collectionUrgencyTailwindDot(urgency.level),
          )}
          title={urgency.hint}
        />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Coleta até
          </p>
          <p className="font-semibold tabular-nums">{urgency.timeLabel}</p>
          <p className="text-xs text-muted-foreground">{urgency.hint}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-2 text-sm", className)}
      title={urgency.hint}
    >
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          collectionUrgencyTailwindDot(urgency.level),
        )}
      />
      <span className="tabular-nums font-medium">{urgency.timeLabel}</span>
      <span className="truncate text-muted-foreground">{urgency.hint}</span>
    </div>
  );
}
