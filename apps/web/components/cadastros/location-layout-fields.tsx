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
  estanteId: string;
  colunaId: string;
  linhaId: string;
}

const emptyLayout: LocationLayoutValue = {
  barracaoId: "",
  setorId: "",
  corredorId: "",
  estanteId: "",
  colunaId: "",
  linhaId: "",
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
  const [estantes, setEstantes] = useState<WarehouseItem[]>([]);
  const [colunas, setColunas] = useState<WarehouseItem[]>([]);
  const [linhas, setLinhas] = useState<WarehouseItem[]>([]);

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
      return;
    }
    fetchWarehouseItems("corredores", { parentId: value.setorId, pageSize: 500 })
      .then((r) => setCorredores(r.corredores ?? []))
      .catch(() => setCorredores([]));
  }, [value.setorId]);

  useEffect(() => {
    if (!value.corredorId) {
      setEstantes([]);
      return;
    }
    fetchWarehouseItems("estantes", { parentId: value.corredorId, pageSize: 500 })
      .then((r) => setEstantes(r.estantes ?? []))
      .catch(() => setEstantes([]));
  }, [value.corredorId]);

  useEffect(() => {
    if (!value.estanteId) {
      setColunas([]);
      return;
    }
    fetchWarehouseItems("colunas", { parentId: value.estanteId, pageSize: 500 })
      .then((r) => setColunas(r.colunas ?? []))
      .catch(() => setColunas([]));
  }, [value.estanteId]);

  useEffect(() => {
    if (!value.colunaId) {
      setLinhas([]);
      return;
    }
    fetchWarehouseItems("linhas", { parentId: value.colunaId, pageSize: 500 })
      .then((r) => setLinhas(r.linhas ?? []))
      .catch(() => setLinhas([]));
  }, [value.colunaId]);

  const patch = (partial: Partial<LocationLayoutValue>) => {
    const next = { ...value, ...partial };
    if (partial.barracaoId !== undefined) {
      next.setorId = "";
      next.corredorId = "";
      next.estanteId = "";
      next.colunaId = "";
      next.linhaId = "";
    }
    if (partial.setorId !== undefined) {
      next.corredorId = "";
      next.estanteId = "";
      next.colunaId = "";
      next.linhaId = "";
    }
    if (partial.corredorId !== undefined) {
      next.estanteId = "";
      next.colunaId = "";
      next.linhaId = "";
    }
    if (partial.estanteId !== undefined) {
      next.colunaId = "";
      next.linhaId = "";
    }
    if (partial.colunaId !== undefined) {
      next.linhaId = "";
    }
    onChange(next);
  };

  return (
    <div className="grid gap-2.5 sm:col-span-2 sm:grid-cols-2">
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
        label="Estante"
        value={value.estanteId}
        options={estantes}
        disabled={!value.corredorId}
        onChange={(v) => patch({ estanteId: v })}
      />
      <SelectField
        label="Coluna"
        value={value.colunaId}
        options={colunas}
        disabled={!value.estanteId}
        onChange={(v) => patch({ colunaId: v })}
      />
      <SelectField
        label="Linha"
        value={value.linhaId}
        options={linhas}
        disabled={!value.colunaId}
        onChange={(v) => patch({ linhaId: v })}
      />
      <p className="text-xs text-slate-500 sm:col-span-2">
        Preencha barracão, setor, corredor, estante, coluna e linha. Cadastre posições em{" "}
        <a href="/gestao-barracao" className="text-[#0d9488] underline">
          Layout do galpão
        </a>
        .
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
