import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useLocationByBarcode(barcode: string | null) {
  return useQuery({
    queryKey: ["location", barcode],
    queryFn: () => api.getLocationByBarcode(barcode!),
    enabled: !!barcode,
  });
}

export function useReplenish(locationId: string) {
  return useMutation({
    mutationFn: ({
      percent,
      productBarcode,
    }: {
      percent: number;
      productBarcode?: string;
    }) => api.replenishLocation(locationId, percent, productBarcode),
  });
}

export function useRequestReplenishment(barcode: string | null) {
  return useMutation({
    mutationFn: ({ percent }: { percent: number }) =>
      api.requestReplenishment(barcode!, percent),
  });
}
