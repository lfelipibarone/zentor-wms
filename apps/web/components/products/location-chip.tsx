import { cn } from "@/lib/utils";

export function LocationChip({
  barcode,
  type,
  percent,
}: {
  barcode: string;
  type: "PICK_FACE" | "PULMAO";
  /** Gôndola: % atual. Pulmão: % deste SKU. */
  percent: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs",
        type === "PULMAO" ? "bg-amber-50 text-amber-800" : "bg-teal-50 text-teal-800",
      )}
      title={type === "PULMAO" ? "Pulmão" : "Gôndola"}
    >
      {barcode}
      <span className="text-[10px] opacity-70">· {percent}%</span>
    </span>
  );
}
