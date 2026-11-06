import { unzipSync } from "fflate";
import { prisma } from "../lib/prisma.js";
import { getTinyApiClient } from "./tiny-api-v3-client.js";
import {
  buildPedidoExpedicaoIndex,
  buscarEtiquetasExpedicao,
  buscarEtiquetasExpedicaoComConcluir,
  ensurePedidoInExpedicao,
  findPedidoNoIndice,
  isOneStepRetryable,
  listarAgrupamentosExpedicao,
  obterAgrupamentoExpedicao,
  obterEtiquetasAgrupamento,
  obterEtiquetasExpedicao,
  oneStepShippingEtiquetas,
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

/** Marcador interno: etiqueta ZPL simulada (pedidos DEMO-PACK-*). */
export const DEMO_LABEL_SCHEME = "wms-demo-zpl:";

export function isDemoPackErpOrderId(erpOrderId: string): boolean {
  return erpOrderId.trim().toUpperCase().startsWith("DEMO-PACK-");
}

export function detectLabelFormat(url: string): "zpl" | "pdf" | "zip" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.startsWith(DEMO_LABEL_SCHEME) || lower.includes(".zpl") || lower.endsWith("zpl")) {
    return "zpl";
  }
  if (lower.includes(".pdf") || lower.endsWith("pdf")) return "pdf";
  if (lower.includes(".zip") || lower.endsWith("zip")) return "zip";
  return "unknown";
}

/** Formato exposto na API (ZIP é envelope; o conteúdo impresso é ZPL/PDF). */
export function apiLabelFormat(
  url: string,
): "zpl" | "pdf" | "unknown" {
  const f = detectLabelFormat(url);
  return f === "zip" ? "unknown" : f;
}

export function isZipBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
  );
}

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("utf-8") === "%PDF-";
}

function entryBaseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

export function looksLikeZpl(text: string): boolean {
  return /\^XA/i.test(text) || /~DG/i.test(text);
}

function classifyLabelBytes(
  content: Buffer,
  hint?: "zpl" | "pdf" | "unknown" | null,
): {
  content: Buffer;
  format: "zpl" | "pdf" | "unknown";
  contentType: string;
  filenameHint: string | null;
} {
  if (isPdfBuffer(content) || hint === "pdf") {
    return {
      content,
      format: "pdf",
      contentType: "application/pdf",
      filenameHint: null,
    };
  }

  const text = content.toString("utf-8");
  if (looksLikeZpl(text) || hint === "zpl") {
    return {
      content: Buffer.from(text, "utf-8"),
      format: "zpl",
      contentType: "text/plain; charset=utf-8",
      filenameHint: null,
    };
  }

  return {
    content,
    format: "unknown",
    contentType: "application/octet-stream",
    filenameHint: null,
  };
}

/**
 * Normaliza o que a Tiny/marketplace devolve:
 * - ZIP (Shopee etc.) → extrai ZPL/PDF de dentro
 * - ZPL direto (Correios / link .zpl / corpo sem extensão)
 * - PDF direto (Amazon / alguns carriers)
 *
 * Não depende do canal: classifica pelo conteúdo (+ dica da URL).
 */
export function unwrapShippingLabelPayload(
  content: Buffer,
  sourceUrl: string,
): {
  content: Buffer;
  format: "zpl" | "pdf" | "unknown";
  contentType: string;
  filenameHint: string | null;
  fromZip: boolean;
} {
  const urlFormat = detectLabelFormat(sourceUrl);
  const urlHint =
    urlFormat === "pdf" || urlFormat === "zpl" ? urlFormat : null;

  if (urlFormat !== "zip" && !isZipBuffer(content)) {
    const classified = classifyLabelBytes(content, urlHint);
    return { ...classified, fromZip: false };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(content));
  } catch {
    return {
      content,
      format: "unknown",
      contentType: "application/zip",
      filenameHint: null,
      fromZip: true,
    };
  }

  const files = Object.entries(entries)
    .filter(([name, data]) => data.length > 0 && !name.endsWith("/"))
    .map(([name, data]) => ({
      name,
      base: entryBaseName(name).toLowerCase(),
      data: Buffer.from(data),
    }));

  const pick =
    files.find((f) => f.base.endsWith(".zpl")) ??
    files.find((f) => f.base.endsWith(".txt") && looksLikeZpl(f.data.toString("utf-8"))) ??
    files.find((f) => f.base.endsWith(".pdf") || isPdfBuffer(f.data)) ??
    files.find((f) => looksLikeZpl(f.data.toString("utf-8"))) ??
    files[0];

  if (!pick) {
    return {
      content,
      format: "unknown",
      contentType: "application/zip",
      filenameHint: null,
      fromZip: true,
    };
  }

  const entryHint: "zpl" | "pdf" | "unknown" | null = pick.base.endsWith(".pdf")
    ? "pdf"
    : pick.base.endsWith(".zpl") || pick.base.endsWith(".txt")
      ? "zpl"
      : null;
  const classified = classifyLabelBytes(pick.data, entryHint);
  return {
    ...classified,
    filenameHint: classified.format === "zpl"
      ? entryBaseName(pick.name).replace(/\.txt$/i, ".zpl")
      : entryBaseName(pick.name),
    fromZip: true,
  };
}

