import { apiFetch } from "@/lib/api/client";

import type { PaginationMeta } from "@/lib/pagination";

import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export interface WarehouseNode {
  id: string;
  code: string;
  name: string | null;
  pickOrder: number;
  active: boolean;
}

export interface WarehouseProximityReference {
  proximityCorredorId: string | null;
  proximityEstanteId: string | null;
  proximityLinhaId: string | null;
}

export interface WarehouseLayoutLocation {
  id: string;
  type: "PICK_FACE" | "PULMAO";
  barcode: string;
  capacity: number;
  /** % mínima antes de repor */
  minPercent: number;
  /** % atual (no pulmão, soma das % dos SKUs) */
  fillPercent: number;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
  proximityReferences?: WarehouseProximityReference[];
  product?: { id: string; sku: string; name: string | null } | null;
}

export interface WarehouseLinhaNode extends WarehouseNode {
  colunaId?: string;
  face?: LocationFace;
  location?: WarehouseLayoutLocation | null;
}

export interface WarehouseColunaNode extends WarehouseNode {
  linhas: WarehouseLinhaNode[];
}

export interface WarehouseEstanteNode extends WarehouseNode {
  colunas: WarehouseColunaNode[];
}

export interface WarehouseCorredorNode extends WarehouseNode {
  estantes: WarehouseEstanteNode[];
}

export interface WarehouseSetorNode extends WarehouseNode {
  corredores: WarehouseCorredorNode[];
}

export interface WarehouseTree {
  id: string;
  code: string;
  name: string | null;
  pickOrder: number;
  active: boolean;
  setores: WarehouseSetorNode[];
}

export interface WarehouseBarracaoOption {
  id: string;
  code: string;
  name: string | null;
  pickOrder: number;
  active: boolean;
}

export type WarehouseItem = WarehouseNode;

export type WarehouseSegment =
  | "barracoes"
  | "setores"
  | "corredores"
  | "estantes"
  | "colunas"
  | "linhas";

export function fetchBarracoesList() {
  return apiFetch<{ barracoes: WarehouseBarracaoOption[] }>(
    "/api/warehouse/barracoes-list",
  );
}

export function fetchWarehouseTree(barracaoId: string) {
  return apiFetch<{ tree: WarehouseTree }>(
    `/api/warehouse/tree?barracaoId=${encodeURIComponent(barracaoId)}`,
  );
}

export function fetchFullWarehouseTree() {
  return apiFetch<{ trees: WarehouseTree[] }>("/api/warehouse/full-tree");
}

