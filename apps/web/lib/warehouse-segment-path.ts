import type { WarehouseSegment } from "@/lib/api/warehouse";
import type { TileOption } from "@/components/warehouse/warehouse-tile-picker";
import { locationTypeLabel } from "@/lib/warehouse-layout-rows";

type BarracaoRef = { id?: string; code: string; name?: string | null };
type SetorRef = {
  id?: string;
  code: string;
  barracaoId?: string;
  barracao?: BarracaoRef;
};
type CorredorRef = {
  id?: string;
  code: string;
  setorId?: string;
  setor?: SetorRef;
};
type EstanteRef = {
  id?: string;
  code: string;
  corredorId?: string;
  corredor?: CorredorRef;
};
type ColunaRef = {
  id?: string;
  code: string;
  estanteId?: string;
  estante?: EstanteRef;
};
type LinhaRef = {
  id: string;
  code: string;
  name?: string | null;
  colunaId?: string;
  coluna?: ColunaRef;
  location?: {
    type: string;
    barcode: string;
    product?: { sku: string } | null;
  } | null;
};

export type WarehouseSegmentPathItem = {
  id: string;
  code: string;
  name?: string | null;
  barracaoId?: string;
  setorId?: string;
  corredorId?: string;
  estanteId?: string;
  colunaId?: string;
  barracao?: BarracaoRef;
  setor?: SetorRef;
  corredor?: CorredorRef;
  estante?: EstanteRef;
  coluna?: ColunaRef;
  location?: LinhaRef["location"];
};

export type WarehouseHierarchyIds = {
  barracaoId?: string;
  setorId?: string;
  corredorId?: string;
  estanteId?: string;
  colunaId?: string;
  linhaId?: string;
  linhaCode?: string;
  linhaName?: string;
};

function joinPath(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" / ");
}

export function hierarchyFromBarracao(item: WarehouseSegmentPathItem): WarehouseHierarchyIds {
  return { barracaoId: item.id };
}

export function hierarchyFromSetor(item: WarehouseSegmentPathItem): WarehouseHierarchyIds {
  return {
    barracaoId: item.barracaoId ?? item.barracao?.id,
    setorId: item.id,
  };
}

export function hierarchyFromCorredor(item: WarehouseSegmentPathItem): WarehouseHierarchyIds {
  return {
    barracaoId: item.setor?.barracaoId ?? item.setor?.barracao?.id,
    setorId: item.setorId ?? item.setor?.id,
    corredorId: item.id,
  };
}

export function hierarchyFromEstante(item: WarehouseSegmentPathItem): WarehouseHierarchyIds {
  return {
    barracaoId:
      item.corredor?.setor?.barracaoId ?? item.corredor?.setor?.barracao?.id,
    setorId: item.corredor?.setorId ?? item.corredor?.setor?.id,
    corredorId: item.corredorId ?? item.corredor?.id,
    estanteId: item.id,
  };
}

export function hierarchyFromColuna(item: WarehouseSegmentPathItem): WarehouseHierarchyIds {
  const estante = item.estante;
  const corredor = estante?.corredor;
  const setor = corredor?.setor;
  return {
    barracaoId: setor?.barracaoId ?? setor?.barracao?.id,
    setorId: corredor?.setorId ?? setor?.id,
    corredorId: estante?.corredorId ?? corredor?.id,
    estanteId: item.estanteId ?? estante?.id,
    colunaId: item.id,
  };
}

export function hierarchyFromLinha(item: WarehouseSegmentPathItem): WarehouseHierarchyIds {
  const base = item.coluna
    ? hierarchyFromColuna({
        id: item.coluna.id ?? item.colunaId ?? "",
        code: item.coluna.code,
        estanteId: item.coluna.estanteId,
        estante: item.coluna.estante,
      })
    : {};
  return {
    ...base,
    colunaId: item.colunaId ?? item.coluna?.id ?? base.colunaId,
    linhaId: item.id,
    linhaCode: item.code,
    linhaName: item.name ?? "",
  };
}

export function hierarchyFromSegment(
  segment: WarehouseSegment,
  item: WarehouseSegmentPathItem,
): WarehouseHierarchyIds {
  switch (segment) {
    case "barracoes":
      return hierarchyFromBarracao(item);
    case "setores":
      return hierarchyFromSetor(item);
    case "corredores":
      return hierarchyFromCorredor(item);
    case "estantes":
      return hierarchyFromEstante(item);
    case "colunas":
      return hierarchyFromColuna(item);
    case "linhas":
      return hierarchyFromLinha(item);
    default:
      return {};
  }
}

export function segmentItemToTile(
  segment: WarehouseSegment,
  item: WarehouseSegmentPathItem,
): TileOption {
  if (segment === "barracoes") {
    return {
      id: item.id,
      primary: item.code,
      secondary: item.name ?? undefined,
    };
  }

  if (segment === "setores") {
    return {
      id: item.id,
      primary: item.code,
      secondary: joinPath([item.barracao?.code, item.name]),
    };
  }

  if (segment === "corredores") {
    return {
      id: item.id,
      primary: item.code,
      secondary: joinPath([item.setor?.barracao?.code, item.setor?.code]),
    };
  }

  if (segment === "estantes") {
    return {
      id: item.id,
      primary: item.code,
      secondary: joinPath([
        item.corredor?.setor?.barracao?.code,
        item.corredor?.setor?.code,
        item.corredor?.code,
      ]),
    };
  }

  if (segment === "colunas") {
    return {
      id: item.id,
      primary: item.code,
      secondary: joinPath([
        item.estante?.corredor?.setor?.barracao?.code,
        item.estante?.corredor?.setor?.code,
        item.estante?.corredor?.code,
        item.estante?.code,
      ]),
    };
  }

  const loc = item.location;
  let secondary = joinPath([
    item.coluna?.estante?.corredor?.setor?.barracao?.code,
    item.coluna?.estante?.corredor?.setor?.code,
    item.coluna?.estante?.corredor?.code,
    item.coluna?.estante?.code,
    item.coluna?.code,
  ]);
  if (loc) {
    const tipo = locationTypeLabel(loc.type as "PICK_FACE" | "PULMAO");
    const extra =
      loc.type === "PICK_FACE" && loc.product?.sku ? ` · ${loc.product.sku}` : "";
    secondary = `${secondary} · ${tipo} · ${loc.barcode}${extra}`;
  }

  return {
    id: item.id,
    primary: item.code,
    secondary: secondary || item.name || undefined,
    disabled: Boolean(loc),
    disabledHint: loc ? "Posição já cadastrada" : undefined,
  };
}
