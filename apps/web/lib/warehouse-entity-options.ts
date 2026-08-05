import type { WarehouseSegment, WarehouseTree } from "@/lib/api/warehouse";

export const WAREHOUSE_ENTITY_OPTIONS: Array<{
  segment: WarehouseSegment;
  label: string;
  parentField?: string;
  parentLabel?: string;
}> = [
  { segment: "barracoes", label: "Barracão" },
  {
    segment: "setores",
    label: "Setor",
    parentField: "barracaoId",
    parentLabel: "Barracão",
  },
  {
    segment: "corredores",
    label: "Corredor",
    parentField: "setorId",
    parentLabel: "Setor",
  },
  {
    segment: "estantes",
    label: "Estante",
    parentField: "corredorId",
    parentLabel: "Corredor",
  },
  {
    segment: "colunas",
    label: "Coluna",
    parentField: "estanteId",
    parentLabel: "Estante",
  },
  {
    segment: "linhas",
    label: "Linha",
    parentField: "colunaId",
    parentLabel: "Coluna",
  },
];

export interface WarehouseLayoutLocation {
  id: string;
  type: "PICK_FACE" | "PULMAO";
  barcode: string;
  capacity: number;
  minThreshold: number;
  currentQuantity: number;
  product?: { sku: string; name: string } | null;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
}

export function flattenWarehouseLayoutOptions(trees: WarehouseTree[]) {
  const setores: Array<{ id: string; label: string; barracaoId: string }> = [];
  const corredores: Array<{ id: string; label: string; setorId: string }> = [];
  const estantes: Array<{ id: string; label: string; corredorId: string }> = [];
  const colunas: Array<{ id: string; label: string; estanteId: string }> = [];
  const linhas: Array<{ id: string; label: string; colunaId: string }> = [];

  for (const b of trees) {
    for (const s of b.setores) {
      setores.push({
        id: s.id,
        barracaoId: b.id,
        label: `${b.code} / ${s.code}${s.name ? ` — ${s.name}` : ""}`,
      });
      for (const c of s.corredores) {
        corredores.push({
          id: c.id,
          setorId: s.id,
          label: `${b.code} / ${s.code} / ${c.code}`,
        });
        for (const e of c.estantes) {
          estantes.push({
            id: e.id,
            corredorId: c.id,
            label: `${b.code} / ${s.code} / ${c.code} / ${e.code}`,
          });
          for (const col of e.colunas) {
            colunas.push({
              id: col.id,
              estanteId: e.id,
              label: `${b.code} / ${s.code} / ${c.code} / ${e.code} / ${col.code}`,
            });
            for (const l of col.linhas) {
              linhas.push({
                id: l.id,
                colunaId: col.id,
                label: `${b.code} / ${s.code} / ${c.code} / ${e.code} / ${col.code} / ${l.code}`,
              });
            }
          }
        }
      }
    }
  }

  return { setores, corredores, estantes, colunas, linhas };
}

export function getAvailableWarehouseEntityOptions(trees: WarehouseTree[]) {
  const flat = flattenWarehouseLayoutOptions(trees);
  return WAREHOUSE_ENTITY_OPTIONS.filter((e) => {
    switch (e.segment) {
      case "barracoes":
        return true;
      case "setores":
        return trees.length > 0;
      case "corredores":
        return flat.setores.length > 0;
      case "estantes":
        return flat.corredores.length > 0;
      case "colunas":
        return flat.estantes.length > 0;
      case "linhas":
        return flat.colunas.length > 0;
      default:
        return false;
    }
  });
}

export function getWarehouseParentOptions(
  segment: WarehouseSegment,
  trees: WarehouseTree[],
  flat: ReturnType<typeof flattenWarehouseLayoutOptions>,
) {
  switch (segment) {
    case "setores":
      return trees.map((b) => ({
        id: b.id,
        label: `${b.code}${b.name ? ` — ${b.name}` : ""}`,
      }));
    case "corredores":
      return flat.setores.map((s) => ({ id: s.id, label: s.label }));
    case "estantes":
      return flat.corredores.map((c) => ({ id: c.id, label: c.label }));
    case "colunas":
      return flat.estantes.map((e) => ({ id: e.id, label: e.label }));
    case "linhas":
      return flat.colunas.map((c) => ({ id: c.id, label: c.label }));
    default:
      return [];
  }
}

export function getProximityOptions(
  trees: WarehouseTree[],
  barracaoId: string,
  excludeLinhaId?: string,
) {
  const barracao = trees.find((b) => b.id === barracaoId);
  if (!barracao) {
    return { corredores: [], estantes: [], linhas: [] };
  }

  const corredores: Array<{ id: string; label: string }> = [];
  const estantes: Array<{ id: string; label: string }> = [];
  const linhas: Array<{ id: string; label: string }> = [];

  for (const s of barracao.setores) {
    for (const c of s.corredores) {
      corredores.push({
        id: c.id,
        label: `${s.code} / ${c.code}`,
      });
      for (const e of c.estantes) {
        estantes.push({
          id: e.id,
          label: `${s.code} / ${c.code} / ${e.code}`,
        });
        for (const col of e.colunas) {
          for (const l of col.linhas) {
            if (l.id !== excludeLinhaId) {
              linhas.push({
                id: l.id,
                label: `${s.code} / ${c.code} / ${e.code} / ${col.code} / ${l.code}`,
              });
            }
          }
        }
      }
    }
  }

  return { corredores, estantes, linhas };
}
