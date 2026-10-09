import { apiFetch } from "@/lib/api/client";
import type { FloorElement, FloorPlanEstante } from "@/lib/api/floor-plan";

export type WaveFace = "A" | "B";

/** Coluna inteira (linha nula) ou uma linha específica de um lado da estante. */
export interface WaveMapSelectionEntry {
  estanteId: string;
  face: WaveFace;
  coluna: string;
  linha: string | null;
}

export interface WaveMapCell {
  locationId: string;
  barcode: string;
  estanteId: string;
  face: WaveFace;
  coluna: string;
  linha: string;
  orderIds: string[];
}

export interface WaveMapOrder {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  marketplace: string | null;
  priority: number;
  collectionDeadline: string | null;
  itemCount: number;
}

export interface WaveTemplate {
  id: string;
  barracaoId: string;
  name: string;
  color: string;
  active: boolean;
  selection: WaveMapSelectionEntry[];
  waveCount: number;
  updatedAt: string;
}

export interface WaveMapBarracao {
  id: string;
  code: string;
  name: string | null;
}

export type WaveMapData =
  | { barracoes: WaveMapBarracao[]; barracao: null }
  | {
      barracoes: WaveMapBarracao[];
      barracao: WaveMapBarracao;
      plan: { widthCells: number; heightCells: number; cellSizeCm: number; elements: FloorElement[] };
      estantes: FloorPlanEstante[];
      colunas: Array<{ estanteId: string; face: WaveFace; coluna: string; linhas: string[] }>;
      cells: WaveMapCell[];
      orders: WaveMapOrder[];
      candidateCount: number;
      unmappedOrderCount: number;
      templates: WaveTemplate[];
    };

export function fetchWaveMap(params: { barracaoId?: string; marketplace?: string }) {
  const sp = new URLSearchParams();
  if (params.barracaoId) sp.set("barracaoId", params.barracaoId);
  if (params.marketplace) sp.set("marketplace", params.marketplace);
  const q = sp.toString();
  return apiFetch<WaveMapData>(`/api/waves/map${q ? `?${q}` : ""}`);
}

export function createWaveTemplate(body: {
  barracaoId: string;
  name: string;
  color: string;
  selection: WaveMapSelectionEntry[];
}) {
  return apiFetch<{ template: WaveTemplate }>("/api/waves/templates", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateWaveTemplate(
  id: string,
  body: Partial<Pick<WaveTemplate, "name" | "color" | "active" | "selection">>,
) {
  return apiFetch<{ template: WaveTemplate }>(`/api/waves/templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteWaveTemplate(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/waves/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function selectionKey(
  e: Pick<WaveMapSelectionEntry, "estanteId" | "face" | "coluna">,
  linha: string | null,
): string {
  return `${e.estanteId}|${e.face}|${e.coluna}|${linha ?? "*"}`;
}

export function colunaKey(e: Pick<WaveMapSelectionEntry, "estanteId" | "face" | "coluna">): string {
  return `${e.estanteId}|${e.face}|${e.coluna}`;
}
