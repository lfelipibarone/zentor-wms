import type { StockMode } from "@/lib/api/warehouse";

/** "12 un." para gôndola por quantidade; undefined quando a gôndola é por %. */
export function unitsLabel(units: number | null | undefined, mode: StockMode | undefined) {
  return mode === "QUANTITY" && units != null ? `${units} un.` : undefined;
}