export function fetchWarehouseLayoutRows(params: {
  barracaoId: string;
  q?: string;
  tipo?: "pulmao" | "pick_face";
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  sp.set("barracaoId", params.barracaoId);
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.tipo) sp.set("tipo", params.tipo);
  if (params.page) sp.set("page", String(params.page));
  sp.set("pageSize", String(params.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    rows: WarehouseLayoutListRow[];
    pagination: PaginationMeta;
  }>(`/api/warehouse/layout-rows?${sp}`);
}

export interface WarehouseLayoutListRow {
  id: string;
  segment: WarehouseSegment;
  tipo: string;
  parentPath: string;
  code: string;
  name: string | null;
  ordem: number;
  active: boolean;
  barracaoId: string;
  barracao: string;
  setor: string;
  corredor: string;
  estante: string;
  coluna: string;
  linha: string;
  face?: LocationFace;
  sku: string;
  minPercent: number | null;
  fillPercent: number | null;
  isPosition: boolean;
  setorId?: string;
  corredorId?: string;
  estanteId?: string;
  colunaId?: string;
  location?: WarehouseLayoutLocation;
  barcode?: string;
  locationType?: "PICK_FACE" | "PULMAO";
  productId?: string | null;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
  proximityReferences?: WarehouseProximityReference[];
}

export function fetchWarehouseProximityOptions(
  barracaoId: string,
  excludeLinhaId?: string,
) {
  const sp = new URLSearchParams({ barracaoId });
  if (excludeLinhaId) sp.set("excludeLinhaId", excludeLinhaId);
  return apiFetch<{
    corredores: Array<{ id: string; label: string }>;
    estantes: Array<{ id: string; label: string }>;
    linhas: Array<{ id: string; label: string }>;
  }>(`/api/warehouse/proximity-options?${sp}`);
}

export function createWarehouseItem(
  segment: WarehouseSegment,
  body: Record<string, unknown>,
) {
  return apiFetch<{ item: WarehouseNode }>(`/api/warehouse/${segment}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateWarehouseItem(
  segment: WarehouseSegment,
  id: string,
  body: { pickOrder?: number; code?: string; name?: string | null; active?: boolean },
) {
  return apiFetch<{ item: WarehouseNode }>(`/api/warehouse/${segment}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export type LocationFace = "A" | "B";

export interface CreateWarehousePositionBody {
  colunaId?: string;
  setorCode?: string;
  corredorCode?: string;
  estanteCode?: string;
  colunaCode?: string;
  linhaCode?: string;
  linhaName?: string | null;
  face?: LocationFace;
  barcode: string;
  type: "PICK_FACE" | "PULMAO";
  active?: boolean;
  barracaoId?: string | null;
  setorId?: string | null;
  corredorId?: string | null;
  estanteId?: string | null;
}

export function createWarehousePosition(body: CreateWarehousePositionBody) {
  return apiFetch<{
    linha: WarehouseNode;
    location: WarehouseLayoutLocation;
  }>("/api/warehouse/positions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type GenerateEstanteBody = {
  barracaoId: string;
  estanteCode: string;
  ld: { colunas: number; linhas: number };
  le: { colunas: number; linhas: number } | null;
  type: "PICK_FACE" | "PULMAO";
};

export type GenerateEstanteResult = {
  estanteId: string;
  created: number;
  skipped: number;
  relabeled: number;
  errors: Array<{ address: string; message: string }>;
};

export type EstanteSide = { colunas: number; linhas: number };

export type InventoryLayoutRow = { address: string; sku: string };

export type InventoryLayoutEstante = {
  barracao: string;
  estante: string;
  ld: EstanteSide;
  le: EstanteSide | null;
};

export type InventoryLayoutPreview = {
  estantes: Array<InventoryLayoutEstante & { addressCount: number }>;
  assignments: Array<{ code: string; sku: string }>;
  extraSkus: Array<{ code: string; skus: string[] }>;
  invalid: Array<{ row: number; address: string; message: string }>;
  emptyRows: number;
  pulmaoRefs: number;
  missingBarracoes: string[];
};

export type InventoryLayoutResult = {
  estantes: number;
  created: number;
  skipped: number;
  relabeled: number;
  errors: Array<{ address: string; message: string }>;
  skus: { associated: number; unchanged: number; notFound: string[] };
};

export function previewInventoryLayout(rows: InventoryLayoutRow[]) {
  return apiFetch<InventoryLayoutPreview>("/api/warehouse/inventory-layout/preview", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

export function applyInventoryLayout(body: {
  rows: InventoryLayoutRow[];
  estantes: InventoryLayoutEstante[];
}) {
  return apiFetch<InventoryLayoutResult>("/api/warehouse/inventory-layout/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function generateEstante(body: GenerateEstanteBody) {
  return apiFetch<GenerateEstanteResult>("/api/warehouse/estantes/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateWarehousePosition(
  linhaId: string,
  body: Partial<CreateWarehousePositionBody> & {
    linhaActive?: boolean;
    linhaCode?: string;
    linhaName?: string | null;
    productId?: string | null;
    minPercent?: number;
    fillPercent?: number;
  },
) {
  return apiFetch<{ location: WarehouseLayoutLocation }>(
    `/api/warehouse/positions/${linhaId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
}

export interface WarehouseBatchItem {
  code: string;
  name?: string;
  pickOrder?: number;
}

export function batchCreateWarehouseItems(
  segment: WarehouseSegment,
  body: Record<string, unknown> & {
    items: WarehouseBatchItem[];
    pickOrderStart?: number;
  },
) {
  return apiFetch<{
    created: number;
    errors: Array<{ code: string; message: string }>;
    items: WarehouseNode[];
  }>(`/api/warehouse/${segment}/batch`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function reorderWarehouseItems(
  segment: WarehouseSegment,
  items: Array<{ id: string; pickOrder: number }>,
) {
  return apiFetch<{ ok: boolean; updated: number }>(
    `/api/warehouse/${segment}/reorder`,
    {
      method: "PATCH",
      body: JSON.stringify({ items }),
    },
  );
}

/** @deprecated use fetchBarracoesList / fetchWarehouseTree */
export function fetchWarehouseItems(
  segment: WarehouseSegment,
  params?: {
    parentId?: string;
    page?: number;
    pageSize?: number;
    q?: string;
    availableOnly?: boolean;
  },
) {
  const sp = new URLSearchParams();
  if (params?.parentId) sp.set("parentId", params.parentId);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.availableOnly) sp.set("availableOnly", "true");
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    pagination: PaginationMeta;
  } & Record<string, WarehouseNode[]>>(`/api/warehouse/${segment}?${sp}`);
}
