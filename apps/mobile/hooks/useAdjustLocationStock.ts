import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useAdjustLocationStock() {
  return useMutation({
    mutationFn: (params: {
      locationId: string;
      countedQuantity: number;
      productBarcode?: string | null;
      reason?: string;
      orderId?: string;
      itemId?: string;
      waveLineId?: string;
    }) => api.adjustLocationQuantity(params),
  });
}
