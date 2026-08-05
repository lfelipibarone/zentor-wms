import { prisma } from "../lib/prisma.js";

/** Checkpoint válido por até 7 dias — syncs longos com rate limit podem levar dias. */
export const TINY_SYNC_CHECKPOINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const TINY_PRODUCTS_CHECKPOINT_KEY = "tiny.products.syncCheckpoint";
export const TINY_PRODUCTS_LAST_SYNC_KEY = "tiny.products.lastSyncAt";
export const TINY_ORDERS_CHECKPOINT_KEY = "tiny.orders.syncCheckpoint";
export const TINY_ORDERS_LAST_SYNC_KEY = "tiny.orders.lastSyncAt";

/** Fases do sync de pedidos: 5 situações syncáveis + cancelados. */
export const TINY_ORDER_SYNC_PHASE_COUNT = 6;

const TINY_ORDER_SITUACAO_LABELS: Record<number, string> = {
  0: "Aberta",
  1: "Faturada",
  3: "Aprovada",
  4: "Preparando envio",
  5: "Enviada",
  6: "Entregue",
  7: "Pronto envio",
  8: "Cancelada",
};

export type TinySyncCheckpointStats = {
  created?: number;
  updated?: number;
  skipped?: number;
  skippedExisting?: number;
  listedFromTiny?: number;
  cancelledRemoved?: number;
};

export type TinySyncCheckpointState = {
  status: "running";
  kind: "products" | "orders";
  offset: number;
  total: number | null;
  startedAt: string;
  updatedAt: string;
  connectionId?: string | null;
  /** Pedidos: índice em TINY_SYNCABLE_SITUACOES ou fase cancelada */
  situacaoIndex?: number;
  situacao?: number;
  days?: number;
  phase?: "syncable" | "cancelled";
  stats?: TinySyncCheckpointStats;
  pauseReason?: "rate_limit" | "interrupted";
};

export type TinySyncJobView = {
  kind: "products" | "orders";
  running: boolean;
  resumable: boolean;
  stale: boolean;
  pauseReason: "rate_limit" | "interrupted" | null;
  progressPercent: number | null;
  progressLabel: string;
  startedAt: string | null;
  updatedAt: string | null;
  lastSyncAt: string | null;
  offset: number | null;
  total: number | null;
  stats: TinySyncCheckpointStats | null;
  /** Pedidos: detalhes da fase atual */
  phase?: "syncable" | "cancelled";
  situacaoIndex?: number;
  situacaoLabel?: string;
  days?: number;
};

export type TinySyncStatusResponse = {
  products: TinySyncJobView;
  orders: TinySyncJobView;
};

function phaseProgress(offset: number, total: number | null): number {
  if (!total || total <= 0) return 0;
  return Math.min(1, offset / total);
}

export function computeTinySyncProgressPercent(
  checkpoint: TinySyncCheckpointState,
): number | null {
  if (checkpoint.kind === "products") {
    if (!checkpoint.total || checkpoint.total <= 0) return null;
    return Math.min(
      100,
      Math.round((checkpoint.offset / checkpoint.total) * 100),
    );
  }

  const syncablePhases = TINY_ORDER_SYNC_PHASE_COUNT - 1;
  if (checkpoint.phase === "cancelled") {
    const p = phaseProgress(checkpoint.offset, checkpoint.total);
    return Math.min(
      100,
      Math.round(((syncablePhases + p) / TINY_ORDER_SYNC_PHASE_COUNT) * 100),
    );
  }

  const situacaoIndex = checkpoint.situacaoIndex ?? 0;
  const p = phaseProgress(checkpoint.offset, checkpoint.total);
  return Math.min(
    100,
    Math.round(
      ((situacaoIndex + p) / TINY_ORDER_SYNC_PHASE_COUNT) * 100,
    ),
  );
}

export function buildTinySyncProgressLabel(
  checkpoint: TinySyncCheckpointState,
): string {
  const pct = computeTinySyncProgressPercent(checkpoint);

  if (checkpoint.kind === "products") {
    const totalLabel =
      checkpoint.total && checkpoint.total > 0
        ? ` de ~${checkpoint.total}`
        : "";
    const pctLabel = pct !== null ? ` (${pct}%)` : "";
    return `Produtos: offset ${checkpoint.offset}${totalLabel}${pctLabel}`;
  }

  const situacaoLabel =
    checkpoint.phase === "cancelled"
      ? "Cancelados"
      : (TINY_ORDER_SITUACAO_LABELS[checkpoint.situacao ?? -1] ??
        `Situação ${checkpoint.situacao ?? "?"}`);
  const phaseNum =
    checkpoint.phase === "cancelled"
      ? TINY_ORDER_SYNC_PHASE_COUNT
      : (checkpoint.situacaoIndex ?? 0) + 1;
  const totalLabel =
    checkpoint.total && checkpoint.total > 0
      ? ` — ${checkpoint.offset}/${checkpoint.total}`
      : ` — offset ${checkpoint.offset}`;
  const pctLabel = pct !== null ? ` (${pct}%)` : "";
  const daysLabel =
    checkpoint.days !== undefined ? `, últimos ${checkpoint.days} dias` : "";
  return `Pedidos: ${situacaoLabel} (${phaseNum}/${TINY_ORDER_SYNC_PHASE_COUNT})${totalLabel}${pctLabel}${daysLabel}`;
}

