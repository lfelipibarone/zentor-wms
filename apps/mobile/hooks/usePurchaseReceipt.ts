import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePurchaseReceiptQueue() {
  return useQuery({
    queryKey: ["purchase-receipt-queue"],
    queryFn: async () => {
      const data = await api.getPurchaseReceiptQueue();
      return data.queue;
    },
  });
}

export function usePurchaseReceiptSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-receipt-session", sessionId],
    queryFn: () => api.getPurchaseReceiptSession(sessionId!),
    enabled: Boolean(sessionId),
  });
}

export function useStartPurchaseReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (barcode: string) => api.startPurchaseReceipt(barcode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-receipt-queue"] });
    },
  });
}

export function useScanPurchaseReceiptItem(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { barcode: string; quantity?: number }) =>
      api.scanPurchaseReceiptItem(sessionId, params.barcode, params.quantity),
    onSuccess: (data) => {
      qc.setQueryData(["purchase-receipt-session", sessionId], data);
    },
  });
}

export function useConfirmPurchaseReceiptItem(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { itemId: string; quantity: number }) =>
      api.confirmPurchaseReceiptItem(
        sessionId,
        params.itemId,
        params.quantity,
      ),
    onSuccess: (data) => {
      qc.setQueryData(["purchase-receipt-session", sessionId], data);
    },
  });
}

export function useCompletePurchaseReceipt(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.completePurchaseReceipt(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-receipt-queue"] });
      qc.invalidateQueries({ queryKey: ["purchase-receipt-session", sessionId] });
    },
  });
}
