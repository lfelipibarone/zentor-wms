import { PURCHASE_RECEIPT_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  WAITING_ENTRY: "bg-amber-100 text-amber-900",
  READY_TO_CHECK: "bg-blue-100 text-blue-900",
  IN_CHECK: "bg-cyan-100 text-cyan-900",
  COMPLETED: "bg-emerald-100 text-emerald-900",
  ISSUE: "bg-red-100 text-red-900",
  CANCELLED: "bg-slate-100 text-slate-600",
};

const STATUS_DOT: Record<string, string> = {
  WAITING_ENTRY: "bg-amber-500",
  READY_TO_CHECK: "bg-blue-500",
  IN_CHECK: "bg-cyan-500",
  COMPLETED: "bg-emerald-500",
  ISSUE: "bg-red-500",
  CANCELLED: "bg-slate-400",
};

export function PurchaseReceiptStatusBadge({
  status,
  showDot = false,
  className,
}: {
  status: string;
  showDot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700",
        className,
      )}
    >
      {showDot ? (
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            STATUS_DOT[status] ?? "bg-slate-400",
          )}
        />
      ) : null}
      {PURCHASE_RECEIPT_STATUS_LABEL[status] ?? status}
    </span>
  );
}
