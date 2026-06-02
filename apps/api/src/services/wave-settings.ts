import { prisma } from "../lib/prisma.js";
import type { WavePartitionStrategy } from "./pick-wave-partition.js";

export interface WaveSchedule {
  dayOfWeek: number; // 0=Dom .. 6=Sab
  time: string; // "HH:mm"
}

export interface WaveSettings {
  enabled: boolean;
  autoReleaseEnabled: boolean;
  autoReleaseTime: string;
  autoReleaseSchedules: WaveSchedule[];
  autoReleaseMaxOrders: number;
  onlyDeadlineToday: boolean;
  partitionEnabled: boolean;
  minOrdersPerWave: number;
  maxWavesPerBatch: number;
  defaultPartitionStrategy: WavePartitionStrategy;
  proximityMaxDistance: number;
  autoReleaseMarketplace: string | null;
}

const DEFAULTS: WaveSettings = {
  enabled: true,
  autoReleaseEnabled: false,
  autoReleaseTime: "06:30",
  autoReleaseSchedules: [],
  autoReleaseMaxOrders: 50,
  onlyDeadlineToday: false,
  partitionEnabled: true,
  minOrdersPerWave: 3,
  maxWavesPerBatch: 10,
  defaultPartitionStrategy: "BY_PRODUCT",
  proximityMaxDistance: 2,
  autoReleaseMarketplace: null,
};

const KEYS = {
  enabled: "wave.enabled",
  autoReleaseEnabled: "wave.autoRelease.enabled",
  autoReleaseTime: "wave.autoRelease.time",
  autoReleaseSchedules: "wave.autoRelease.schedules",
  autoReleaseMaxOrders: "wave.autoRelease.maxOrders",
  onlyDeadlineToday: "wave.onlyDeadlineToday",
  partitionEnabled: "wave.partition.enabled",
  minOrdersPerWave: "wave.partition.minOrdersPerWave",
  maxWavesPerBatch: "wave.partition.maxWavesPerBatch",
  defaultPartitionStrategy: "wave.partition.defaultStrategy",
  proximityMaxDistance: "wave.partition.proximityMaxDistance",
  autoReleaseMarketplace: "wave.autoRelease.marketplace",
} as const;

