import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useCurrentWave() {
  return useQuery({
    queryKey: ["wave", "current"],
    queryFn: () => api.getCurrentWave(),
    retry: false,
  });
}

export function useAcceptWave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.acceptCurrentWave(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wave"] });
    },
  });
}

export function useWaveLine(lineId: string | null) {
  return useQuery({
    queryKey: ["wave", "line", lineId],
    queryFn: () => api.getWaveLine(lineId!),
    enabled: !!lineId,
  });
}

export function useWaveLinePick(lineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      locationBarcode: string;
      productBarcode?: string;
      quantity: number;
    }) => api.waveLinePick(lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wave"] });
    },
  });
}

export function useWaveLineSort(lineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      allocationId: string;
      quantity: number;
      basketBarcode?: string;
    }) => api.waveLineSort(lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wave"] });
    },
  });
}
