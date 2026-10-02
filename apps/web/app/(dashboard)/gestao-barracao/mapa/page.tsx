"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { FloorPlanEditor } from "@/components/warehouse/floor-plan/floor-plan-editor";
import { RoutingEngineToggle } from "@/components/warehouse/floor-plan/routing-engine-toggle";
import { fetchBarracoesList, type WarehouseBarracaoOption } from "@/lib/api/warehouse";

function MapaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const barracaoId = searchParams.get("barracaoId")?.trim() ?? "";
  const [barracoes, setBarracoes] = useState<WarehouseBarracaoOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    fetchBarracoesList()
      .then(({ barracoes: data }) => {
        setBarracoes(data);
        if (!barracaoId && data[0]) router.replace(`/gestao-barracao/mapa?barracaoId=${encodeURIComponent(data[0].id)}`);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar barracões"));
  }, [barracaoId, router]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mapa do galpão"
        description="Monte a planta 2D do barracão: gôndolas, faces, obstáculos, início e packing. A planta alimenta o motor de rotas."
      >
        <Link
          href={barracaoId ? `/gestao-barracao?barracaoId=${encodeURIComponent(barracaoId)}` : "/gestao-barracao"}
          className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Voltar
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {barracoes.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => router.push(`/gestao-barracao/mapa?barracaoId=${encodeURIComponent(b.id)}`)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              b.id === barracaoId ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {b.code}
            {b.name ? <span className="ml-1 font-normal text-slate-500">— {b.name}</span> : null}
          </button>
        ))}
      </div>

      <RoutingEngineToggle refreshKey={savedCount} />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {barracaoId ? (
        <FloorPlanEditor key={barracaoId} barracaoId={barracaoId} onSaved={() => setSavedCount((n) => n + 1)} />
      ) : barracoes.length === 0 && !error ? (
        <p className="text-sm text-slate-500">Cadastre um barracão antes de montar o mapa.</p>
      ) : null}
    </div>
  );
}

export default function GestaoBarracaoMapaPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
      <MapaContent />
    </Suspense>
  );
}