function buildJobView(params: {
  kind: "products" | "orders";
  checkpoint: TinySyncCheckpointState | null;
  lastSyncAt: string | null;
  connectionId?: string;
}): TinySyncJobView {
  const { checkpoint, kind, lastSyncAt, connectionId } = params;
  const running = checkpoint?.status === "running";
  const resumable = isTinySyncCheckpointResumable(checkpoint, { connectionId });
  const stale = Boolean(checkpoint && !resumable && running);

  if (!checkpoint) {
    return {
      kind,
      running: false,
      resumable: false,
      stale: false,
      pauseReason: null,
      progressPercent: null,
      progressLabel: lastSyncAt
        ? `Último sync: ${new Date(lastSyncAt).toLocaleString("pt-BR")}`
        : "Nunca sincronizado",
      startedAt: null,
      updatedAt: null,
      lastSyncAt,
      offset: null,
      total: null,
      stats: null,
    };
  }

  const pauseReason =
    checkpoint.pauseReason ??
    (stale ? "interrupted" : running ? "interrupted" : null);

  const base: TinySyncJobView = {
    kind,
    running: resumable || stale,
    resumable,
    stale,
    pauseReason: resumable || stale ? pauseReason : null,
    progressPercent: computeTinySyncProgressPercent(checkpoint),
    progressLabel: buildTinySyncProgressLabel(checkpoint),
    startedAt: checkpoint.startedAt,
    updatedAt: checkpoint.updatedAt,
    lastSyncAt,
    offset: checkpoint.offset,
    total: checkpoint.total,
    stats: checkpoint.stats ?? null,
  };

  if (kind === "orders") {
    base.phase = checkpoint.phase;
    base.situacaoIndex = checkpoint.situacaoIndex;
    base.situacaoLabel =
      checkpoint.phase === "cancelled"
        ? "Cancelados"
        : TINY_ORDER_SITUACAO_LABELS[checkpoint.situacao ?? -1];
    base.days = checkpoint.days;
  }

  return base;
}

export function parseTinySyncCheckpoint(
  raw: string | null | undefined,
): TinySyncCheckpointState | null {
  if (!raw?.trim()) return null;
  try {
    const data = JSON.parse(raw) as TinySyncCheckpointState;
    if (data?.status !== "running") return null;
    if (!Number.isFinite(data.offset) || data.offset < 0) return null;
    if (data.kind !== "products" && data.kind !== "orders") return null;
    if (!data.startedAt || !data.updatedAt) return null;
    return data;
  } catch {
    return null;
  }
}

export function isTinySyncCheckpointResumable(
  checkpoint: TinySyncCheckpointState | null,
  opts?: { connectionId?: string; forceRestart?: boolean },
): checkpoint is TinySyncCheckpointState {
  if (opts?.forceRestart) return false;
  if (!checkpoint) return false;

  const age = Date.now() - new Date(checkpoint.updatedAt).getTime();
  if (age > TINY_SYNC_CHECKPOINT_MAX_AGE_MS) return false;

  const wanted = opts?.connectionId?.trim() || null;
  const saved = checkpoint.connectionId?.trim() || null;
  if (wanted && saved && wanted !== saved) return false;

  return true;
}

async function readSettingValue(
  tenantId: string,
  key: string,
): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  return row?.value?.trim() || null;
}

export async function readTinySyncCheckpoint(
  tenantId: string,
  key: string,
): Promise<TinySyncCheckpointState | null> {
  return parseTinySyncCheckpoint(await readSettingValue(tenantId, key));
}

export async function writeTinySyncCheckpoint(
  tenantId: string,
  key: string,
  state: TinySyncCheckpointState,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: {
      tenantId,
      key,
      value: JSON.stringify(state),
    },
    update: { value: JSON.stringify(state) },
  });
}

export async function clearTinySyncCheckpoint(
  tenantId: string,
  key: string,
): Promise<void> {
  await prisma.systemSetting.deleteMany({
    where: { tenantId, key },
  });
}

export async function getTinySyncStatus(params: {
  tenantId: string;
  connectionId?: string;
}): Promise<TinySyncStatusResponse> {
  const [productsCheckpoint, ordersCheckpoint, productsLast, ordersLast] =
    await Promise.all([
      readTinySyncCheckpoint(params.tenantId, TINY_PRODUCTS_CHECKPOINT_KEY),
      readTinySyncCheckpoint(params.tenantId, TINY_ORDERS_CHECKPOINT_KEY),
      readSettingValue(params.tenantId, TINY_PRODUCTS_LAST_SYNC_KEY),
      readSettingValue(params.tenantId, TINY_ORDERS_LAST_SYNC_KEY),
    ]);

  return {
    products: buildJobView({
      kind: "products",
      checkpoint: productsCheckpoint,
      lastSyncAt: productsLast,
      connectionId: params.connectionId,
    }),
    orders: buildJobView({
      kind: "orders",
      checkpoint: ordersCheckpoint,
      lastSyncAt: ordersLast,
      connectionId: params.connectionId,
    }),
  };
}
