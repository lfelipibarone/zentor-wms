import { prisma } from "../lib/prisma.js";
import { getTinyApiClient } from "./tiny-api-v3-client.js";
import {
  buildPedidoExpedicaoIndex,
  buscarEtiquetasExpedicao,
  buscarEtiquetasExpedicaoComConcluir,
  ensurePedidoInExpedicao,
  findPedidoNoIndice,
  listarAgrupamentosExpedicao,
  obterAgrupamentoExpedicao,
  obterEtiquetasAgrupamento,
  obterEtiquetasExpedicao,
  type ExpedicaoMatch,
} from "./tiny-expedicao-labels.js";

export type ShippingLabelStatus =
  | "OK"
  | "NOT_TINY_ORDER"
  | "NOT_IN_EXPEDICAO"
  | "CREATE_EXPEDICAO_ERROR"
  | "MARKETPLACE_ERROR"
  | "NO_URLS"
  | "API_ERROR";

export type ShippingLabelResult = {
  status: ShippingLabelStatus;
  urls: string[];
  message?: string;
  expedicao?: { idAgrupamento: number; idExpedicao: number };
  formaEnvioNome?: string | null;
  cached: boolean;
  createdAgrupamento?: boolean;
  concludedAgrupamento?: boolean;
  labelFormat?: "zpl" | "pdf" | "unknown";
};

export function parseTinyPedidoId(erpOrderId: string): number | null {
  const m = erpOrderId.trim().match(/^TINY-(\d+)$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function detectLabelFormat(url: string): "zpl" | "pdf" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes(".zpl") || lower.endsWith("zpl")) return "zpl";
  if (lower.includes(".pdf") || lower.endsWith("pdf")) return "pdf";
  return "unknown";
}

function labelFilename(erpOrderId: string, url: string): string {
  const ext = detectLabelFormat(url) === "pdf" ? "pdf" : "zpl";
  const safe = erpOrderId.replace(/[^\w.-]+/g, "_");
  return `etiqueta-${safe}.${ext}`;
}

async function resolveLabelUrl(params: {
  tenantId: string;
  orderId: string;
  useCache?: boolean;
}): Promise<
  | { ok: true; url: string; erpOrderId: string }
  | { ok: false; result: ShippingLabelResult }
> {
  const result = await fetchShippingLabelsForOrder(params);
  if (result.status !== "OK" || result.urls.length === 0) {
    return { ok: false, result };
  }

  const order = await prisma.order.findFirst({
    where: { id: params.orderId, tenantId: params.tenantId },
    select: { erpOrderId: true },
  });

  return {
    ok: true,
    url: result.urls[0]!,
    erpOrderId: order?.erpOrderId ?? params.orderId,
  };
}

export async function fetchShippingLabelFile(params: {
  tenantId: string;
  orderId: string;
  useCache?: boolean;
}): Promise<
  | {
      ok: true;
      content: Buffer;
      contentType: string;
      filename: string;
      sourceUrl: string;
    }
  | { ok: false; result: ShippingLabelResult }
> {
  const resolved = await resolveLabelUrl(params);
  if (!resolved.ok) return resolved;

  const { url, erpOrderId } = resolved;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    return {
      ok: false,
      result: {
        status: "API_ERROR",
        urls: [url],
        message: `Não foi possível baixar a etiqueta (${res.status}).`,
        cached: false,
      },
    };
  }

  const content = Buffer.from(await res.arrayBuffer());
  const format = detectLabelFormat(url);
  const contentType =
    format === "pdf"
      ? "application/pdf"
      : format === "zpl"
        ? "text/plain; charset=utf-8"
        : (res.headers.get("content-type") ?? "application/octet-stream");

  return {
    ok: true,
    content,
    contentType,
    filename: labelFilename(erpOrderId, url),
    sourceUrl: url,
  };
}

const LABELARY_RENDER_URLS = [
  "https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/",
  "https://api.labelary.com/v1/printers/12dpmm/labels/10x15/0/",
  "https://api.labelary.com/v1/printers/8dpmm/labels/10x15/0/",
];

