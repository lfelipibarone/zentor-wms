import { prisma } from "../lib/prisma.js";
import { fetchShippingLabelsForOrder } from "./tiny-shipping-labels.js";

const MAX_ATTEMPTS = 3;
const RETRY_MS = 1_500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gera (ou reusa) etiqueta de um pedido, com retry. Persiste erro em shippingLabelError. */
export async function ensureOrderShippingLabel(
  tenantId: string,
  orderId: string,
  opts?: { force?: boolean; maxAttempts?: number },
): Promise<{ ok: boolean; message?: string }> {
  const maxAttempts = opts?.maxAttempts ?? MAX_ATTEMPTS;
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    select: { id: true, shippingLabel: true },
  });
  if (!order) return { ok: false, message: "Pedido não encontrado" };

  if (!opts?.force && order.shippingLabel) {
    await prisma.order.update({
      where: { id: orderId },
      data: { shippingLabelError: null },
    });
    return { ok: true };
  }

  let lastMessage = "Falha ao gerar etiqueta";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fetchShippingLabelsForOrder({
      tenantId,
      orderId,
      useCache: !opts?.force && attempt === 1,
    });
    if (result.status === "OK" && result.urls.length > 0) {
      await prisma.order.update({
        where: { id: orderId },
        data: { shippingLabelError: null },
      });
      return { ok: true };
    }
    lastMessage = result.message ?? lastMessage;
    if (attempt < maxAttempts) await sleep(RETRY_MS * attempt);
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { shippingLabelError: lastMessage.slice(0, 500) },
  });
  return { ok: false, message: lastMessage };
}

/** Todos os pedidos da onda (ex.: 10/10). Não bloqueia o caller — agenda em background. */
export function scheduleWaveShippingLabels(tenantId: string, waveId: string): void {
  void (async () => {
    const rows = await prisma.pickWaveOrder.findMany({
      where: { waveId, wave: { tenantId } },
      select: { orderId: true },
    });
    // Também cobre pedidos só via allocation (wave.orders vazio)
    const fromAlloc = await prisma.pickWaveAllocation.findMany({
      where: { waveLine: { waveId, wave: { tenantId } } },
      select: { orderItem: { select: { orderId: true } } },
    });
    const ids = [
      ...new Set([
        ...rows.map((r) => r.orderId),
        ...fromAlloc.map((a) => a.orderItem.orderId),
      ]),
    ];
    for (const orderId of ids) {
      try {
        await ensureOrderShippingLabel(tenantId, orderId);
      } catch (e) {
        console.error(
          `[ensure-shipping-labels] wave=${waveId} order=${orderId}`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  })().catch((e) => {
    console.error(
      `[ensure-shipping-labels] wave=${waveId}`,
      e instanceof Error ? e.message : e,
    );
  });
}

export function scheduleOrderShippingLabel(tenantId: string, orderId: string): void {
  void ensureOrderShippingLabel(tenantId, orderId).catch((e) => {
    console.error(
      `[ensure-shipping-labels] order=${orderId}`,
      e instanceof Error ? e.message : e,
    );
  });
}

export async function ensureWaveShippingLabelsNow(
  tenantId: string,
  waveId: string,
): Promise<{ total: number; ok: number; failed: Array<{ orderId: string; message: string }> }> {
  const rows = await prisma.pickWaveOrder.findMany({
    where: { waveId, wave: { tenantId } },
    select: { orderId: true },
  });
  const fromAlloc = await prisma.pickWaveAllocation.findMany({
    where: { waveLine: { waveId, wave: { tenantId } } },
    select: { orderItem: { select: { orderId: true } } },
  });
  const ids = [
    ...new Set([
      ...rows.map((r) => r.orderId),
      ...fromAlloc.map((a) => a.orderItem.orderId),
    ]),
  ];
  let ok = 0;
  const failed: Array<{ orderId: string; message: string }> = [];
  for (const orderId of ids) {
    const result = await ensureOrderShippingLabel(tenantId, orderId, { force: false });
    if (result.ok) ok++;
    else failed.push({ orderId, message: result.message ?? "Erro" });
  }
  return { total: ids.length, ok, failed };
}
