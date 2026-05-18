import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useLookupLocation(barcode: string | null) {
  return useQuery({
    queryKey: ["lookup", barcode],
    queryFn: () => api.getLocationByBarcode(barcode!),
    enabled: !!barcode,
    staleTime: 0,
  });
}
