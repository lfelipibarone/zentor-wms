"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Visão completa da onda → hub de packing (etiquetas no card). */
export default function PackingWaveOverviewRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/packing");
  }, [router]);

  return (
    <p className="p-6 text-sm text-muted-foreground">Redirecionando para Packing…</p>
  );
}
