"use client";

import { useEffect, useMemo, useState } from "react";
import {
  updateWarehousePosition,
  type LocationFace,
  type WarehouseLayoutLocation,
  type WarehouseSegment,
  type WarehouseProximityReference,
} from "@/lib/api/warehouse";
import { WarehouseSkuSearchSelect } from "@/components/warehouse/warehouse-sku-search-select";
import { FaceToggle } from "@/components/warehouse/face-toggle";
import {
  WarehouseFormStep,
  WarehouseTilePicker,
} from "@/components/warehouse/warehouse-tile-picker";
import { PercentBar } from "@/components/ops/percent-bar";
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
  face?: LocationFace;
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
  const [face, setFace] = useState<LocationFace>(row.face ?? "A");
  const [active, setActive] = useState(row.active);
  const [barcode, setBarcode] = useState(row.barcode ?? "");
  const [type, setType] = useState<"PICK_FACE" | "PULMAO">(
    row.locationType ?? "PICK_FACE",
  );
  const [productId, setProductId] = useState(currentProduct?.id ?? "");
  const [minPercent, setMinPercent] = useState(String(row.location?.minPercent ?? 20));
  const [fillPercent, setFillPercent] = useState(String(row.location?.fillPercent ?? 0));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isPulmao = type === "PULMAO";

  useEffect(() => {
    setProductId(currentProduct?.id ?? "");
  }, [currentProduct?.id]);

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

  const fillValue = Number(fillPercent);
  const percentsValid = [minPercent, fillPercent].every((v) => {
    const n = Number(v);
    return v.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
  });

  const save = async () => {
    if (!code.trim()) {
      setErr("Informe a linha do endereço");
      return;
    }
    if (!barcode.trim()) {
      setErr("Código de barras obrigatório");
      return;
    }
    if (!isPulmao && productId && !percentsValid) {
      setErr("% mínima e % atual devem ser inteiros de 0 a 100");
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      await updateWarehousePosition(row.id, {
        linhaCode: code.trim(),
        linhaName: name.trim() || null,
        linhaActive: active,
        face,
        barcode: barcode.trim(),
        type,
        ...(isPulmao
          ? { productId: null }
          : {
              productId: productId || null,
              ...(productId
                ? { minPercent: Number(minPercent), fillPercent: Number(fillPercent) }
                : {}),
            }),
        active,
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
              Último nível do endereço (estante → coluna → linha).
            </span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Linha"
            />
          </label>

          <FaceToggle value={face} onChange={setFace} />

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

          {isPulmao ? (
            <WarehouseFormStep step={2} title="SKUs no pulmão">
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                O pulmão aceita vários SKUs e não tem SKU fixo. A % de cada SKU é
                registrada na armazenagem pelo aplicativo.
                <span className="mt-1 block font-semibold text-slate-800">
                  Ocupação hoje: {row.location?.fillPercent ?? 0}% (soma dos SKUs)
                </span>
              </p>
            </WarehouseFormStep>
          ) : (
          <WarehouseFormStep step={2} title="SKU associado">
          <div className="space-y-1">
            <WarehouseSkuSearchSelect
              title="SKU nesta posição"
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
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                % mínima (repor)
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={minPercent}
                  onChange={(e) => setMinPercent(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                % atual
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={fillPercent}
                  onChange={(e) => setFillPercent(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {productId && Number.isFinite(fillValue) ? (
            <div>
              <div className="mb-1 text-xs text-slate-600">Ocupação</div>
              <PercentBar percent={fillValue} minPercent={Number(minPercent)} />
            </div>
          ) : null}
          </WarehouseFormStep>
          )}

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
