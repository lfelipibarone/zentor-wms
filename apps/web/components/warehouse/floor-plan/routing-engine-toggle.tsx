"use client";

import { useCallback, useEffect, useState } from "react";
import { Permission } from "@wms/shared";
import { useAuth } from "@/components/auth/auth-provider";
import {
  fetchRoutingEngine,
  updateRoutingEngine,
  type RoutingEngineKind,
  type RoutingEngineStatus,
} from "@/lib/api/floor-plan";

/** Liga/desliga o motor de rota física para o tenant inteiro. */
export function RoutingEngineToggle({ refreshKey }: { refreshKey?: unknown }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<RoutingEngineStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchRoutingEngine());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar motor de rota");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!status) return error ? <p className="text-sm text-red-600">{error}</p> : null;

  const physical = status.kind === "PHYSICAL";
  const canManage = can(Permission.SETTINGS_MANAGE);
  const blocked = !physical && !status.canEnablePhysical;

  const change = async (kind: RoutingEngineKind) => {
    if (kind === "LEGACY" && !window.confirm("Voltar para a rota antiga (estante/linha) em todas as operações?")) return;
    setSaving(true);
    setError(null);
    try {
      await updateRoutingEngine(kind);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao alterar motor de rota");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          Motor de rota:{" "}
          <span className={physical ? "text-teal-700" : "text-slate-600"}>
            {physical ? "Mapa físico" : "Rota antiga (estante/linha)"}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          {physical
            ? "Separação, putaway, reabastecimento e ondas usam a distância real da planta."
            : blocked
              ? "Para ativar o mapa físico, salve uma planta sem erros de validação para cada barracão mapeado."
              : "As plantas estão válidas. Ative para usar a distância real nas operações."}
        </p>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
      {canManage ? (
        <button
          type="button"
          disabled={saving || blocked}
          onClick={() => change(physical ? "LEGACY" : "PHYSICAL")}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
            physical ? "border text-slate-700" : "bg-[#0d9488] text-white"
          }`}
        >
          {saving ? "…" : physical ? "Voltar para rota antiga" : "Ativar mapa físico"}
        </button>
      ) : null}
    </div>
  );
}