export function buildDemoShippingLabelZpl(input: {
  erpOrderId: string;
  customerName?: string | null;
  marketplace?: string | null;
  basketCode?: string | null;
}): string {
  const erp = (input.erpOrderId || "DEMO").slice(0, 40);
  const cliente = (input.customerName || "Cliente demo").slice(0, 40);
  const market = (input.marketplace || "DEMO").slice(0, 24);
  const cesta = (input.basketCode || "—").slice(0, 20);
  // Escapa ^ em campos ZPL
  const esc = (s: string) => s.replace(/\^/g, " ");
  return [
    "^XA",
    "^CF0,36",
    "^FO40,40^FDWMS · ETIQUETA SIMULADA^FS",
    "^CF0,28",
    `^FO40,100^FDPedido: ${esc(erp)}^FS`,
    `^FO40,150^FDCliente: ${esc(cliente)}^FS`,
    `^FO40,200^FDCanal: ${esc(market)}^FS`,
    `^FO40,250^FDCesta: ${esc(cesta)}^FS`,
    "^CF0,24",
    "^FO40,310^FDNAO ENVIA — so para teste de impressao^FS",
    `^FO40,380^BY2^BCN,80,Y,N,N^FD${esc(erp)}^FS`,
    "^XZ",
    "",
  ].join("\n");
}

