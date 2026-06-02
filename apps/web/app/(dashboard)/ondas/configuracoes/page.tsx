"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { useAuth } from "@/components/auth/auth-provider";
import { Permission } from "@wms/shared";
import { MarketplaceFilter } from "@/components/ops/marketplace-filter";
import {
  fetchWaveSettings,
  updateWaveSettings,
  type WavePartitionStrategy,
  type WaveSchedule,
  type WaveSettings,
} from "@/lib/api/waves";

const DAYS: Array<{ value: number; short: string; full: string }> = [
  { value: 0, short: "D", full: "Domingo" },
  { value: 1, short: "S", full: "Segunda" },
  { value: 2, short: "T", full: "Terça" },
  { value: 3, short: "Q", full: "Quarta" },
  { value: 4, short: "Q", full: "Quinta" },
  { value: 5, short: "S", full: "Sexta" },
  { value: 6, short: "S", full: "Sábado" },
];

interface UiSlot {
  id: string;
  daysOfWeek: Set<number>;
  time: string;
}

function expandToPersisted(slots: UiSlot[]): WaveSchedule[] {
  const out: WaveSchedule[] = [];
  const seen = new Set<string>();
  for (const s of slots) {
    if (!s.time) continue;
    for (const d of s.daysOfWeek) {
      const key = `${d}-${s.time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ dayOfWeek: d, time: s.time });
    }
  }
  return out;
}

function collapseFromPersisted(schedules: WaveSchedule[]): UiSlot[] {
  // Agrupa por horário para conveniência da UI
  const map = new Map<string, Set<number>>();
  for (const s of schedules) {
    const set = map.get(s.time) ?? new Set<number>();
    set.add(s.dayOfWeek);
    map.set(s.time, set);
  }
  let id = 0;
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, days]) => ({
      id: `slot-${++id}`,
      time,
      daysOfWeek: days,
    }));
}

function newSlot(): UiSlot {
  return {
    id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    daysOfWeek: new Set<number>([1, 2, 3, 4, 5]),
    time: "06:30",
  };
}

export default function WaveSettingsPage() {
  const { can, loading: authLoading } = useAuth();
  const ready = !authLoading;
  const allowed = ready && can(Permission.SETTINGS_MANAGE);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<WaveSettings | null>(null);
  const [slots, setSlots] = useState<UiSlot[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWaveSettings();
      setSettings(data.settings);
      setSlots(collapseFromPersisted(data.settings.autoReleaseSchedules));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) {
      load();
    } else if (ready) {
      setLoading(false);
    }
  }, [allowed, ready, load]);

  const updateSetting = <K extends keyof WaveSettings>(
    key: K,
    value: WaveSettings[K],
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleDay = (slotId: string, day: number) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const next = new Set(s.daysOfWeek);
        if (next.has(day)) next.delete(day);
        else next.add(day);
        return { ...s, daysOfWeek: next };
      }),
    );
  };

  const updateSlotTime = (slotId: string, time: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, time } : s)),
    );
  };

  const removeSlot = (slotId: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
  };

  const addSlot = () => {
    setSlots((prev) => [...prev, newSlot()]);
  };

  const expandedSchedules = useMemo(() => expandToPersisted(slots), [slots]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const payload: Partial<WaveSettings> = {
        enabled: settings.enabled,
        autoReleaseEnabled: settings.autoReleaseEnabled,
        autoReleaseTime: settings.autoReleaseTime,
        autoReleaseSchedules: expandedSchedules,
        autoReleaseMaxOrders: settings.autoReleaseMaxOrders,
        onlyDeadlineToday: settings.onlyDeadlineToday,
        partitionEnabled: settings.partitionEnabled,
        minOrdersPerWave: settings.minOrdersPerWave,
        maxWavesPerBatch: settings.maxWavesPerBatch,
      };
      const data = await updateWaveSettings(payload);
      setSettings(data.settings);
      setSlots(collapseFromPersisted(data.settings.autoReleaseSchedules));
      setMessage("Configurações salvas.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Configurações de ondas"
          description="Automação e particionamento das ondas de separação."
        >
          <Link
            href="/ondas"
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Voltar
          </Link>
        </PageHeader>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Você não tem permissão para alterar essas configurações.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações de ondas"
        description="Automação e particionamento das ondas de separação."
      >
        <Link
          href="/ondas"
          className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Voltar
        </Link>
      </PageHeader>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      {loading || !settings ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando configurações…
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Geral</h2>
            <ToggleRow
              label="Habilitar separação em onda"
              description="Operadores veem o fluxo de onda no app mobile"
              value={settings.enabled}
              onChange={(v) => updateSetting("enabled", v)}
            />
            <ToggleRow
              label="Automação habilitada"
              description="Libera ondas automaticamente nos horários configurados"
              value={settings.autoReleaseEnabled}
              onChange={(v) => updateSetting("autoReleaseEnabled", v)}
            />
            <ToggleRow
              label="Apenas pedidos com prazo de coleta hoje"
              description="Restringe elegibilidade à data de coleta do dia"
              value={settings.onlyDeadlineToday}
              onChange={(v) => updateSetting("onlyDeadlineToday", v)}
            />
            <NumberRow
              label="Máximo de pedidos por onda automática"
              value={settings.autoReleaseMaxOrders}
              onChange={(v) => updateSetting("autoReleaseMaxOrders", v)}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Marketplace da liberação automática
              </label>
              <MarketplaceFilter
                value={settings.autoReleaseMarketplace ?? ""}
                onChange={(v) =>
                  updateSetting("autoReleaseMarketplace", v || null)
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Deixe vazio para considerar todos os pedidos elegíveis (ainda
                exige marketplace único por onda).
              </p>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">
                Horários de criação automática
              </h2>
              <span className="text-xs text-muted-foreground">
                Fuso America/Sao_Paulo
              </span>
            </div>

            {slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum horário configurado. Quando vazio, usa o horário único
                em todos os dias da semana (
                <span className="font-mono">
                  {settings.autoReleaseTime || "06:30"}
                </span>
                ).
              </p>
            ) : null}

            <ul className="space-y-3">
              {slots.map((slot) => (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap gap-1">
                    {DAYS.map((d) => {
                      const active = slot.daysOfWeek.has(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => toggleDay(slot.id, d.value)}
                          title={d.full}
                          className={`h-8 w-8 rounded-full border text-xs font-semibold ${
                            active
                              ? "border-[#0d9488] bg-[#0d9488] text-white"
                              : "border-slate-300 bg-white text-slate-600"
                          }`}
                        >
                          {d.short}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="time"
                    value={slot.time}
                    onChange={(e) => updateSlotTime(slot.id, e.target.value)}
                    className="rounded-lg border bg-white px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeSlot(slot.id)}
                    className="ml-auto rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={addSlot}
              className="rounded-lg border border-dashed bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              + Adicionar horário
            </button>

            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-slate-700">
                Horário único (fallback, usado quando não há horários acima)
              </label>
              <input
                type="time"
                value={settings.autoReleaseTime}
                onChange={(e) =>
                  updateSetting("autoReleaseTime", e.target.value)
                }
                className="mt-1 rounded-lg border bg-white px-3 py-1.5 text-sm"
              />
            </div>
          </section>

          <section className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold">
              Partição em múltiplas ondas
            </h2>
            <ToggleRow
              label="Partição habilitada"
              description="Agrupa pedidos por SKU consolidado (greedy)"
              value={settings.partitionEnabled}
              onChange={(v) => updateSetting("partitionEnabled", v)}
            />
            <NumberRow
              label="Mínimo de pedidos por onda"
              value={settings.minOrdersPerWave}
              onChange={(v) => updateSetting("minOrdersPerWave", v)}
            />
            <NumberRow
              label="Máximo de ondas por liberação"
              value={settings.maxWavesPerBatch}
              onChange={(v) => updateSetting("maxWavesPerBatch", v)}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Modo padrão de formação
              </label>
              <select
                value={settings.defaultPartitionStrategy}
                onChange={(e) =>
                  updateSetting(
                    "defaultPartitionStrategy",
                    e.target.value as WavePartitionStrategy,
                  )
                }
                className="rounded-lg border bg-white px-3 py-2 text-sm"
              >
                <option value="SINGLE_ITEM">Item único</option>
                <option value="PROXIMITY">Proximidade</option>
                <option value="BY_PRODUCT">SKU compartilhado</option>
              </select>
            </div>
            <NumberRow
              label="Distância máxima de proximidade"
              value={settings.proximityMaxDistance}
              onChange={(v) => updateSetting("proximityMaxDistance", v)}
            />
            <p className="text-xs text-muted-foreground">
              Usada nos modos Proximidade e SKU compartilhado (vínculo por
              localização no estoque de giro).
            </p>
          </section>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={load}
              disabled={saving}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar alterações
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar configurações"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="flex-1">
        <span className="block text-sm font-medium text-slate-800">
          {label}
        </span>
        {description ? (
          <span className="block text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
    </label>
  );
}

interface NumberRowProps {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
}

function NumberRow({ label, description, value, onChange }: NumberRowProps) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex-1">
        <span className="block text-sm font-medium text-slate-800">
          {label}
        </span>
        {description ? (
          <span className="block text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-lg border bg-white px-3 py-1.5 text-right text-sm"
      />
    </label>
  );
}
