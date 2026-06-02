import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import type { OrderStatus } from "@wms/shared";

const VARIANT: Record<
  string,
  "default" | "secondary" | "warning" | "destructive" | "outline"
> = {
  PENDING: "warning",
  PICKING: "default",
  PAUSED_ISSUE: "destructive",
  PICKED_AWAITING_CONFERENCE: "secondary",
  PACKING_RETURNED_TO_PICKING: "warning",
  DISPATCHING: "default",
  DISPATCHED: "outline",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const label =
    ORDER_STATUS_LABEL[status as OrderStatus] ?? status;
  return (
    <Badge variant={VARIANT[status] ?? "outline"}>{label}</Badge>
  );
}