function labelFilename(
  erpOrderId: string,
  format: "zpl" | "pdf" | "zip" | "unknown",
  hint?: string | null,
): string {
  if (hint && /\.(zpl|pdf|txt)$/i.test(hint)) {
    const safeHint = hint.replace(/[^\w.-]+/g, "_");
    return safeHint.toLowerCase().endsWith(".txt")
      ? safeHint.replace(/\.txt$/i, ".zpl")
      : safeHint;
  }
  const ext = format === "pdf" ? "pdf" : "zpl";
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

  if (url.startsWith(DEMO_LABEL_SCHEME)) {
    const demoOrder = await prisma.order.findFirst({
      where: { id: params.orderId, tenantId: params.tenantId },
      select: {
        erpOrderId: true,
        customerName: true,
        marketplace: true,
        basket: { select: { code: true } },
      },
    });
    const zpl = buildDemoShippingLabelZpl({
      erpOrderId: demoOrder?.erpOrderId ?? erpOrderId,
      customerName: demoOrder?.customerName,
      marketplace: demoOrder?.marketplace,
      basketCode: demoOrder?.basket?.code,
    });
    return {
      ok: true,
      content: Buffer.from(zpl, "utf-8"),
      contentType: "text/plain; charset=utf-8",
      filename: labelFilename(erpOrderId, "zpl"),
      sourceUrl: url,
    };
  }

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

  const raw = Buffer.from(await res.arrayBuffer());
  const headerCt = (res.headers.get("content-type") ?? "").toLowerCase();
  // Dica extra quando a URL não tem extensão (comum em S3 da Tiny).
  const urlForDetect = headerCt.includes("pdf")
    ? `${url}.pdf`
    : headerCt.includes("zip")
      ? `${url}.zip`
      : headerCt.includes("zpl") || headerCt.includes("text/plain")
        ? `${url}.zpl`
        : url;
  const unwrapped = unwrapShippingLabelPayload(raw, urlForDetect);
  if (unwrapped.format === "unknown") {
    return {
      ok: false,
      result: {
        status: "API_ERROR",
        urls: [url],
        message: unwrapped.fromZip
          ? "A Tiny retornou um ZIP de etiqueta, mas não foi possível extrair ZPL/PDF de dentro."
          : "A Tiny retornou um arquivo de etiqueta sem ZPL/PDF reconhecível.",
        cached: false,
      },
    };
  }

  return {
    ok: true,
    content: unwrapped.content,
    contentType: unwrapped.contentType,
    filename: labelFilename(erpOrderId, unwrapped.format, unwrapped.filenameHint),
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

  if (file.contentType.includes("pdf") || isPdfBuffer(file.content)) {
    return {
      ok: true,
      content: file.content,
      contentType: "application/pdf",
      sourceUrl: file.sourceUrl,
    };
  }

  try {
    const zpl = file.content.toString("utf-8");
    if (!looksLikeZpl(zpl)) {
      return {
        ok: false,
        result: {
          status: "API_ERROR",
          urls: [file.sourceUrl],
          message: "Conteúdo da etiqueta não é ZPL/PDF reconhecível para preview.",
          cached: false,
        },
      };
    }
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
      customerName: true,
      marketplace: true,
      basket: { select: { code: true } },
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
      labelFormat: apiLabelFormat(order.shippingLabel),
      message: order.shippingLabel.startsWith(DEMO_LABEL_SCHEME)
        ? "Etiqueta simulada (demo)"
        : undefined,
    };
  }

  // Pedidos de teste local: ZPL fictício para exercitar gerar/imprimir sem Tiny.
  if (isDemoPackErpOrderId(order.erpOrderId)) {
    const demoUrl = `${DEMO_LABEL_SCHEME}${order.id}`;
    await prisma.order.update({
      where: { id: order.id },
      data: { shippingLabel: demoUrl, shippingLabelError: null },
    });
    return {
      status: "OK",
      urls: [demoUrl],
      cached: false,
      labelFormat: "zpl",
      message: "Etiqueta simulada (demo) — pronta para imprimir",
      formaEnvioNome: "Demo / simulação",
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

  let match: ExpedicaoMatch | null = null;
  let createdAgrupamento = false;
  let concludedAgrupamento = false;
  let formaEnvioNome: string | null = null;
  let oneStepMarketplaceError: string | null = null;

  // One Step primeiro (idempotente): evita varredura lenta de agrupamentos e
  // o POST /expedicao clássico que cria lote vazio em Mercado Envios.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const oneStep = await oneStepShippingEtiquetas(client, pedidoId);
    if (oneStep.unsupported) break;

    if (oneStep.item?.urls.length) {
      createdAgrupamento = true;
      concludedAgrupamento = true;
      const urls = oneStep.item.urls;
      const expedicao =
        oneStep.item.idAgrupamento && oneStep.item.idExpedicao
          ? {
              idAgrupamento: oneStep.item.idAgrupamento,
              idExpedicao: oneStep.item.idExpedicao,
            }
          : undefined;
      await prisma.order.update({
        where: { id: order.id },
        data: { shippingLabel: urls[0], shippingLabelError: null },
      });
      return {
        status: "OK",
        urls,
        expedicao,
        formaEnvioNome,
        cached: false,
        createdAgrupamento,
        concludedAgrupamento,
        labelFormat: apiLabelFormat(urls[0]!),
        message: "Etiqueta gerada via One Step Shipping (Tiny)",
      };
    }

    if (oneStep.item?.idAgrupamento && oneStep.item.idExpedicao) {
      match = {
        idAgrupamento: oneStep.item.idAgrupamento,
        idExpedicao: oneStep.item.idExpedicao,
        pedidoId,
        formaEnvioNome,
      };
      createdAgrupamento = true;
      concludedAgrupamento = true;
    }

    oneStepMarketplaceError =
      oneStep.item?.erro?.mensagem ?? oneStep.error ?? oneStepMarketplaceError;

    if (isOneStepRetryable(oneStep.item) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
      continue;
    }

    // Expedição ok no Tiny, mas ML/Shopee/Amazon não liberou a URL.
    if (oneStepMarketplaceError && (match || oneStep.item?.erro)) {
      return {
        status: "MARKETPLACE_ERROR",
        urls: [],
        expedicao: match ?? undefined,
        formaEnvioNome,
        message: oneStepMarketplaceError,
        cached: false,
        createdAgrupamento,
        concludedAgrupamento,
      };
    }

    break;
  }

  // Fallback clássico (TRANSPORTADORA / CUSTOMIZADO ou One Step indisponível).
  if (!match) {
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
  }

  if (!match) {
    try {
      const ensured = await ensurePedidoInExpedicao(client, pedidoId);
      match = ensured.match;
      createdAgrupamento = ensured.createdAgrupamento || createdAgrupamento;
      if (!match) {
        if (oneStepMarketplaceError) {
          return {
            status: "MARKETPLACE_ERROR",
            urls: [],
            message: oneStepMarketplaceError,
            cached: false,
            createdAgrupamento,
            concludedAgrupamento,
          };
        }
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

  formaEnvioNome = match.formaEnvioNome ?? formaEnvioNome;
  const { urls, marketplaceError, concludedAgrupamento: concludedAgain } =
    await buscarEtiquetasExpedicaoComConcluir(client, match);
  concludedAgrupamento = concludedAgrupamento || Boolean(concludedAgain);

  if (urls.length === 0 && (marketplaceError || oneStepMarketplaceError)) {
    return {
      status: "MARKETPLACE_ERROR",
      urls: [],
      expedicao: match,
      formaEnvioNome,
      message: marketplaceError ?? oneStepMarketplaceError ?? undefined,
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
    data: { shippingLabel: urls[0], shippingLabelError: null },
  });

  return {
    status: "OK",
    urls,
    expedicao: match,
    formaEnvioNome,
    cached: false,
    createdAgrupamento,
    concludedAgrupamento,
    labelFormat: apiLabelFormat(urls[0]!),
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
