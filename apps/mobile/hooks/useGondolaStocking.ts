import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useLocationByBarcode(barcode: string | null) {
  return useQuery({
    queryKey: ["location", barcode],
    queryFn: () => api.getLocationByBarcode(barcode!),
    enabled: !!barcode,
  });
}

export function useStockLocation(locationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      productBarcode,
      quantity,
    }: {
      productBarcode: string;
      quantity?: number;
    }) => api.stockLocation(locationId, productBarcode, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["location"] });
    },
  });
}
