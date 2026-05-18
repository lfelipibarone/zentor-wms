import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useMobileConfig() {
  return useQuery({
    queryKey: ["mobile", "config"],
    queryFn: () => api.getMobileConfig(),
    staleTime: 60_000,
  });
}
