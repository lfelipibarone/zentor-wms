"use client";

import { useEffect, useMemo, useState } from "react";
import {
  updateWarehousePosition,
  type WarehouseLayoutLocation,
  type WarehouseSegment,
  type WarehouseProximityReference,
} from "@/lib/api/warehouse";
import { WarehouseSkuSearchSelect } from "@/components/warehouse/warehouse-sku-search-select";
import {
  WarehouseFormStep,
  WarehouseTilePicker,
} from "@/components/warehouse/warehouse-tile-picker";
import {
  WarehouseProximityReferencesEditor,
  proximityReferencesFromRow,
  serializeProximityReferences,
  type WarehouseProximityReferenceDraft,
} from "@/components/warehouse/warehouse-proximity-references-editor";

export type WarehouseEditRow = {
  id: string;
  segment: WarehouseSegment;
  tipo: string;
  parentPath: string;
  code: string;
  name: string | null;
  ordem: number;
  active: boolean;
  barracaoId?: string;
  setorId?: string;
  corredorId?: string;
  estanteId?: string;
  colunaId?: string;
  isPosition?: boolean;
  location?: WarehouseLayoutLocation;
  barcode?: string;
  locationType?: "PICK_FACE" | "PULMAO";
  productId?: string | null;
  proximityCorredorId?: string | null;
  proximityEstanteId?: string | null;
  proximityLinhaId?: string | null;
  proximityReferences?: WarehouseProximityReference[];
};

export function WarehouseLocationEditModal({
  row,
  onClose,
  onSaved,
}: {
  row: WarehouseEditRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const currentProduct = row.location?.product;
  const [code, setCode] = useState(row.code);
  const [name, setName] = useState(row.name ?? "");
  const [active, setActive] = useState(row.active);
  const [barcode, setBarcode] = useState(row.barcode ?? "");
  const [type, setType] = useState<"PICK_FACE" | "PULMAO">(
    row.locationType ?? "PICK_FACE",
  );
  const [productId, setProductId] = useState(currentProduct?.id ?? "");
  const [capacity, setCapacity] = useState(String(row.location?.capacity ?? 100));
  const [minThreshold, setMinThreshold] = useState(
    String(row.location?.minThreshold ?? 0),
  );
  const [currentQuantity, setCurrentQuantity] = useState(
    String(row.location?.currentQuantity ?? 0),
  );
  const [proximityReferences, setProximityReferences] = useState<
    WarehouseProximityReferenceDraft[]
  >(() => proximityReferencesFromRow(row));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setProductId(currentProduct?.id ?? "");
  }, [currentProduct?.id]);

  useEffect(() => {
    setProximityReferences(proximityReferencesFromRow(row));
  }, [row]);

  const includeProduct = useMemo(
    () =>
      currentProduct?.id
        ? {
            id: currentProduct.id,
            sku: currentProduct.sku,
            name: currentProduct.name ?? null,
          }
        : undefined,
    [currentProduct],
  );

  const fillPct = useMemo(() => {
    const cap = Number(capacity);
    const cur = Number(currentQuantity);
    if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(cur)) return null;
    return Math.round((cur / cap) * 100);
  }, [capacity, currentQuantity]);

  const save = async () => {
    if (!code.trim()) {
      setErr("Informe a linha do endereço");
      return;
    }
    if (!barcode.trim()) {
      setErr("Código de barras obrigatório");
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      await updateWarehousePosition(row.id, {
        linhaCode: code.trim(),
        linhaName: name.trim() || null,
        linhaActive: active,
        barcode: barcode.trim(),
        type,
        productId: productId || null,
        capacity: Number(capacity) || 100,
        minThreshold: Number(minThreshold) || 0,
        currentQuantity: Number(currentQuantity) || 0,
        active,
        proximityReferences: serializeProximityReferences(proximityReferences),
      });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-labelledby="warehouse-location-edit-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2
          id="warehouse-location-edit-title"
          className="text-lg font-bold text-slate-900"
        >
          Editar localização
        </h2>

        <div className="mt-4 space-y-3">
          {row.parentPath ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs">
              {row.parentPath}
            </p>
          ) : null}

          <label className="block text-sm">
            Linha
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              Nível do endereço físico (prateleira/posição na coluna).
            </span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Linha"
            />
          </label>

          <label className="block text-sm">
            Nome (opcional)
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            Código de barras
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              Etiqueta colada no pulmão ou estoque de giro.
            </span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Etiqueta da posição"
            />
          </label>

          <WarehouseFormStep step={1} title="Tipo">
            <WarehouseTilePicker
              title="Pulmão ou estoque de giro"
              options={[
                { id: "PICK_FACE", primary: "Estoque de giro" },
                { id: "PULMAO", primary: "Pulmão" },
              ]}
              value={type}
              onChange={(v) => setType(v as "PICK_FACE" | "PULMAO")}
            />
          </WarehouseFormStep>

          <div className="space-y-1">
            <WarehouseSkuSearchSelect
              title="SKU (opcional)"
              value={productId}
              onChange={setProductId}
              includeProduct={includeProduct}
              placeholder="Buscar SKU ou nome…"
            />
            {productId ? (
              <button
                type="button"
                onClick={() => setProductId("")}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                Remover SKU
              </button>
            ) : null}
          </div>

          {productId ? (
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-sm">
                Capacidade
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Mínimo
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={minThreshold}
                  onChange={(e) => setMinThreshold(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Qtd atual
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={currentQuantity}
                  onChange={(e) => setCurrentQuantity(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {fillPct != null && productId ? (
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>Ocupação</span>
                <span>{fillPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full ${
                    fillPct <= Number(minThreshold) ? "bg-amber-500" : "bg-teal-600"
                  }`}
                  style={{ width: `${Math.min(100, fillPct)}%` }}
                />
              </div>
            </div>
          ) : null}

          <WarehouseFormStep step={2} title="Proximidade (opcional)">
            {row.barracaoId ? (
              <WarehouseProximityReferencesEditor
                barracaoId={row.barracaoId}
                excludeLinhaId={row.id}
                value={proximityReferences}
                onChange={setProximityReferences}
              />
            ) : (
              <p className="text-sm text-slate-500">
                Barracão não identificado para carregar opções de proximidade.
              </p>
            )}
          </WarehouseFormStep>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-slate-300"
            />
            Ativo no layout
          </label>

          {err ? <p className="text-sm text-red-600">{err}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
