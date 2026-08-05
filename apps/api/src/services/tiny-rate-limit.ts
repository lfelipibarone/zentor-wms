/** Limite documentado Olist v3: ~120 leituras/min (GET). */
import { TinyConnectionStatus, type TinyConnection } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const OLIST_DOCUMENTED_LIMIT_PER_MINUTE = 120;
export const TINY_MIN_REQUEST_INTERVAL_MS = Math.max(
  500,
  Number(process.env.TINY_MIN_REQUEST_INTERVAL_MS ?? 2_000) || 2_000,
);

export const TINY_MAX_429_RETRIES = 5;
export const TINY_RATE_LIMIT_WAIT_MIN_MS = 5_000;
export const TINY_RATE_LIMIT_WAIT_MAX_MS = 120_000;
export const TINY_RATE_LIMIT_WAIT_DEFAULT_MS = 60_000;
export const TINY_PROACTIVE_REMAINING_THRESHOLD = 8;

const rateLimitUntilByConnection = new Map<string, number>();
const documentedLimitByConnection = new Map<string, number>();

/** Atualiza o limite documentado da conexão a partir dos headers da API. */
export function updateConnectionDocumentedLimit(
  connectionId: string,
  headers: Headers,
): void {
  const limit = Number(headers.get("X-RateLimit-Limit"));
  if (Number.isFinite(limit) && limit > 0) {
    documentedLimitByConnection.set(connectionId, limit);
  }
}

export function getConnectionDocumentedLimit(connectionId: string): number {
  return (
    documentedLimitByConnection.get(connectionId) ??
    OLIST_DOCUMENTED_LIMIT_PER_MINUTE
  );
}

/** Intervalo mínimo entre requisições (~15% abaixo do limite/min do plano). */
export function getMinRequestIntervalMs(connectionId: string): number {
  const envOverride = Number(process.env.TINY_MIN_REQUEST_INTERVAL_MS ?? 0);
  if (Number.isFinite(envOverride) && envOverride > 0) {
    return Math.max(500, envOverride);
  }
  const limit = getConnectionDocumentedLimit(connectionId);
  return Math.max(500, Math.ceil((60_000 / limit) * 1.15));
}

export function isTinyRateLimitError(e: unknown): boolean {
  if (!(e instanceof Error) || e.name !== "TinyApiError") return false;
  const err = e as Error & { statusCode?: number; code?: string };
  return err.statusCode === 429 || err.code === "RATE_LIMIT";
}

export function readRateLimitUntilFromMetadata(metadata: unknown): number | null {
  const rec =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
  const raw = rec?.rateLimitUntil;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function buildRateLimitMetadata(
  metadata: unknown,
  untilMs: number,
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  base.rateLimitUntil = new Date(untilMs).toISOString();
  return base;
}

export function clearRateLimitMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const next = { ...(metadata as Record<string, unknown>) };
  delete next.rateLimitUntil;
  return next;
}

/** Segundos restantes até liberar (header Olist: segundos até reset da janela). */
export function parseRateLimitResetMs(headers: Headers): number {
  const resetSec = Number(headers.get("X-RateLimit-Reset") ?? 0);
  if (!Number.isFinite(resetSec) || resetSec <= 0) {
    return TINY_RATE_LIMIT_WAIT_DEFAULT_MS;
  }
  const waitMs = Math.ceil(resetSec * 1_000) + 1_000;
  return Math.min(
    TINY_RATE_LIMIT_WAIT_MAX_MS,
    Math.max(TINY_RATE_LIMIT_WAIT_MIN_MS, waitMs),
  );
}

/** Desacelera antes de esgotar a cota quando Remaining está baixo. */
export function proactiveRateLimitDelayMs(headers: Headers): number {
  const remaining = Number(headers.get("X-RateLimit-Remaining") ?? NaN);
  if (!Number.isFinite(remaining) || remaining > TINY_PROACTIVE_REMAINING_THRESHOLD) {
    return 0;
  }
  const resetMs = parseRateLimitResetMs(headers);
  return Math.min(30_000, resetMs);
}

export function getConnectionRateLimitUntil(connectionId: string): number {
  return rateLimitUntilByConnection.get(connectionId) ?? 0;
}

export function markConnectionRateLimited(
  connectionId: string,
  untilMs: number,
): number {
  const safeUntil = Math.max(Date.now(), untilMs);
  rateLimitUntilByConnection.set(connectionId, safeUntil);
  return safeUntil;
}

export function clearConnectionRateLimit(connectionId: string): void {
  rateLimitUntilByConnection.delete(connectionId);
}

export function formatRateLimitWaitMessage(untilMs: number): string {
  const seconds = Math.max(1, Math.ceil((untilMs - Date.now()) / 1_000));
  return `Rate limit Olist ERP: aguarde ~${seconds}s antes de novas chamadas à API.`;
}

const USABLE_TINY_STATUSES = new Set<TinyConnectionStatus>([
  TinyConnectionStatus.CONNECTED,
  TinyConnectionStatus.BLOCKED,
]);

/** Rate limit nunca deve exigir reconexão OAuth — normaliza BLOCKED legado para CONNECTED. */
export async function reconcileTinyConnectionRateLimit(
  conn: TinyConnection,
): Promise<TinyConnection> {
  if (!conn.accessToken || conn.deletedAt || !conn.isActive) {
    return conn;
  }

  const until = readRateLimitUntilFromMetadata(conn.metadata);
  const now = Date.now();
  const isLegacyBlocked = conn.status === TinyConnectionStatus.BLOCKED;
  const hasActiveCooldown = Boolean(until && until > now);

  if (!isLegacyBlocked && !hasActiveCooldown && !until) {
    return conn;
  }

  if (hasActiveCooldown) {
    markConnectionRateLimited(conn.id, until!);
    if (
      conn.status === TinyConnectionStatus.CONNECTED &&
      conn.lastError === formatRateLimitWaitMessage(until!)
    ) {
      return conn;
    }
    return prisma.tinyConnection.update({
      where: { id: conn.id },
      data: {
        status: TinyConnectionStatus.CONNECTED,
        lastError: formatRateLimitWaitMessage(until!),
        metadata: buildRateLimitMetadata(conn.metadata, until!) as object,
      },
    });
  }

  clearConnectionRateLimit(conn.id);
  if (
    conn.status === TinyConnectionStatus.CONNECTED &&
    !conn.lastError &&
    !until
  ) {
    return conn;
  }

  return prisma.tinyConnection.update({
    where: { id: conn.id },
    data: {
      status: TinyConnectionStatus.CONNECTED,
      lastError: null,
      metadata: clearRateLimitMetadata(conn.metadata) as object | undefined,
    },
  });
}

export async function recoverStaleTinyBlockedConnections(): Promise<number> {
  const blocked = await prisma.tinyConnection.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      accessToken: { not: null },
      status: TinyConnectionStatus.BLOCKED,
    },
    take: 50,
  });

  let recovered = 0;
  for (const conn of blocked) {
    const next = await reconcileTinyConnectionRateLimit(conn);
    if (next.status === TinyConnectionStatus.CONNECTED) recovered += 1;
  }
  return recovered;
}

export function isTinyConnectionUsableStatus(status: TinyConnectionStatus): boolean {
  return USABLE_TINY_STATUSES.has(status);
}
