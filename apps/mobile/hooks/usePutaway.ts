import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePutawayQueue() {
  return useQuery({
    queryKey: ["putaway-queue"],
    queryFn: async () => {
      const data = await api.getPutawayQueue();
      return data.queue;
    },
  });
}

export function usePutawaySession(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["putaway-session", sessionId],
    queryFn: () => api.getPutawaySession(sessionId!),
    enabled: Boolean(sessionId),
  });
}

export function useStartPutaway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (purchaseReceiptId: string) => api.startPutaway(purchaseReceiptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["putaway-queue"] });
    },
  });
}

export function useStorePutawayItem(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      itemId: string;
      locationBarcode: string;
      productBarcode?: string;
      quantity?: number;
    }) => api.storePutawayItem(sessionId, body),
    onSuccess: (data) => {
      qc.setQueryData(["putaway-session", sessionId], data);
    },
  });
}

export function useCompletePutaway(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.completePutaway(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["putaway-queue"] });
      qc.invalidateQueries({ queryKey: ["putaway-session", sessionId] });
    },
  });
}
