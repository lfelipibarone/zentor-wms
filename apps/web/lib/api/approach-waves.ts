import { apiFetch } from "@/lib/api/client";

export type ApproachWaveKind = "PICKING" | "PACKING";

export interface ApproachStop {
  estanteId: string;
  face: "A" | "B";
  colunaFrom: number | null;
  colunaTo: number | null;
  estanteCode?: string;
}

export interface ApproachWave {
  id?: string;
  name: string;
  color: string;
  active: boolean;
  startX: number | null;
  startY: number | null;
  stops: ApproachStop[];
}

export interface ApproachWaveSummary {
  id: string;
  name: string;
  color: string;
  barracaoId: string;
}

const base = (barracaoId: string, kind: ApproachWaveKind) =>
  `/api/warehouse/floor-plans/${encodeURIComponent(barracaoId)}/approach-waves?kind=${kind}`;

export function fetchApproachWaves(barracaoId: string, kind: ApproachWaveKind) {
  return apiFetch<{ waves: ApproachWave[] }>(base(barracaoId, kind));
}

export function saveApproachWaves(barracaoId: string, kind: ApproachWaveKind, waves: ApproachWave[]) {
  return apiFetch<{ waves: ApproachWave[] }>(base(barracaoId, kind), {
    method: "PUT",
    body: JSON.stringify({ waves }),
  });
}

export function fetchTenantApproachWaves(kind: ApproachWaveKind) {
  return apiFetch<{ waves: ApproachWaveSummary[] }>(`/api/approach-waves?kind=${kind}`);
}
