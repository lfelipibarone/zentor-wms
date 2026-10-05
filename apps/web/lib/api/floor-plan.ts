import { apiFetch } from "@/lib/api/client";

export type FloorElementType = "GONDOLA" | "OBSTACLE" | "START_POINT" | "PACKING_POINT" | "DOCK" | "RECEIVING_AREA";

export interface FloorElement {
  id: string;
  type: FloorElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Estante do LD; também do LE quando `estanteIdB` é nulo. */
  estanteId: string | null;
  /** Estante do LE quando a gôndola junta duas estantes de costas. */
  estanteIdB: string | null;
  faceAEnabled: boolean;
  faceBEnabled: boolean;
  colunaReversedA: boolean;
  colunaReversedB: boolean;
  /** Faixa de colunas atendida em cada lado (nulo = sem limite): parte 1 e parte 2 da mesma estante. */
  colunaMinA?: number | null;
  colunaMaxA?: number | null;
  colunaMinB?: number | null;
  colunaMaxB?: number | null;
  label: string | null;
}

export interface FloorPlan {
  id: string;
  barracaoId: string;
  cellSizeCm: number;
  widthCells: number;
  heightCells: number;
  version: number;
  elements: FloorElement[];
}

export interface FloorPlanEstante {
  id: string;
  code: string;
  name: string | null;
  /** Colunas do LD (Face A) e do LE (Face B), ao longo da gôndola. */
  colunasLD: string[];
  colunasLE: string[];
  /** Quantidade de linhas (altura). */
  linhas: number;
  linhasLD: number;
  linhasLE: number;
}

export type EstanteStructureBody = {
  name: string | null;
  ld: { colunas: number; linhas: number };
  le: { colunas: number; linhas: number } | null;
};

export function setEstanteFace(estanteId: string, face: "A" | "B") {
  return apiFetch<{ moved: number }>(`/api/warehouse/estantes/${encodeURIComponent(estanteId)}/face`, {
    method: "PATCH",
    body: JSON.stringify({ face }),
  });
}

export function updateEstanteStructure(estanteId: string, body: EstanteStructureBody) {
  return apiFetch<{ created: number; removed: number; errors: Array<{ address: string; message: string }> }>(
    `/api/warehouse/estantes/${encodeURIComponent(estanteId)}/structure`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export interface FloorPlanIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  elementIds?: string[];
}

export interface FloorPlanValidation {
  ok: boolean;
  issues: FloorPlanIssue[];
  totalAccessPoints: number;
  reachableAccessPoints: number;
}

export interface FloorPlanEditorData {
  barracao: { id: string; code: string; name: string | null };
  plan: FloorPlan;
  saved: boolean;
  estantes: FloorPlanEstante[];
  validation: FloorPlanValidation;
}

export type FloorPlanDraft = Pick<FloorPlan, "cellSizeCm" | "widthCells" | "heightCells" | "elements">;

export interface RoutePreview {
  orderLabel: string | null;
  stops: Array<{ locationId: string; label: string; x: number; y: number; distanceMeters: number }>;
  unmapped: string[];
  path: Array<[number, number]>;
  toPackingMeters: number | null;
  totalMeters: number;
}

export type RoutingEngineKind = "LEGACY" | "PHYSICAL";

export interface RoutingEngineStatus {
  kind: RoutingEngineKind;
  canEnablePhysical: boolean;
  plans: Array<{ barracaoId: string; validation: FloorPlanValidation }>;
}

const base = (barracaoId: string) => `/api/warehouse/floor-plans/${encodeURIComponent(barracaoId)}`;

export function fetchFloorPlan(barracaoId: string) {
  return apiFetch<FloorPlanEditorData>(base(barracaoId));
}

export function saveFloorPlan(barracaoId: string, draft: FloorPlanDraft, expectedVersion: number) {
  return apiFetch<FloorPlanEditorData>(base(barracaoId), {
    method: "PUT",
    body: JSON.stringify({ ...draft, expectedVersion }),
  });
}

export function validateFloorPlan(barracaoId: string, draft: FloorPlanDraft) {
  return apiFetch<FloorPlanValidation>(`${base(barracaoId)}/validation`, {
    method: "POST",
    body: JSON.stringify({ draft }),
  });
}

export function previewFloorPlanRoute(
  barracaoId: string,
  body: { orderId?: string; locationIds?: string[]; draft?: FloorPlanDraft },
) {
  return apiFetch<RoutePreview>(`${base(barracaoId)}/route-preview`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchRoutingEngine() {
  return apiFetch<RoutingEngineStatus>("/api/warehouse/routing-engine");
}

export function updateRoutingEngine(kind: RoutingEngineKind) {
  return apiFetch<{ kind: RoutingEngineKind }>("/api/warehouse/routing-engine", {
    method: "PUT",
    body: JSON.stringify({ kind }),
  });
}
