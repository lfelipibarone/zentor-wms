"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Rotas antigas → hub com painel de conferência. */
export default function PackingWaveLineRedirect() {
  const params = useParams<{ lineId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/packing?line=${encodeURIComponent(params.lineId)}`);
  }, [params.lineId, router]);

  return (
    <p className="p-6 text-sm text-muted-foreground">Abrindo conferência…</p>
  );
}
