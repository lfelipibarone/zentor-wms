import type { WarehouseEditRow } from "@/components/warehouse/warehouse-location-edit-modal";
import type {
  WarehouseLinhaNode,
  WarehouseSegment,
  WarehouseTree,
} from "@/lib/api/warehouse";

export type LayoutTipo =
  | "Barracão"
  | "Setor"
  | "Corredor"
  | "Estante"
  | "Coluna"
  | "Linha";

export type LayoutRow = WarehouseEditRow & {
  siblingGroupKey: string;
  barracaoId: string;
  barracao: string;
  setor: string;
  corredor: string;
  estante: string;
  coluna: string;
  linha: string;
  sku: string;
  capacity: number | null;
  minThreshold: number | null;
  currentQuantity: number | null;
  fillPct: number | null;
  isPosition: boolean;
};

export const TIPO_TO_SEGMENT: Record<LayoutTipo, WarehouseSegment> = {
  Barracão: "barracoes",
  Setor: "setores",
  Corredor: "corredores",
  Estante: "estantes",
  Coluna: "colunas",
  Linha: "linhas",
};

export const EMPTY = "—";

export function locationTypeLabel(type?: "PICK_FACE" | "PULMAO") {
  if (type === "PICK_FACE") return "Estoque de giro";
  if (type === "PULMAO") return "Pulmão";
  return EMPTY;
}

/** Rótulo do tipo de localização (pulmão ou estoque de giro). */
export function locationPositionLabel(row: {
  locationType?: "PICK_FACE" | "PULMAO";
}) {
  return locationTypeLabel(row.locationType);
}

export function flattenWarehouseTrees(trees: WarehouseTree[]): LayoutRow[] {
  const rows: LayoutRow[] = [];

  for (const barracao of trees) {
    rows.push({
      id: barracao.id,
      segment: TIPO_TO_SEGMENT["Barracão"],
      siblingGroupKey: "tenant",
      tipo: "Barracão",
      parentPath: "",
      code: barracao.code,
      name: barracao.name,
      ordem: barracao.pickOrder,
      active: barracao.active,
      barracaoId: barracao.id,
      barracao: barracao.code,
      setor: EMPTY,
      corredor: EMPTY,
      estante: EMPTY,
      coluna: EMPTY,
      linha: EMPTY,
      sku: EMPTY,
      capacity: null,
      minThreshold: null,
      currentQuantity: null,
      fillPct: null,
      isPosition: false,
    });

    for (const setor of barracao.setores) {
      rows.push({
        id: setor.id,
        segment: TIPO_TO_SEGMENT["Setor"],
        siblingGroupKey: `barracao:${barracao.id}`,
        tipo: "Setor",
        parentPath: barracao.code,
        code: setor.code,
        name: setor.name,
        ordem: setor.pickOrder,
        active: setor.active,
        barracaoId: barracao.id,
        barracao: barracao.code,
        setor: setor.code,
        corredor: EMPTY,
        estante: EMPTY,
        coluna: EMPTY,
        linha: EMPTY,
        sku: EMPTY,
        capacity: null,
        minThreshold: null,
        currentQuantity: null,
        fillPct: null,
        isPosition: false,
      });

      for (const corredor of setor.corredores) {
        rows.push({
          id: corredor.id,
          segment: TIPO_TO_SEGMENT["Corredor"],
          siblingGroupKey: `setor:${setor.id}`,
          tipo: "Corredor",
          parentPath: `${barracao.code} / ${setor.code}`,
          code: corredor.code,
          name: corredor.name,
          ordem: corredor.pickOrder,
          active: corredor.active,
          barracaoId: barracao.id,
          barracao: barracao.code,
          setor: setor.code,
          corredor: corredor.code,
          estante: EMPTY,
          coluna: EMPTY,
          linha: EMPTY,
          sku: EMPTY,
          capacity: null,
          minThreshold: null,
          currentQuantity: null,
          fillPct: null,
          isPosition: false,
        });

        for (const estante of corredor.estantes) {
          rows.push({
            id: estante.id,
            segment: TIPO_TO_SEGMENT["Estante"],
            siblingGroupKey: `corredor:${corredor.id}`,
            tipo: "Estante",
            parentPath: `${barracao.code} / ${setor.code} / ${corredor.code}`,
            code: estante.code,
            name: estante.name,
            ordem: estante.pickOrder,
            active: estante.active,
            barracaoId: barracao.id,
            barracao: barracao.code,
            setor: setor.code,
            corredor: corredor.code,
            estante: estante.code,
            coluna: EMPTY,
            linha: EMPTY,
            sku: EMPTY,
            capacity: null,
            minThreshold: null,
            currentQuantity: null,
            fillPct: null,
            isPosition: false,
          });

          for (const coluna of estante.colunas) {
            rows.push({
              id: coluna.id,
              segment: TIPO_TO_SEGMENT["Coluna"],
              siblingGroupKey: `estante:${estante.id}`,
              tipo: "Coluna",
              parentPath: `${barracao.code} / ${setor.code} / ${corredor.code} / ${estante.code}`,
              code: coluna.code,
              name: coluna.name,
              ordem: coluna.pickOrder,
              active: coluna.active,
              barracaoId: barracao.id,
              barracao: barracao.code,
              setor: setor.code,
              corredor: corredor.code,
              estante: estante.code,
              coluna: coluna.code,
              linha: EMPTY,
              sku: EMPTY,
              capacity: null,
              minThreshold: null,
              currentQuantity: null,
              fillPct: null,
              isPosition: false,
            });

            for (const linha of coluna.linhas) {
              rows.push(
                positionRow(barracao, setor, corredor, estante, coluna, linha),
              );
            }
          }
        }
      }
    }
  }

  return rows;
}

