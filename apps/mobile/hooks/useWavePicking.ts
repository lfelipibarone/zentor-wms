import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useReleasedWaves() {
  return useQuery({
    queryKey: ["wave", "released"],
    queryFn: () => api.listReleasedWaves(),
    retry: false,
  });
}

export function useWaveById(waveId: string | null) {
  return useQuery({
    queryKey: ["wave", waveId],
    queryFn: () => api.getWaveById(waveId!),
    enabled: !!waveId,
    retry: false,
  });
}

export function useCurrentWave() {
  return useQuery({
    queryKey: ["wave", "current"],
    queryFn: () => api.getCurrentWave(),
    retry: false,
  });
}

export function useAcceptWave(waveId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      waveId ? api.acceptWave(waveId) : api.acceptCurrentWave(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wave"] });
    },
  });
}

export function useReleaseWaveAccept(waveId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      waveId
        ? api.releaseWaveAccept(waveId)
        : api.releaseCurrentWaveAccept(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wave"] });
    },
  });
}

/** @deprecated use useAcceptWave */
export function useAcceptCurrentWave() {
  return useAcceptWave(null);
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
