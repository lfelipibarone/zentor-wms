import { prisma } from "../lib/prisma.js";
import { getTinyApiClient, TinyApiError } from "./tiny-api-v3-client.js";
import { isTinyConnectedError } from "./tiny-purchase-receipt.js";
import { logIntegrationEvent } from "./tiny-integration.js";
import {
  isTinyProductSituacaoSyncable,
  parseTinyProductDetail,
  upsertProductFromTiny,
} from "./tiny-product-sync.js";
import {
  clearTinySyncCheckpoint,
  isTinySyncCheckpointResumable,
  readTinySyncCheckpoint,
  writeTinySyncCheckpoint,
  type TinySyncCheckpointState,
} from "./tiny-sync-checkpoint.js";

const LAST_SYNC_KEY = "tiny.products.lastSyncAt";
const CHECKPOINT_KEY = "tiny.products.syncCheckpoint";
const LIST_PAGE_SIZE = 100;
const MAX_OFFSET = 10_000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function normalizeSkuKey(sku: string): string {
  return sku.trim().toUpperCase();
}

async function setLastSyncAt(tenantId: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId, key: LAST_SYNC_KEY } },
    create: {
      tenantId,
      key: LAST_SYNC_KEY,
      value: new Date().toISOString(),
    },
    update: { value: new Date().toISOString() },
  });
}

async function loadExistingSkuSet(tenantId: string): Promise<Set<string>> {
  const rows = await prisma.product.findMany({
    where: { tenantId },
    select: { sku: true },
  });
  return new Set(rows.map((r) => normalizeSkuKey(r.sku)));
}

export type SyncProductsResult = {
  created: number;
  updated: number;
  skipped: number;
  /** Já existiam no WMS — não buscou detalhe na API Tiny */
  skippedExisting: number;
  listedFromTiny: number;
  errors: Array<{ sku: string; message: string }>;
  tinyConnected: boolean;
  resumed: boolean;
  fromOffset: number;
  warning?: string;
};

