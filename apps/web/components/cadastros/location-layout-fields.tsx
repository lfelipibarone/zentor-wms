"use client";

import { useEffect, useState } from "react";
import {
  fetchWarehouseItems,
  type WarehouseItem,
} from "@/lib/api/warehouse";

export interface LocationLayoutValue {
  barracaoId: string;
  setorId: string;
  corredorId: string;
  fileiraId: string;
  estanteId: string;
  prateleiraId: string;
  colunaId: string;
}

const emptyLayout: LocationLayoutValue = {
  barracaoId: "",
  setorId: "",
  corredorId: "",
  fileiraId: "",
  estanteId: "",
  prateleiraId: "",
  colunaId: "",
};

export function LocationLayoutFields({
  value,
  onChange,
}: {
  value: LocationLayoutValue;
  onChange: (v: LocationLayoutValue) => void;
}) {
  const [barracoes, setBarracoes] = useState<WarehouseItem[]>([]);
  const [setores, setSetores] = useState<WarehouseItem[]>([]);
  const [corredores, setCorredores] = useState<WarehouseItem[]>([]);
  const [fileiras, setFileiras] = useState<WarehouseItem[]>([]);
  const [estantes, setEstantes] = useState<WarehouseItem[]>([]);
  const [prateleiras, setPrateleiras] = useState<WarehouseItem[]>([]);
  const [colunas, setColunas] = useState<WarehouseItem[]>([]);

  useEffect(() => {
    fetchWarehouseItems("barracoes", { pageSize: 500 })
      .then((r) => setBarracoes(r.barracoes ?? []))
      .catch(() => setBarracoes([]));
  }, []);

  useEffect(() => {
    if (!value.barracaoId) {
      setSetores([]);
      return;
    }
    fetchWarehouseItems("setores", { parentId: value.barracaoId, pageSize: 500 })
      .then((r) => setSetores(r.setores ?? []))
      .catch(() => setSetores([]));
  }, [value.barracaoId]);

  useEffect(() => {
    if (!value.setorId) {
      setCorredores([]);
      setEstantes([]);
      return;
    }
    Promise.all([
      fetchWarehouseItems("corredores", { parentId: value.setorId, pageSize: 500 }),
      fetchWarehouseItems("estantes", { parentId: value.setorId, pageSize: 500 }),
    ])
      .then(([c, e]) => {
        setCorredores(c.corredores ?? []);
        setEstantes(e.estantes ?? []);
      })
      .catch(() => {
        setCorredores([]);
        setEstantes([]);
      });
  }, [value.setorId]);

  useEffect(() => {
    if (!value.corredorId) {
      setFileiras([]);
      return;
    }
    fetchWarehouseItems("fileiras", { parentId: value.corredorId, pageSize: 500 })
      .then((r) => setFileiras(r.fileiras ?? []))
      .catch(() => setFileiras([]));
  }, [value.corredorId]);

  useEffect(() => {
    if (!value.estanteId) {
      setPrateleiras([]);
      return;
    }
    fetchWarehouseItems("prateleiras", { parentId: value.estanteId, pageSize: 500 })
      .then((r) => setPrateleiras(r.prateleiras ?? []))
      .catch(() => setPrateleiras([]));
  }, [value.estanteId]);

  useEffect(() => {
    if (!value.prateleiraId) {
      setColunas([]);
      return;
    }
    fetchWarehouseItems("colunas", { parentId: value.prateleiraId, pageSize: 500 })
      .then((r) => setColunas(r.colunas ?? []))
      .catch(() => setColunas([]));
  }, [value.prateleiraId]);

  const patch = (partial: Partial<LocationLayoutValue>) => {
    const next = { ...value, ...partial };
    if (partial.barracaoId !== undefined) {
      next.setorId = "";
      next.corredorId = "";
      next.fileiraId = "";
      next.estanteId = "";
      next.prateleiraId = "";
      next.colunaId = "";
    }
    if (partial.setorId !== undefined) {
      next.corredorId = "";
      next.fileiraId = "";
      next.estanteId = "";
      next.prateleiraId = "";
      next.colunaId = "";
    }
    if (partial.corredorId !== undefined) {
      next.fileiraId = "";
    }
    if (partial.estanteId !== undefined) {
      next.prateleiraId = "";
      next.colunaId = "";
    }
    if (partial.prateleiraId !== undefined) {
      next.colunaId = "";
    }
    onChange(next);
  };

  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
      <SelectField
        label="Barracão"
        value={value.barracaoId}
        options={barracoes}
        onChange={(v) => patch({ barracaoId: v })}
      />
      <SelectField
        label="Setor"
        value={value.setorId}
        options={setores}
        disabled={!value.barracaoId}
        onChange={(v) => patch({ setorId: v })}
      />
      <SelectField
        label="Corredor"
        value={value.corredorId}
        options={corredores}
        disabled={!value.setorId}
        onChange={(v) => patch({ corredorId: v })}
      />
      <SelectField
        label="Fileira"
        value={value.fileiraId}
        options={fileiras}
        disabled={!value.corredorId}
        onChange={(v) => patch({ fileiraId: v })}
      />
      <SelectField
        label="Estante"
        value={value.estanteId}
        options={estantes}
        disabled={!value.setorId}
        onChange={(v) => patch({ estanteId: v })}
      />
      <SelectField
        label="Prateleira"
        value={value.prateleiraId}
        options={prateleiras}
        disabled={!value.estanteId}
        onChange={(v) => patch({ prateleiraId: v })}
      />
      <SelectField
        label="Coluna"
        value={value.colunaId}
        options={colunas}
        disabled={!value.prateleiraId}
        onChange={(v) => patch({ colunaId: v })}
        className="sm:col-span-2"
      />
      <p className="text-xs text-slate-500 sm:col-span-2">
        Cadastre a estrutura em{" "}
        <a href="/gestao-barracao" className="text-[#0d9488] underline">
          Layout do galpão
        </a>{" "}
        antes de vincular localizações.
      </p>
    </div>
  );
}

export { emptyLayout };

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: WarehouseItem[];
  disabled?: boolean;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      {label}
      <select
        className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-slate-50"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Selecione…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.code}
            {o.name ? ` — ${o.name}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
