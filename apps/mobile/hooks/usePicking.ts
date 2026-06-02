import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const pickingKeys = {
  queue: ["picking", "queue"] as const,
  session: (orderId: string) => ["picking", "session", orderId] as const,
};

export function useOrderQueue() {
  return useQuery({
    queryKey: pickingKeys.queue,
    queryFn: api.getQueue,
    refetchInterval: 15_000,
    select: (data) => data,
  });
}

export function usePickingSession(orderId: string, enabled = true) {
  return useQuery({
    queryKey: pickingKeys.session(orderId),
    queryFn: () => api.getPickingSession(orderId),
    enabled: !!orderId && enabled,
    refetchInterval: 5_000,
  });
}

export function useAcceptOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.acceptOrder(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: pickingKeys.queue }),
  });
}

export function useAttachBasket(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (basketBarcode: string) =>
      api.attachBasket(orderId, basketBarcode),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: pickingKeys.session(orderId) }),
  });
}

export function useValidateLocation(orderId: string, itemId: string) {
  return useMutation({
    mutationFn: (locationBarcode: string) =>
      api.validateLocation(orderId, itemId, locationBarcode),
  });
}

export function usePickItem(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      quantity,
    }: {
      itemId: string;
      quantity: number;
    }) => api.pickItem(orderId, itemId, quantity),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: pickingKeys.session(orderId) }),
  });
}

export function useReportIssue(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.reportIssue(orderId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickingKeys.session(orderId) });
      qc.invalidateQueries({ queryKey: pickingKeys.queue });
    },
  });
}

export function useCompletePicking(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.completePicking(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickingKeys.session(orderId) });
      qc.invalidateQueries({ queryKey: pickingKeys.queue });
    },
  });
}

export function useReleaseOrderAccept(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.releaseOrderAccept(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickingKeys.session(orderId) });
      qc.invalidateQueries({ queryKey: pickingKeys.queue });
    },
  });
}
