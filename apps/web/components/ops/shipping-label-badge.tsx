import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export function ShippingLabelBadge({
  available,
  className,
}: {
  available: boolean;
  className?: string;
}) {
  if (!available) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900",
        className,
      )}
      title="Etiqueta de envio já capturada no WMS"
    >
      <Tag className="h-3 w-3" />
      Etiqueta disponível
    </span>
  );
}
