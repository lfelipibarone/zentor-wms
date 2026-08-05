"use client";

import { useEffect, useMemo, useState } from "react";
import {
  WarehouseOptionPicker,
  splitPathLabel,
  type TileOption,
} from "@/components/warehouse/warehouse-tile-picker";
import {
  fetchWarehouseProximityOptions,
  type WarehouseProximityReference,
} from "@/lib/api/warehouse";

export type WarehouseProximityReferenceDraft = {
  proximityCorredorId: string;
  proximityEstanteId: string;
  proximityLinhaId: string;
};

const EMPTY_REFERENCE: WarehouseProximityReferenceDraft = {
  proximityCorredorId: "",
  proximityEstanteId: "",
  proximityLinhaId: "",
};

function toTileOptions(
  items: Array<{ id: string; label: string }>,
  emptyLabel: string,
): TileOption[] {
  return [
    { id: "", primary: emptyLabel },
    ...items.map((item) => {
      const { primary, secondary } = splitPathLabel(item.label);
      return { id: item.id, primary, secondary };
    }),
  ];
}

export function WarehouseProximityReferencesEditor({
  barracaoId,
  excludeLinhaId,
  value,
  onChange,
}: {
  barracaoId: string;
  excludeLinhaId?: string;
  value: WarehouseProximityReferenceDraft[];
  onChange: (value: WarehouseProximityReferenceDraft[]) => void;
}) {
  const [proximity, setProximity] = useState<{
    corredores: Array<{ id: string; label: string }>;
    estantes: Array<{ id: string; label: string }>;
    linhas: Array<{ id: string; label: string }>;
  }>({ corredores: [], estantes: [], linhas: [] });

  useEffect(() => {
    if (!barracaoId) {
      setProximity({ corredores: [], estantes: [], linhas: [] });
      return;
    }
    fetchWarehouseProximityOptions(barracaoId, excludeLinhaId)
      .then(setProximity)
      .catch(() => setProximity({ corredores: [], estantes: [], linhas: [] }));
  }, [barracaoId, excludeLinhaId]);

  const corredorTiles = useMemo(
    () => toTileOptions(proximity.corredores, "Nenhum"),
    [proximity.corredores],
  );
  const estanteTiles = useMemo(
    () => toTileOptions(proximity.estantes, "Nenhuma"),
    [proximity.estantes],
  );
  const linhaTiles = useMemo(
    () => toTileOptions(proximity.linhas, "Nenhuma"),
    [proximity.linhas],
  );

  const updateReference = (
    index: number,
    patch: Partial<WarehouseProximityReferenceDraft>,
  ) => {
    onChange(
      value.map((ref, i) => (i === index ? { ...ref, ...patch } : ref)),
    );
  };

  const addReference = () => {
    onChange([...value, { ...EMPTY_REFERENCE }]);
  };

  const removeReference = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhuma referência de proximidade. Adicione se quiser vincular esta
          posição a corredores, estantes ou linhas vizinhas.
        </p>
      ) : null}

      {value.map((ref, index) => (
        <div
          key={index}
          className="space-y-3 rounded-xl border bg-white p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">
              Referência {index + 1}
            </p>
            <button
              type="button"
              onClick={() => removeReference(index)}
              className="text-xs text-red-600 underline hover:text-red-700"
            >
              Remover
            </button>
          </div>
          <WarehouseOptionPicker
            title="Corredor de referência"
            options={corredorTiles}
            value={ref.proximityCorredorId}
            onChange={(proximityCorredorId) =>
              updateReference(index, { proximityCorredorId })
            }
            preferSearch
          />
          <WarehouseOptionPicker
            title="Estante de referência"
            options={estanteTiles}
            value={ref.proximityEstanteId}
            onChange={(proximityEstanteId) =>
              updateReference(index, { proximityEstanteId })
            }
            preferSearch
          />
          <WarehouseOptionPicker
            title="Linha vizinha"
            options={linhaTiles}
            value={ref.proximityLinhaId}
            onChange={(proximityLinhaId) =>
              updateReference(index, { proximityLinhaId })
            }
            preferSearch
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addReference}
        className="text-sm font-medium text-[#0d9488] underline"
      >
        + Adicionar referência
      </button>
    </div>
  );
}

export function serializeProximityReferences(
  refs: WarehouseProximityReferenceDraft[],
): WarehouseProximityReference[] {
  return refs
    .map((ref) => ({
      proximityCorredorId: ref.proximityCorredorId.trim() || null,
      proximityEstanteId: ref.proximityEstanteId.trim() || null,
      proximityLinhaId: ref.proximityLinhaId.trim() || null,
    }))
    .filter(
      (ref) =>
        ref.proximityCorredorId ||
        ref.proximityEstanteId ||
        ref.proximityLinhaId,
    );
}

export function proximityReferencesFromRow(input: {
  proximityReferences?: WarehouseProximityReference[] | null;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
}): WarehouseProximityReferenceDraft[] {
  if (input.proximityReferences && input.proximityReferences.length > 0) {
    return input.proximityReferences.map((ref) => ({
      proximityCorredorId: ref.proximityCorredorId ?? "",
      proximityEstanteId: ref.proximityEstanteId ?? "",
      proximityLinhaId: ref.proximityLinhaId ?? "",
    }));
  }

  if (
    input.proximityCorredorId ||
    input.proximityEstanteId ||
    input.proximityLinhaId
  ) {
    return [
      {
        proximityCorredorId: input.proximityCorredorId ?? "",
        proximityEstanteId: input.proximityEstanteId ?? "",
        proximityLinhaId: input.proximityLinhaId ?? "",
      },
    ];
  }

  return [];
}
