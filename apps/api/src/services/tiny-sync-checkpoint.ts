import { prisma } from "../lib/prisma.js";

/** Checkpoint válido por até 24h — cobre restart do servidor no meio do sync. */
export const TINY_SYNC_CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
};

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

export async function readTinySyncCheckpoint(
  tenantId: string,
  key: string,
): Promise<TinySyncCheckpointState | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  return parseTinySyncCheckpoint(row?.value);
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
