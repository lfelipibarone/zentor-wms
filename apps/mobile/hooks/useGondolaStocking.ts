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
      percent,
    }: {
      productBarcode: string;
      percent: number;
    }) => api.stockLocation(locationId, productBarcode, percent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["location"] });
    },
  });
}
