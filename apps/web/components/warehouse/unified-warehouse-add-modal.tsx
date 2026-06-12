"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createWarehouseItem,
  type WarehouseSegment,
  type WarehouseTree,
} from "@/lib/api/warehouse";

const ENTITY_OPTIONS: Array<{
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
    segment: "fileiras",
    label: "Fileira",
    parentField: "corredorId",
    parentLabel: "Corredor",
  },
  {
    segment: "estantes",
    label: "Estante",
    parentField: "setorId",
    parentLabel: "Setor",
  },
  {
    segment: "prateleiras",
    label: "Prateleira",
    parentField: "estanteId",
    parentLabel: "Estante",
  },
  {
    segment: "colunas",
    label: "Coluna",
    parentField: "prateleiraId",
    parentLabel: "Prateleira",
  },
];

function flattenLayout(trees: WarehouseTree[]) {
  const setores: Array<{ id: string; label: string; barracaoId: string }> = [];
  const corredores: Array<{ id: string; label: string }> = [];
  const fileiras: Array<{ id: string; label: string }> = [];
  const estantes: Array<{ id: string; label: string }> = [];
  const prateleiras: Array<{ id: string; label: string }> = [];
  const colunas: Array<{ id: string; label: string }> = [];

  for (const b of trees) {
    for (const s of b.setores) {
      setores.push({
        id: s.id,
        barracaoId: b.id,
        label: `${b.code} / ${s.code}${s.name ? ` — ${s.name}` : ""}`,
      });
      for (const c of s.corredores) {
        corredores.push({ id: c.id, label: `${b.code} / ${s.code} / ${c.code}` });
        for (const f of c.fileiras) {
          fileiras.push({
            id: f.id,
            label: `${b.code} / ${s.code} / ${c.code} / ${f.code}`,
          });
        }
      }
      for (const e of s.estantes) {
        estantes.push({ id: e.id, label: `${b.code} / ${s.code} / ${e.code}` });
        for (const p of e.prateleiras) {
          prateleiras.push({
            id: p.id,
            label: `${b.code} / ${s.code} / ${e.code} / ${p.code}`,
          });
          for (const col of p.colunas) {
            colunas.push({
              id: col.id,
              label: `${b.code} / ${s.code} / ${e.code} / ${p.code} / ${col.code}`,
            });
          }
        }
      }
    }
  }

  return { setores, corredores, fileiras, estantes, prateleiras, colunas };
}

export function UnifiedWarehouseAddModal({
  trees,
  onClose,
  onSaved,
}: {
  trees: WarehouseTree[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const flat = useMemo(() => flattenLayout(trees), [trees]);

  const availableTypes = useMemo(
    () =>
      ENTITY_OPTIONS.filter((e) => {
        switch (e.segment) {
          case "barracoes":
            return true;
          case "setores":
            return trees.length > 0;
          case "corredores":
          case "estantes":
            return flat.setores.length > 0;
          case "fileiras":
            return flat.corredores.length > 0;
          case "prateleiras":
            return flat.estantes.length > 0;
          case "colunas":
            return flat.prateleiras.length > 0;
          default:
            return false;
        }
      }),
    [trees.length, flat],
  );

  const [segment, setSegment] = useState<WarehouseSegment>("barracoes");
  const [parentId, setParentId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pickOrder, setPickOrder] = useState("0");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const meta = ENTITY_OPTIONS.find((e) => e.segment === segment)!;

  const parentOptions = useMemo(() => {
    switch (segment) {
      case "setores":
        return trees.map((b) => ({
          id: b.id,
          label: `${b.code}${b.name ? ` — ${b.name}` : ""}`,
        }));
      case "corredores":
      case "estantes":
        return flat.setores.map((s) => ({ id: s.id, label: s.label }));
      case "fileiras":
        return flat.corredores;
      case "prateleiras":
        return flat.estantes;
      case "colunas":
        return flat.prateleiras;
      default:
        return [];
    }
  }, [segment, trees, flat]);

  useEffect(() => {
    if (!availableTypes.some((t) => t.segment === segment)) {
      setSegment(availableTypes[0]?.segment ?? "barracoes");
    }
  }, [availableTypes, segment]);

  useEffect(() => {
    if (parentOptions.length > 0) {
      setParentId((prev) =>
        parentOptions.some((o) => o.id === prev) ? prev : parentOptions[0]!.id,
      );
    } else {
      setParentId("");
    }
  }, [segment, parentOptions]);

  const save = async () => {
    if (!code.trim()) {
      setErr("Código obrigatório");
      return;
    }
    if (meta.parentField && !parentId) {
      setErr(`${meta.parentLabel} obrigatório`);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        code: code.trim(),
        name: name.trim() || undefined,
        pickOrder: Number(pickOrder) || 0,
      };
      if (meta.parentField) {
        body[meta.parentField] = parentId;
      }
      await createWarehouseItem(segment, body);
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
      aria-labelledby="warehouse-add-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 id="warehouse-add-title" className="text-lg font-bold text-slate-900">
          Novo cadastro
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Escolha o tipo, o vínculo e os dados da posição.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Tipo de cadastro
            <select
              className="mt-1 w-full rounded-lg border-2 border-[#0d9488]/30 px-3 py-2.5 font-medium"
              value={segment}
              onChange={(e) => setSegment(e.target.value as WarehouseSegment)}
            >
              {ENTITY_OPTIONS.map((t) => {
                const enabled = availableTypes.some((a) => a.segment === t.segment);
                return (
                  <option key={t.segment} value={t.segment} disabled={!enabled}>
                    {t.label}
                    {!enabled ? " (cadastre o nível anterior)" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          {meta.parentField ? (
            <label className="block text-sm font-medium text-slate-700">
              {meta.parentLabel}
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                disabled={parentOptions.length === 0}
              >
                {parentOptions.length === 0 ? (
                  <option value="">Cadastre o nível anterior primeiro</option>
                ) : (
                  parentOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : null}

          <hr className="border-slate-200" />

          <label className="block text-sm">
            Código
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ex: A, 01, P3"
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
            Ordem de coleta
            <input
              type="number"
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={pickOrder}
              onChange={(e) => setPickOrder(e.target.value)}
            />
          </label>

          {err ? <p className="text-sm text-red-600">{err}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || Boolean(meta.parentField && !parentId)}
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
