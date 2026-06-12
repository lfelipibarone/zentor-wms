import { getTinyApiClient } from "./tiny-api-v3-client.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parsePriorityNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === "object") {
    const rec = asRecord(v);
    if (rec) {
      return (
        parsePriorityNumber(rec.valor) ??
        parsePriorityNumber(rec.value) ??
        parsePriorityNumber(rec.nivel) ??
        parsePriorityNumber(rec.id)
      );
    }
  }
  return null;
}

const PRIORITY_KEYS = [
  "prioridade",
  "priority",
  "nivel_prioridade",
  "prioridade_pedido",
  "prioridadePedido",
  "nivelPrioridade",
] as const;

/** Extrai prioridade bruta de payload Tiny (webhook ou GET pedido). */
export function extractTinyPriorityFromRecord(
  root: Record<string, unknown>,
): number | null {
  const pedido =
    asRecord(root.pedido) ??
    asRecord(root.order) ??
    asRecord(root.venda) ??
    root;

  for (const key of PRIORITY_KEYS) {
    const fromPedido = parsePriorityNumber(pedido[key]);
    if (fromPedido !== null) return fromPedido;
    const fromRoot = parsePriorityNumber(root[key]);
    if (fromRoot !== null) return fromRoot;
  }

  return null;
}

/**
 * Normaliza prioridade Tiny para escala WMS 0–100.
 * - Valores 0–100: clamp direto
 * - Valores 1–5 ou 1–10: mapeia linearmente para 20–100
 */
export function normalizeTinyPriority(raw: number): number {
  const n = Math.floor(raw);
  if (!Number.isFinite(n)) return 0;
  if (n >= 1 && n <= 5) {
    return Math.min(100, Math.round(20 + ((n - 1) / 4) * 80));
  }
  if (n >= 6 && n <= 10) {
    return Math.min(100, Math.round(20 + ((n - 1) / 9) * 80));
  }
  if (n >= 0 && n <= 100) return n;
  return Math.min(100, Math.max(0, n));
}

export function parseTinyPedidoIdFromErpOrderId(
  erpOrderId: string,
): number | null {
  const m = erpOrderId.match(/^TINY-(\d+)$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

export async function fetchTinyOrderPriority(
  tenantId: string,
  erpOrderId: string,
  userId?: string,
): Promise<number | null> {
  const pedidoId = parseTinyPedidoIdFromErpOrderId(erpOrderId);
  if (pedidoId === null) return null;

  try {
    const client = await getTinyApiClient({ tenantId, userId });
    const body = await client.getPedido(pedidoId);
    const raw = extractTinyPriorityFromRecord(body);
    return raw !== null ? normalizeTinyPriority(raw) : null;
  } catch {
    return null;
  }
}