async function renderZplToPng(zpl: string): Promise<Buffer> {
  let lastError: Error | null = null;

  for (const url of LABELARY_RENDER_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "image/png",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: zpl,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        lastError = new Error(
          `Renderizador retornou ${res.status} para ${url}`,
        );
        continue;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw new Error(
    lastError?.message ??
      "Não foi possível gerar a visualização da etiqueta ZPL.",
  );
}

export async function fetchShippingLabelPreview(params: {
  tenantId: string;
  orderId: string;
  useCache?: boolean;
}): Promise<
  | {
      ok: true;
      content: Buffer;
      contentType: "image/png" | "application/pdf";
      sourceUrl: string;
    }
  | { ok: false; result: ShippingLabelResult }
> {
  const file = await fetchShippingLabelFile(params);
  if (!file.ok) return file;

  const format = detectLabelFormat(file.sourceUrl);
  if (format === "pdf") {
    return {
      ok: true,
      content: file.content,
      contentType: "application/pdf",
      sourceUrl: file.sourceUrl,
    };
  }

  try {
    const zpl = file.content.toString("utf-8");
    const png = await renderZplToPng(zpl);
    return {
      ok: true,
      content: png,
      contentType: "image/png",
      sourceUrl: file.sourceUrl,
    };
  } catch (e) {
    return {
      ok: false,
      result: {
        status: "API_ERROR",
        urls: [file.sourceUrl],
        message:
          e instanceof Error
            ? e.message
            : "Erro ao gerar visualização da etiqueta",
        cached: false,
      },
    };
  }
}

export async function fetchShippingLabelsForOrder(params: {
  tenantId: string;
  orderId: string;
  useCache?: boolean;
}): Promise<ShippingLabelResult> {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, tenantId: params.tenantId },
    select: {
      id: true,
      erpOrderId: true,
      shippingLabel: true,
    },
  });

  if (!order) {
    return {
      status: "API_ERROR",
      urls: [],
      message: "Pedido não encontrado",
      cached: false,
    };
  }

  if (params.useCache !== false && order.shippingLabel) {
    return {
      status: "OK",
      urls: [order.shippingLabel],
      cached: true,
      labelFormat: detectLabelFormat(order.shippingLabel),
    };
  }

  const pedidoId = parseTinyPedidoId(order.erpOrderId);
  if (!pedidoId) {
    return {
      status: "NOT_TINY_ORDER",
      urls: [],
      message: "Etiqueta de envio só está disponível para pedidos Tiny (TINY-{id}).",
      cached: false,
    };
  }

  let client;
  try {
    client = await getTinyApiClient(params.tenantId);
  } catch (e) {
    return {
      status: "API_ERROR",
      urls: [],
      message: e instanceof Error ? e.message : "Tiny não conectado",
      cached: false,
    };
  }

  let match: ExpedicaoMatch | null;
  let createdAgrupamento = false;

  try {
    const index = await buildPedidoExpedicaoIndex(client);
    match = findPedidoNoIndice(index, pedidoId);
  } catch (e) {
    return {
      status: "API_ERROR",
      urls: [],
      message: e instanceof Error ? e.message : "Erro ao listar expedição no Tiny",
      cached: false,
    };
  }

  if (!match) {
    try {
      const ensured = await ensurePedidoInExpedicao(client, pedidoId);
      match = ensured.match;
      createdAgrupamento = ensured.createdAgrupamento;
      if (!match) {
        if (ensured.error && ensured.createdAgrupamento) {
          return {
            status: "CREATE_EXPEDICAO_ERROR",
            urls: [],
            message: ensured.error,
            cached: false,
            createdAgrupamento,
          };
        }
        return {
          status: "NOT_IN_EXPEDICAO",
          urls: [],
          message:
            ensured.error ??
            "Pedido não está em agrupamento de expedição no Tiny. Agrupe na expedição antes de imprimir a etiqueta.",
          cached: false,
          createdAgrupamento,
        };
      }
    } catch (e) {
      return {
        status: "CREATE_EXPEDICAO_ERROR",
        urls: [],
        message: e instanceof Error ? e.message : "Erro ao criar agrupamento no Tiny",
        cached: false,
      };
    }
  }

  const { urls, marketplaceError, concludedAgrupamento } =
    await buscarEtiquetasExpedicaoComConcluir(client, match);
  const formaEnvioNome = match.formaEnvioNome ?? null;

  if (urls.length === 0 && marketplaceError) {
    return {
      status: "MARKETPLACE_ERROR",
      urls: [],
      expedicao: match,
      formaEnvioNome,
      message: marketplaceError,
      cached: false,
      createdAgrupamento,
      concludedAgrupamento,
    };
  }

  if (urls.length === 0) {
    return {
      status: "NO_URLS",
      urls: [],
      expedicao: match,
      formaEnvioNome,
      message:
        "Expedição encontrada, mas a API não retornou URL de etiqueta. Verifique se a etiqueta já foi gerada no ERP/marketplace.",
      cached: false,
      createdAgrupamento,
      concludedAgrupamento,
    };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { shippingLabel: urls[0] },
  });

  return {
    status: "OK",
    urls,
    expedicao: match,
    formaEnvioNome,
    cached: false,
    createdAgrupamento,
    concludedAgrupamento,
    labelFormat: detectLabelFormat(urls[0]!),
  };
}

export {
  listarAgrupamentosExpedicao,
  obterAgrupamentoExpedicao,
  obterEtiquetasAgrupamento,
  obterEtiquetasExpedicao,
  buscarEtiquetasExpedicao,
  buildPedidoExpedicaoIndex,
};