export async function syncProductsFromTiny(params: {
  tenantId: string;
  userId?: string;
  connectionId?: string;
  /** Ignora checkpoint e recomeça da página 0 */
  forceRestart?: boolean;
  /** Reimporta detalhe mesmo quando o SKU já existe no WMS */
  refreshExisting?: boolean;
}): Promise<SyncProductsResult> {
  const result: SyncProductsResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    skippedExisting: 0,
    listedFromTiny: 0,
    errors: [],
    tinyConnected: false,
    resumed: false,
    fromOffset: 0,
  };

  let client;
  try {
    client = await getTinyApiClient({
      tenantId: params.tenantId,
      userId: params.userId,
      connectionId: params.connectionId,
    });
  } catch (e) {
    if (isTinyConnectedError(e) || e instanceof TinyApiError) {
      return {
        ...result,
        tinyConnected: false,
        warning:
          "Tiny ERP não conectado. Configure OAuth em Integrações → Tiny.",
      };
    }
    throw e;
  }

  result.tinyConnected = true;

  if (params.forceRestart) {
    await clearTinySyncCheckpoint(params.tenantId, CHECKPOINT_KEY);
  }

  const savedCheckpoint = await readTinySyncCheckpoint(
    params.tenantId,
    CHECKPOINT_KEY,
  );
  const resume = isTinySyncCheckpointResumable(savedCheckpoint, {
    connectionId: params.connectionId,
    forceRestart: params.forceRestart,
  });

  let offset = resume ? savedCheckpoint!.offset : 0;
  result.resumed = resume;
  result.fromOffset = offset;

  const skipExisting = !params.refreshExisting;
  const existingSkus = skipExisting
    ? await loadExistingSkuSet(params.tenantId)
    : new Set<string>();

  const startedAt = resume
    ? savedCheckpoint!.startedAt
    : new Date().toISOString();
  const connectionId = params.connectionId?.trim() || null;

  let total = resume ? savedCheckpoint!.total ?? Infinity : Infinity;
  let checkpointSaved = false;

  const persistCheckpoint = async (nextOffset: number, pageTotal: number) => {
    const state: TinySyncCheckpointState = {
      status: "running",
      kind: "products",
      offset: nextOffset,
      total: Number.isFinite(pageTotal) ? pageTotal : null,
      startedAt,
      updatedAt: new Date().toISOString(),
      connectionId,
    };
    await writeTinySyncCheckpoint(params.tenantId, CHECKPOINT_KEY, state);
    checkpointSaved = true;
  };

  try {
    while (offset < total) {
      const page = await client.listProdutos({
        limit: LIST_PAGE_SIZE,
        offset,
      });
      result.listedFromTiny += page.items.length;

      for (const raw of page.items) {
        const row = asRecord(raw);
        if (!row) continue;

        const tinyProductId = num(row.id);
        const listSku = str(row.sku) ?? `TINY-${tinyProductId || "?"}`;
        const listSituacao = str(row.situacao)?.toUpperCase() ?? null;

        if (!tinyProductId) {
          result.skipped += 1;
          continue;
        }

        if (!isTinyProductSituacaoSyncable(listSituacao)) {
          result.skipped += 1;
          continue;
        }

        const skuKey = normalizeSkuKey(listSku);
        if (skipExisting && existingSkus.has(skuKey)) {
          result.skippedExisting += 1;
          continue;
        }

        try {
          const detail = await client.getProduto(tinyProductId);
          const payloads = parseTinyProductDetail(detail);

          if (payloads.length === 0) {
            result.skipped += 1;
            continue;
          }

          for (const payload of payloads) {
            const payloadKey = normalizeSkuKey(payload.sku);
            if (skipExisting && existingSkus.has(payloadKey)) {
              result.skippedExisting += 1;
              continue;
            }

            try {
              const upsert = await upsertProductFromTiny(
                params.tenantId,
                payload,
              );
              existingSkus.add(payloadKey);
              if (upsert.created) {
                result.created += 1;
              } else {
                result.updated += 1;
              }
            } catch (e) {
              const message =
                e instanceof Error ? e.message : "Erro ao salvar produto";
              result.errors.push({ sku: payload.sku, message });
            }
          }
        } catch (e) {
          const message =
            e instanceof Error
              ? e.message
              : "Erro ao buscar detalhe do produto";
          result.errors.push({ sku: listSku, message });
        }
      }

      const pag = asRecord(page.pagination);
      total = num(pag?.total) || page.items.length;
      const nextOffset = offset + LIST_PAGE_SIZE;

      if (page.items.length < LIST_PAGE_SIZE) {
        offset = nextOffset;
        break;
      }

      offset = nextOffset;
      if (offset > MAX_OFFSET) break;

      await persistCheckpoint(offset, total);
    }

    await clearTinySyncCheckpoint(params.tenantId, CHECKPOINT_KEY);
    await setLastSyncAt(params.tenantId);
  } catch (e) {
    if (!checkpointSaved && offset > result.fromOffset) {
      await persistCheckpoint(offset, total).catch(() => undefined);
    }
    throw e;
  }

  if (result.resumed) {
    result.warning =
      `Sync retomado do offset ${result.fromOffset}. ` +
      (result.skippedExisting > 0
        ? `${result.skippedExisting} SKU(s) já cadastrado(s) foram ignorados. `
        : "") +
      "Use «Recomeçar do zero» para forçar reimportação completa.";
  } else if (result.skippedExisting > 0) {
    result.warning = `${result.skippedExisting} SKU(s) já cadastrado(s) no WMS — detalhe não buscado na API Tiny.`;
  }

  if (result.listedFromTiny === 0 && result.skippedExisting === 0) {
    result.warning =
      "A API Tiny não retornou produtos. Confira se existem produtos cadastrados no ERP e se o aplicativo OAuth tem permissão de Produtos.";
  } else if (
    result.created === 0 &&
    result.updated === 0 &&
    result.errors.length === 0 &&
    result.skippedExisting === 0
  ) {
    result.warning =
      `${result.listedFromTiny} produto(s) listado(s), mas nenhum foi importado (todos excluídos ou sem SKU).`;
  }

  await logIntegrationEvent({
    tenantId: params.tenantId,
    source: "TINY",
    eventType: "sync_products",
    status: result.errors.length > 0 ? "ERROR" : "OK",
    message: `Criados: ${result.created}, atualizados: ${result.updated}, ignorados: ${result.skipped}, já no WMS: ${result.skippedExisting}${result.resumed ? ", retomado" : ""}`,
    payload: {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      skippedExisting: result.skippedExisting,
      listedFromTiny: result.listedFromTiny,
      errorCount: result.errors.length,
      resumed: result.resumed,
      fromOffset: result.fromOffset,
    },
  });

  return result;
}
