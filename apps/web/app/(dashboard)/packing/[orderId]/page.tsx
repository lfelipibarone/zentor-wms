"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Pedido avulso abre na mesma tela de Packing (?order=). */
export default function PackingOrderRedirect() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/packing?order=${encodeURIComponent(params.orderId)}`);
  }, [params.orderId, router]);

  return (
    <p className="p-6 text-sm text-muted-foreground">Abrindo conferência na fila…</p>
  );
}