const STRATEGIES: WavePartitionStrategy[] = [
  "SINGLE_ITEM",
  "PROXIMITY",
  "BY_PRODUCT",
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTime(v: unknown): v is string {
  return typeof v === "string" && TIME_RE.test(v);
}

function parseSchedules(raw: string | undefined): WaveSchedule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: WaveSchedule[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof item.dayOfWeek === "number" &&
        item.dayOfWeek >= 0 &&
        item.dayOfWeek <= 6 &&
        Number.isInteger(item.dayOfWeek) &&
        isValidTime(item.time)
      ) {
        out.push({ dayOfWeek: item.dayOfWeek, time: item.time });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function serializeSchedules(schedules: WaveSchedule[]): string {
  const sanitized: WaveSchedule[] = [];
  const seen = new Set<string>();
  for (const s of schedules) {
    if (
      typeof s.dayOfWeek !== "number" ||
      s.dayOfWeek < 0 ||
      s.dayOfWeek > 6 ||
      !Number.isInteger(s.dayOfWeek) ||
      !isValidTime(s.time)
    ) {
      continue;
    }
    const key = `${s.dayOfWeek}-${s.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push({ dayOfWeek: s.dayOfWeek, time: s.time });
  }
  return JSON.stringify(sanitized);
}

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
    autoReleaseSchedules: parseSchedules(map.get(KEYS.autoReleaseSchedules)),
    autoReleaseMaxOrders: parseIntSafe(
      map.get(KEYS.autoReleaseMaxOrders),
      DEFAULTS.autoReleaseMaxOrders,
    ),
    onlyDeadlineToday: parseBool(
      map.get(KEYS.onlyDeadlineToday),
      DEFAULTS.onlyDeadlineToday,
    ),
    partitionEnabled: parseBool(
      map.get(KEYS.partitionEnabled),
      DEFAULTS.partitionEnabled,
    ),
    minOrdersPerWave: parseIntSafe(
      map.get(KEYS.minOrdersPerWave),
      DEFAULTS.minOrdersPerWave,
    ),
    maxWavesPerBatch: parseIntSafe(
      map.get(KEYS.maxWavesPerBatch),
      DEFAULTS.maxWavesPerBatch,
    ),
    defaultPartitionStrategy: parseStrategy(
      map.get(KEYS.defaultPartitionStrategy),
      DEFAULTS.defaultPartitionStrategy,
    ),
    proximityMaxDistance: parseIntSafe(
      map.get(KEYS.proximityMaxDistance),
      DEFAULTS.proximityMaxDistance,
    ),
    autoReleaseMarketplace:
      map.get(KEYS.autoReleaseMarketplace)?.trim() || null,
  };
}

function parseStrategy(
  v: string | undefined,
  fallback: WavePartitionStrategy,
): WavePartitionStrategy {
  if (v && STRATEGIES.includes(v as WavePartitionStrategy)) {
    return v as WavePartitionStrategy;
  }
  return fallback;
}

export async function isWaveEnabled(tenantId: string): Promise<boolean> {
  const s = await getWaveSettings(tenantId);
  return s.enabled;
}

export async function setWaveSettings(
  tenantId: string,
  patch: Partial<WaveSettings>,
  updatedById: string,
): Promise<WaveSettings> {
  const updates: Array<{ key: string; value: string }> = [];

  if (patch.enabled !== undefined) {
    updates.push({ key: KEYS.enabled, value: String(patch.enabled) });
  }
  if (patch.autoReleaseEnabled !== undefined) {
    updates.push({
      key: KEYS.autoReleaseEnabled,
      value: String(patch.autoReleaseEnabled),
    });
  }
  if (patch.autoReleaseTime !== undefined) {
    if (!isValidTime(patch.autoReleaseTime)) {
      throw new Error("Horário inválido (use HH:mm)");
    }
    updates.push({ key: KEYS.autoReleaseTime, value: patch.autoReleaseTime });
  }
  if (patch.autoReleaseSchedules !== undefined) {
    if (!Array.isArray(patch.autoReleaseSchedules)) {
      throw new Error("autoReleaseSchedules deve ser uma lista");
    }
    for (const s of patch.autoReleaseSchedules) {
      if (
        typeof s.dayOfWeek !== "number" ||
        s.dayOfWeek < 0 ||
        s.dayOfWeek > 6 ||
        !Number.isInteger(s.dayOfWeek)
      ) {
        throw new Error("dayOfWeek inválido (use 0..6)");
      }
      if (!isValidTime(s.time)) {
        throw new Error("Horário inválido em schedule (use HH:mm)");
      }
    }
    updates.push({
      key: KEYS.autoReleaseSchedules,
      value: serializeSchedules(patch.autoReleaseSchedules),
    });
  }
  if (patch.autoReleaseMaxOrders !== undefined) {
    const n = Math.floor(Number(patch.autoReleaseMaxOrders));
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("autoReleaseMaxOrders deve ser > 0");
    }
    updates.push({ key: KEYS.autoReleaseMaxOrders, value: String(n) });
  }
  if (patch.onlyDeadlineToday !== undefined) {
    updates.push({
      key: KEYS.onlyDeadlineToday,
      value: String(patch.onlyDeadlineToday),
    });
  }
  if (patch.partitionEnabled !== undefined) {
    updates.push({
      key: KEYS.partitionEnabled,
      value: String(patch.partitionEnabled),
    });
  }
  if (patch.minOrdersPerWave !== undefined) {
    const n = Math.floor(Number(patch.minOrdersPerWave));
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("minOrdersPerWave deve ser > 0");
    }
    updates.push({ key: KEYS.minOrdersPerWave, value: String(n) });
  }
  if (patch.maxWavesPerBatch !== undefined) {
    const n = Math.floor(Number(patch.maxWavesPerBatch));
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("maxWavesPerBatch deve ser > 0");
    }
    updates.push({ key: KEYS.maxWavesPerBatch, value: String(n) });
  }
  if (patch.defaultPartitionStrategy !== undefined) {
    if (!STRATEGIES.includes(patch.defaultPartitionStrategy)) {
      throw new Error("Estratégia de partição inválida");
    }
    updates.push({
      key: KEYS.defaultPartitionStrategy,
      value: patch.defaultPartitionStrategy,
    });
  }
  if (patch.proximityMaxDistance !== undefined) {
    const n = Math.floor(Number(patch.proximityMaxDistance));
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("proximityMaxDistance deve ser >= 0");
    }
    updates.push({ key: KEYS.proximityMaxDistance, value: String(n) });
  }
  if (patch.autoReleaseMarketplace !== undefined) {
    updates.push({
      key: KEYS.autoReleaseMarketplace,
      value: patch.autoReleaseMarketplace?.trim() ?? "",
    });
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.systemSetting.upsert({
          where: { tenantId_key: { tenantId, key: u.key } },
          update: { value: u.value, updatedById },
          create: {
            tenantId,
            key: u.key,
            value: u.value,
            updatedById,
          },
        }),
      ),
    );
  }

  return getWaveSettings(tenantId);
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
  {
    key: KEYS.partitionEnabled,
    label: "Dividir liberação em várias ondas",
    description: "Agrupa pedidos por produto consolidado (greedy por SKU)",
  },
  {
    key: KEYS.minOrdersPerWave,
    label: "Mínimo de pedidos por onda",
    description: "Grupos menores são fundidos ou ignorados na partição",
  },
  {
    key: KEYS.maxWavesPerBatch,
    label: "Máximo de ondas por liberação",
    description: "Limite de ondas criadas em um único release",
  },
  {
    key: KEYS.defaultPartitionStrategy,
    label: "Modo padrão de formação de onda",
    description: "SINGLE_ITEM, PROXIMITY ou BY_PRODUCT",
  },
  {
    key: KEYS.proximityMaxDistance,
    label: "Distância máxima de proximidade",
    description: "Manhattan entre centróides no estoque de giro (modo proximidade)",
  },
  {
    key: KEYS.autoReleaseMarketplace,
    label: "Marketplace da liberação automática",
    description: "Código canônico ou vazio para todos elegíveis",
  },
] as const;
