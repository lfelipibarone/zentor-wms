import { apiFetch } from "@/lib/api/client";

export interface PutawayQueueItem {
  purchaseReceiptId: string;
  putawaySessionId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  completedAt: string | null;
  receiptOperator: string;
  itemCount: number;
  status: string;
}

export interface PutawaySessionView {
  session: { id: string; status: string };
  nextItem: {
    id: string;
    productCode: string;
    description: string | null;
    remaining: number;
  } | null;
  allStored: boolean;
  items: Array<{
    id: string;
    productCode: string;
    description: string | null;
    quantityExpected: number;
    quantityStored: number;
    locationBarcode: string | null;
  }>;
}

export function fetchPutawayQueue() {
  return apiFetch<PutawayQueueItem[]>("/api/putaway/queue");
}

export function startPutawaySession(purchaseReceiptId: string) {
  return apiFetch<PutawaySessionView>("/api/putaway/start", {
    method: "POST",
    body: JSON.stringify({ purchaseReceiptId }),
  });
}

export function fetchPutawaySession(sessionId: string) {
  return apiFetch<PutawaySessionView>(`/api/putaway/${sessionId}`);
}

export function storePutawayItem(
  sessionId: string,
  body: {
    itemId: string;
    locationBarcode: string;
    productBarcode?: string;
    quantity: number;
  },
) {
  return apiFetch<PutawaySessionView>(`/api/putaway/${sessionId}/store`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function completePutawaySession(sessionId: string) {
  return apiFetch<{ completed: boolean }>(`/api/putaway/${sessionId}/complete`, {
    method: "POST",
    body: "{}",
  });
}
