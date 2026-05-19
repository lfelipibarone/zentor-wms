import { prisma } from "../lib/prisma.js";

export interface WaveSettings {
  enabled: boolean;
  autoReleaseEnabled: boolean;
  autoReleaseTime: string;
  autoReleaseMaxOrders: number;
  onlyDeadlineToday: boolean;
}

const DEFAULTS: WaveSettings = {
  enabled: true,
  autoReleaseEnabled: false,
  autoReleaseTime: "06:30",
  autoReleaseMaxOrders: 50,
  onlyDeadlineToday: false,
};

const KEYS = {
  enabled: "wave.enabled",
  autoReleaseEnabled: "wave.autoRelease.enabled",
  autoReleaseTime: "wave.autoRelease.time",
  autoReleaseMaxOrders: "wave.autoRelease.maxOrders",
  onlyDeadlineToday: "wave.onlyDeadlineToday",
} as const;

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

function parseIntSafe(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function getWaveSettings(tenantId: string): Promise<WaveSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { tenantId, key: { in: Object.values(KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    enabled: parseBool(map.get(KEYS.enabled), DEFAULTS.enabled),
    autoReleaseEnabled: parseBool(
      map.get(KEYS.autoReleaseEnabled),
      DEFAULTS.autoReleaseEnabled,
    ),
    autoReleaseTime: map.get(KEYS.autoReleaseTime) || DEFAULTS.autoReleaseTime,
    autoReleaseMaxOrders: parseIntSafe(
      map.get(KEYS.autoReleaseMaxOrders),
      DEFAULTS.autoReleaseMaxOrders,
    ),
    onlyDeadlineToday: parseBool(
      map.get(KEYS.onlyDeadlineToday),
      DEFAULTS.onlyDeadlineToday,
    ),
  };
}

export async function isWaveEnabled(tenantId: string): Promise<boolean> {
  const s = await getWaveSettings(tenantId);
  return s.enabled;
}

export const WAVE_SETTING_META = [
  {
    key: KEYS.enabled,
    label: "Habilitar separação em onda",
    description: "Operadores veem o fluxo de onda no app mobile",
  },
  {
    key: KEYS.autoReleaseEnabled,
    label: "Liberar onda automaticamente",
    description: "Job diário libera onda nos pedidos elegíveis",
  },
  {
    key: KEYS.autoReleaseTime,
    label: "Horário da liberação automática",
    description: "Formato HH:mm (fuso America/Sao_Paulo)",
  },
  {
    key: KEYS.autoReleaseMaxOrders,
    label: "Máximo de pedidos por onda",
    description: "Limite na seleção automática",
  },
  {
    key: KEYS.onlyDeadlineToday,
    label: "Somente pedidos com coleta hoje",
    description: "Restringe elegibilidade à data de coleta do dia",
  },
] as const;
