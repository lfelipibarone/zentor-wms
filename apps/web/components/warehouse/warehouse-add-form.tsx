"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataState } from "@/components/ops/data-state";
import { WarehouseSkuSearchSelect } from "@/components/warehouse/warehouse-sku-search-select";
import { WarehouseAddressCodeField } from "@/components/warehouse/warehouse-address-code-field";
import { WarehouseBarracaoCreateForm } from "@/components/warehouse/warehouse-barracao-create-form";
import {
  WarehouseFormStep,
  WarehouseOptionPicker,
  type TileOption,
} from "@/components/warehouse/warehouse-tile-picker";
import {
  WarehouseProximityReferencesEditor,
  serializeProximityReferences,
  type WarehouseProximityReferenceDraft,
} from "@/components/warehouse/warehouse-proximity-references-editor";
import {
  createWarehousePosition,
  fetchBarracoesList,
  type WarehouseBarracaoOption,
  type WarehouseSegment,
} from "@/lib/api/warehouse";
import {
  hierarchyFromSegment,
  type WarehouseSegmentPathItem,
} from "@/lib/warehouse-segment-path";

const ADDRESS_LEVELS: Array<{
  title: string;
  key: "setor" | "corredor" | "estante" | "coluna" | "linha";
  segment?: WarehouseSegment;
  parentKey?: "barracaoId" | "setorId" | "corredorId" | "estanteId" | "colunaId";
}> = [
  { title: "Setor", key: "setor", segment: "setores", parentKey: "barracaoId" },
  { title: "Corredor", key: "corredor", segment: "corredores", parentKey: "setorId" },
  { title: "Estante", key: "estante", segment: "estantes", parentKey: "corredorId" },
  { title: "Coluna", key: "coluna", segment: "colunas", parentKey: "estanteId" },
  { title: "Linha", key: "linha", segment: "linhas", parentKey: "colunaId" },
];