function positionRow(
  barracao: WarehouseTree,
  setor: WarehouseTree["setores"][0],
  corredor: WarehouseTree["setores"][0]["corredores"][0],
  estante: WarehouseTree["setores"][0]["corredores"][0]["estantes"][0],
  coluna: WarehouseTree["setores"][0]["corredores"][0]["estantes"][0]["colunas"][0],
  linha: WarehouseLinhaNode,
): LayoutRow {
  const loc = linha.location;
  const capacity = loc?.capacity ?? null;
  const current = loc?.currentQuantity ?? null;
  const fillPct =
    capacity != null && current != null && capacity > 0
      ? Math.round((current / capacity) * 100)
      : null;

  return {
    id: linha.id,
    segment: TIPO_TO_SEGMENT["Linha"],
    siblingGroupKey: `coluna:${coluna.id}`,
    tipo: "Linha",
    parentPath: `${barracao.code} / ${setor.code} / ${corredor.code} / ${estante.code} / ${coluna.code}`,
    code: linha.code,
    name: linha.name,
    ordem: linha.pickOrder,
    active: linha.active,
    barracaoId: barracao.id,
    barracao: barracao.code,
    setor: setor.code,
    corredor: corredor.code,
    estante: estante.code,
    coluna: coluna.code,
    linha: linha.code,
    sku: loc?.product?.sku ?? EMPTY,
    capacity,
    minThreshold: loc?.minThreshold ?? null,
    currentQuantity: current,
    fillPct,
    isPosition: true,
    location: loc ?? undefined,
    barcode: loc?.barcode,
    locationType: loc?.type,
    productId: loc?.product ? undefined : null,
    proximityCorredorId: loc?.proximityCorredorId,
    proximityEstanteId: loc?.proximityEstanteId,
    proximityLinhaId: loc?.proximityLinhaId,
    proximityReferences: loc?.proximityReferences,
    estanteId: estante.id,
    colunaId: coluna.id,
    setorId: setor.id,
    corredorId: corredor.id,
  };
}

export function filterLayoutRows(
  rows: LayoutRow[],
  opts: { barracaoId?: string; q?: string; skuTab?: boolean },
): LayoutRow[] {
  const q = opts.q?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (opts.barracaoId && row.barracaoId !== opts.barracaoId) return false;

    if (opts.skuTab) {
      if (
        !row.isPosition ||
        row.locationType !== "PICK_FACE" ||
        !row.location?.product
      ) {
        return false;
      }
    }

    if (!q) return true;

    if (opts.skuTab) {
      return (
        row.sku.toLowerCase().includes(q) ||
        (row.location?.product?.name?.toLowerCase().includes(q) ?? false) ||
        row.barracao.toLowerCase().includes(q) ||
        row.setor.toLowerCase().includes(q) ||
        row.corredor.toLowerCase().includes(q) ||
        row.estante.toLowerCase().includes(q) ||
        row.coluna.toLowerCase().includes(q) ||
        row.linha.toLowerCase().includes(q) ||
        (row.barcode?.toLowerCase().includes(q) ?? false)
      );
    }

    return (
      row.code.toLowerCase().includes(q) ||
      (row.name?.toLowerCase().includes(q) ?? false) ||
      row.barracao.toLowerCase().includes(q) ||
      row.setor.toLowerCase().includes(q) ||
      row.corredor.toLowerCase().includes(q) ||
      row.estante.toLowerCase().includes(q) ||
      row.coluna.toLowerCase().includes(q) ||
      row.linha.toLowerCase().includes(q) ||
      (row.barcode?.toLowerCase().includes(q) ?? false)
    );
  });
}
