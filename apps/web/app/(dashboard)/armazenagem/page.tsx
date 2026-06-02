"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import {
  fetchPutawayQueue,
  startPutawaySession,
  type PutawayQueueItem,
} from "@/lib/api/putaway";

export default function ArmazenagemPage() {
  const router = useRouter();
  const [items, setItems] = useState<PutawayQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchPutawayQueue());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (item: PutawayQueueItem) => {
    if (item.putawaySessionId) {
      router.push(`/armazenagem/${item.putawaySessionId}`);
      return;
    }
    setStarting(item.purchaseReceiptId);
    try {
      const data = await startPutawaySession(item.purchaseReceiptId);
      router.push(`/armazenagem/${data.session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar");
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Armazenagem no pulmão"
        description="NFs conferidas aguardando endereçamento no estoque de reserva."
      />

      <DataState loading={loading} error={error} empty={items.length === 0}>
        <ul className="divide-y rounded-xl border bg-white shadow-sm">
          {items.map((item) => (
            <li key={item.purchaseReceiptId} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono font-bold">
                    NF {item.invoiceNumber ?? "—"}
                  </p>
                  {item.supplierName ? (
                    <p className="text-sm text-muted-foreground">
                      {item.supplierName}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {item.itemCount} itens · {item.receiptOperator}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={starting === item.purchaseReceiptId}
                  onClick={() => void open(item)}
                  className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {item.putawaySessionId ? "Continuar" : "Iniciar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Recebimento e conferência de NF são feitos em{" "}
          <Link href="/recebimentos" className="text-[#0d9488] underline">
            Recebimentos
          </Link>
          .
        </p>
      </DataState>
    </div>
  );
}