export function WarehouseAddForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialBarracaoId = searchParams.get("barracaoId")?.trim() ?? "";
  const initialTipo = searchParams.get("tipo")?.toLowerCase();
  const initialPositionType =
    initialTipo === "pulmao" || initialTipo === "pulmão"
      ? "PULMAO"
      : initialTipo === "pick_face" ||
          initialTipo === "sku" ||
          initialTipo === "estoque-de-giro"
        ? "PICK_FACE"
        : null;

  const [barracoes, setBarracoes] = useState<WarehouseBarracaoOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [barracaoId, setBarracaoId] = useState("");
  const [setorId, setSetorId] = useState("");
  const [corredorId, setCorredorId] = useState("");
  const [estanteId, setEstanteId] = useState("");
  const [colunaId, setColunaId] = useState("");
  const [setorCode, setSetorCode] = useState("");
  const [corredorCode, setCorredorCode] = useState("");
  const [estanteCode, setEstanteCode] = useState("");
  const [colunaCode, setColunaCode] = useState("");
  const [linhaCode, setLinhaCode] = useState("");

  const [barcode, setBarcode] = useState("");
  const [productId, setProductId] = useState("");
  const [capacity, setCapacity] = useState("100");
  const [minThreshold, setMinThreshold] = useState("10");
  const [currentQuantity, setCurrentQuantity] = useState("0");
  const [proximityReferences, setProximityReferences] = useState<
    WarehouseProximityReferenceDraft[]
  >([]);

  const [positionType, setPositionType] = useState<"PICK_FACE" | "PULMAO" | null>(
    initialPositionType,
  );
  const [showNewBarracao, setShowNewBarracao] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPickFace = positionType === "PICK_FACE";
  const isPulmao = positionType === "PULMAO";

  useEffect(() => {
    if (initialBarracaoId) setBarracaoId(initialBarracaoId);
  }, [initialBarracaoId]);

  const loadBarracoes = async () => {
    const { barracoes: data } = await fetchBarracoesList();
    setBarracoes(data);
    return data;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadBarracoes()
      .then((data) => {
        if (!cancelled) {
          if (!barracaoId && !initialBarracaoId && data.length > 0) {
            setBarracaoId(data[0]!.id);
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Erro ao carregar layout");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialBarracaoId]);

  const addressValues = {
    setor: setorCode,
    corredor: corredorCode,
    estante: estanteCode,
    coluna: colunaCode,
    linha: linhaCode,
  };

  const setAddressValue = (key: keyof typeof addressValues, value: string) => {
    const normalized = value.toUpperCase();
    if (key === "setor") {
      setSetorCode(normalized);
      setSetorId("");
    }
    if (key === "corredor") {
      setCorredorCode(normalized);
      setCorredorId("");
    }
    if (key === "estante") {
      setEstanteCode(normalized);
      setEstanteId("");
    }
    if (key === "coluna") {
      setColunaCode(normalized);
      setColunaId("");
    }
    if (key === "linha") setLinhaCode(normalized);
  };

  const applySegmentSelection = (
    segment: WarehouseSegment,
    item: WarehouseSegmentPathItem,
  ) => {
    const hierarchy = hierarchyFromSegment(segment, item);
    if (hierarchy.barracaoId) setBarracaoId(hierarchy.barracaoId);
    if (hierarchy.setorId) setSetorId(hierarchy.setorId);
    if (hierarchy.corredorId) setCorredorId(hierarchy.corredorId);
    if (hierarchy.estanteId) setEstanteId(hierarchy.estanteId);
    if (hierarchy.colunaId) setColunaId(hierarchy.colunaId);
    if (segment === "setores") setSetorCode(item.code.toUpperCase());
    if (segment === "corredores") setCorredorCode(item.code.toUpperCase());
    if (segment === "estantes") setEstanteCode(item.code.toUpperCase());
    if (segment === "colunas") setColunaCode(item.code.toUpperCase());
    if (segment === "linhas") setLinhaCode(item.code.toUpperCase());
  };

  const parentIds = {
    barracaoId,
    setorId,
    corredorId,
    estanteId,
    colunaId,
  };

  const selectedIds = {
    setor: setorId,
    corredor: corredorId,
    estante: estanteId,
    coluna: colunaId,
    linha: "",
  };

  const barracaoTiles = useMemo<TileOption[]>(
    () =>
      barracoes.map((b) => ({
        id: b.id,
        primary: b.code,
        secondary: b.name ?? undefined,
      })),
    [barracoes],
  );

  const fillPct = useMemo(() => {
    const cap = Number(capacity);
    const cur = Number(currentQuantity);
    if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(cur)) return null;
    return Math.round((cur / cap) * 100);
  }, [capacity, currentQuantity]);

  const validateAndSave = async () => {
    if (!positionType) {
      setErr("Selecione o tipo (Pulmão ou Estoque de giro)");
      return;
    }
    if (!barracaoId) {
      setErr("Selecione o barracão");
      return;
    }
    if (!barcode.trim()) {
      setErr("Código de barras obrigatório");
      return;
    }

    const hasAddress =
      setorCode.trim() ||
      corredorCode.trim() ||
      estanteCode.trim() ||
      colunaCode.trim() ||
      linhaCode.trim() ||
      colunaId;

    if (!hasAddress) {
      setErr("Informe ao menos um nível do endereço");
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      await createWarehousePosition({
        barracaoId,
        colunaId: colunaId || undefined,
        setorCode: setorCode.trim() || undefined,
        corredorCode: corredorCode.trim() || undefined,
        estanteCode: estanteCode.trim() || undefined,
        colunaCode: colunaCode.trim() || undefined,
        linhaCode: linhaCode.trim() || undefined,
        barcode: barcode.trim(),
        type: positionType,
        productId: productId || null,
        capacity: Number(capacity) || 100,
        minThreshold: Number(minThreshold) || 0,
        currentQuantity: Number(currentQuantity) || 0,
        proximityReferences: serializeProximityReferences(proximityReferences),
      });
      router.push("/gestao-barracao");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar");
      setSaving(false);
    }
  };

  return (
    <DataState loading={loading} error={loadError}>
      <div className="mx-auto max-w-6xl space-y-4">
        <WarehouseFormStep step={1} title="Tipo de localização">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPositionType("PULMAO")}
              className={`rounded-xl border p-4 text-left transition-colors ${
                isPulmao
                  ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
                  : "bg-white hover:border-violet-200 hover:bg-violet-50/40"
              }`}
            >
              <p className="font-semibold text-slate-900">Pulmão</p>
            </button>
            <button
              type="button"
              onClick={() => setPositionType("PICK_FACE")}
              className={`rounded-xl border p-4 text-left transition-colors ${
                isPickFace
                  ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300"
                  : "bg-white hover:border-teal-200 hover:bg-teal-50/40"
              }`}
            >
              <p className="font-semibold text-slate-900">Estoque de giro</p>
            </button>
          </div>
        </WarehouseFormStep>

        {positionType ? (
          <>
            <WarehouseFormStep step={2} title="Barracão">
              {barracoes.length === 0 && !showNewBarracao ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Nenhum barracão cadastrado. Crie o primeiro para continuar.
                  </p>
                  <WarehouseBarracaoCreateForm
                    onCreated={async (b) => {
                      const data = await loadBarracoes();
                      const created = data.find((x) => x.id === b.id) ?? {
                        ...b,
                        pickOrder: 0,
                        active: true,
                      };
                      setBarracaoId(created.id);
                      setShowNewBarracao(false);
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <WarehouseOptionPicker
                    title="Selecionar barracão"
                    options={barracaoTiles}
                    value={barracaoId}
                    onChange={setBarracaoId}
                  />
                  {showNewBarracao ? (
                    <WarehouseBarracaoCreateForm
                      compact
                      onCancel={() => setShowNewBarracao(false)}
                      onCreated={async (b) => {
                        const data = await loadBarracoes();
                        const created = data.find((x) => x.id === b.id) ?? {
                          ...b,
                          pickOrder: 0,
                          active: true,
                        };
                        setBarracaoId(created.id);
                        setShowNewBarracao(false);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowNewBarracao(true)}
                      className="text-sm font-medium text-[#0d9488] underline"
                    >
                      + Cadastrar novo barracão
                    </button>
                  )}
                </div>
              )}
            </WarehouseFormStep>

            <WarehouseFormStep step={3} title="Endereço">
              <p className="mb-3 text-xs text-slate-500">
                Endereço físico no barracão (setor, corredor, estante, coluna e linha).
                Preencha apenas os níveis que usar — o código de barras da etiqueta é
                informado no próximo passo.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ADDRESS_LEVELS.map(({ title, key, segment, parentKey }) => (
                  <WarehouseAddressCodeField
                    key={key}
                    segment={segment}
                    title={title}
                    code={addressValues[key]}
                    selectedId={selectedIds[key]}
                    onCodeChange={(v) => setAddressValue(key, v)}
                    onSelect={(item) => applySegmentSelection(segment, item)}
                    parentId={
                      parentKey && parentIds[parentKey]
                        ? parentIds[parentKey]
                        : undefined
                    }
                  />
                ))}
              </div>
            </WarehouseFormStep>

            <WarehouseFormStep
              step={4}
              title={isPulmao ? "Dados da localização (pulmão)" : "Dados da localização (estoque de giro)"}
            >
              <div className="space-y-3 rounded-xl border bg-white p-4">
                <label className="block text-sm">
                  Código de barras
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                    Etiqueta física desta posição — diferente da linha do endereço.
                  </span>
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 font-mono"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Ex.: etiqueta do pulmão ou estoque de giro"
                  />
                </label>
                <div className="space-y-1">
                  <WarehouseSkuSearchSelect
                    title="SKU (opcional)"
                    value={productId}
                    onChange={setProductId}
                    placeholder="Buscar SKU ou nome…"
                    emptyMessage="Nenhum produto encontrado"
                  />
                  {productId ? (
                    <button
                      type="button"
                      onClick={() => setProductId("")}
                      className="text-xs text-slate-500 underline hover:text-slate-700"
                    >
                      Cadastrar sem SKU
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
                      <span>Ocupação da posição</span>
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
              </div>
            </WarehouseFormStep>

            {barracaoId ? (
              <WarehouseFormStep step={5} title="Proximidade (opcional)">
                <WarehouseProximityReferencesEditor
                  barracaoId={barracaoId}
                  value={proximityReferences}
                  onChange={setProximityReferences}
                />
              </WarehouseFormStep>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Selecione o tipo de localização acima para continuar.
          </p>
        )}

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <div className="flex justify-end gap-2 rounded-xl border bg-white p-4 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/gestao-barracao")}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !positionType}
            onClick={validateAndSave}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar localização"}
          </button>
        </div>
      </div>
    </DataState>
  );
}
