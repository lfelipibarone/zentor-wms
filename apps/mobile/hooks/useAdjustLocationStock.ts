import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useAdjustLocationStock() {
  return useMutation({
    mutationFn: (params: {
      locationId: string;
      percent?: number;
      quantity?: number;
      productBarcode?: string | null;
      reason?: string;
      orderId?: string;
      itemId?: string;
      waveLineId?: string;
    }) => api.adjustLocationPercent(params),
  });
}
