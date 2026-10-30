"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Etiquetas em lote → hub (Gerar/Imprimir no card da onda). */
export default function PackingLabelsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/packing");
  }, [router]);

  return (
    <p className="p-6 text-sm text-muted-foreground">Redirecionando para Packing…</p>
  );
}
