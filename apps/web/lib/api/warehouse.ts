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

export interface WarehouseFileiraNode extends WarehouseNode {
  corredorId?: string;
}

export interface WarehouseColunaNode extends WarehouseNode {
  prateleiraId?: string;
}

export interface WarehousePrateleiraNode extends WarehouseNode {
  colunas: WarehouseColunaNode[];
}

export interface WarehouseEstanteNode extends WarehouseNode {
  prateleiras: WarehousePrateleiraNode[];
}

export interface WarehouseCorredorNode extends WarehouseNode {
  fileiras: WarehouseFileiraNode[];
}

export interface WarehouseSetorNode extends WarehouseNode {
  corredores: WarehouseCorredorNode[];
  estantes: WarehouseEstanteNode[];
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

export type WarehouseSegment =
  | "barracoes"
  | "setores"
  | "corredores"
  | "fileiras"
  | "estantes"
  | "prateleiras"
  | "colunas";

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

export function createWarehouseItem(
  segment: WarehouseSegment,
  body: Record<string, unknown>,
) {
  return apiFetch<{ item: WarehouseNode }>(`/api/warehouse/${segment}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** @deprecated use fetchBarracoesList / fetchWarehouseTree */
export function fetchWarehouseItems(
  segment: WarehouseSegment,
  params?: { parentId?: string; page?: number; pageSize?: number },
) {
  const sp = new URLSearchParams();
  if (params?.parentId) sp.set("parentId", params.parentId);
  if (params?.page) sp.set("page", String(params.page));
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    [key: string]: WarehouseNode[];
    pagination: PaginationMeta;
  }>(`/api/warehouse/${segment}?${sp}`);
}
