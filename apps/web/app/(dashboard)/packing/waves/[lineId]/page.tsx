"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Rotas antigas → hub (conferência é na tabela). */
export default function PackingWaveLineRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/packing");
  }, [router]);

  return (
    <p className="p-6 text-sm text-muted-foreground">Abrindo Packing…</p>
  );
}
