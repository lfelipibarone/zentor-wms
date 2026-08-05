import { prisma } from "../lib/prisma.js";
import {
  getTinyApiClient,
  TinyApiError,
  type TinyApiV3Client,
} from "./tiny-api-v3-client.js";

export type ShippingLabelStatus =
  | "OK"
  | "NOT_TINY_ORDER"
  | "NOT_IN_EXPEDICAO"
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
};

type ExpedicaoMatch = {
  idAgrupamento: number;
  idExpedicao: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

export function parseTinyPedidoId(erpOrderId: string): number | null {
  const m = erpOrderId.trim().match(/^TINY-(\d+)$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function pedidoNaExpedicao(
  pedidoId: number,
  idNotaFiscal: number | null,
  exp: unknown,
): boolean {
  const rec = asRecord(exp);
  if (!rec) return false;
  if (num(asRecord(rec.venda)?.id) === pedidoId) return true;
  if (idNotaFiscal && num(asRecord(rec.notaFiscal)?.id) === idNotaFiscal) {
    return true;
  }
  const idObjeto = num(rec.idObjeto);
  const tipo = String(rec.tipoObjeto ?? "").toLowerCase();
  if (idNotaFiscal && idObjeto === idNotaFiscal && tipo.includes("nota")) {
    return true;
  }
  if (
    idObjeto === pedidoId &&
    (tipo.includes("pedido") || tipo === "v" || tipo.includes("venda"))
  ) {
    return true;
  }
  return false;
}

function dateWindowFromPedido(pedido: Record<string, unknown> | null) {
  const raw =
    pedido?.dataFaturamento ??
    pedido?.dataEnvio ??
    pedido?.data ??
    pedido?.dataPedido;
  const base = raw ? new Date(String(raw)) : new Date();
  const start = new Date(base);
  start.setDate(start.getDate() - 45);
  const end = new Date(base);
  end.setDate(end.getDate() + 14);
  return {
    dataInicial: start.toISOString().slice(0, 10),
    dataFinal: end.toISOString().slice(0, 10),
  };
}

async function buscarExpedicaoDoPedido(
  client: TinyApiV3Client,
  pedidoId: number,
  options: {
    idNotaFiscal: number | null;
    idFormaEnvio: number | null;
    dataInicial: string;
    dataFinal: string;
    maxAgrupamentos?: number;
  },
): Promise<ExpedicaoMatch | null> {
  const pageSize = 100;
  const maxAgrupamentos = options.maxAgrupamentos ?? 200;
  const vistos = new Set<number>();
  let scanned = 0;

  const searches = [
    {
      dataInicial: options.dataInicial,
      dataFinal: options.dataFinal,
      idFormaEnvio: options.idFormaEnvio,
    },
    {
      dataInicial: options.dataInicial,
      dataFinal: options.dataFinal,
      idFormaEnvio: null as number | null,
    },
  ];

  for (const search of searches) {
    let offset = 0;
    let total = Infinity;

    while (offset < total && scanned < maxAgrupamentos) {
      let body: Record<string, unknown>;
      try {
        body = asRecord(
          await client.request("GET", "/expedicao", {
            query: {
              limit: pageSize,
              offset,
              orderBy: "desc",
              dataInicial: search.dataInicial,
              dataFinal: search.dataFinal,
              ...(search.idFormaEnvio ? { idFormaEnvio: search.idFormaEnvio } : {}),
            },
          }),
        ) ?? {};
      } catch {
        break;
      }

      total = num(asRecord(body.paginacao)?.total) ?? 0;
      const itens = asArray(body.itens);
      if (!itens.length) break;

      for (const item of itens) {
        if (scanned >= maxAgrupamentos) break;
        const idAgrupamento = num(asRecord(item)?.id);
        if (!idAgrupamento || vistos.has(idAgrupamento)) continue;
        vistos.add(idAgrupamento);
        scanned += 1;

        let detalhe: Record<string, unknown>;
        try {
          detalhe =
            asRecord(await client.request("GET", `/expedicao/${idAgrupamento}`)) ??
            {};
        } catch {
          continue;
        }

        for (const exp of asArray(detalhe.expedicoes)) {
          if (!pedidoNaExpedicao(pedidoId, options.idNotaFiscal, exp)) continue;
          const idExpedicao = num(asRecord(exp)?.id);
          if (idExpedicao) {
            return { idAgrupamento, idExpedicao };
          }
        }
      }

      offset += pageSize;
      if (offset >= total) break;
    }
  }

  return null;
}

function extractUrls(resposta: unknown): string[] {
  const body = asRecord(resposta);
  if (!body || body.erro) return [];
  return asArray(body.urls)
    .map((u) => str(u))
    .filter((u): u is string => Boolean(u));
}

function extractMarketplaceError(resposta: unknown): string | null {
  const body = asRecord(resposta);
  if (!body?.erro) return null;
  return str(body.mensagem) ?? "Erro ao obter etiqueta no marketplace";
}

async function fetchEtiquetaUrls(
  client: TinyApiV3Client,
  match: ExpedicaoMatch,
): Promise<{ urls: string[]; marketplaceError: string | null }> {
  const { idAgrupamento, idExpedicao } = match;
  const paths = [
    `/expedicao/${idAgrupamento}/etiquetas`,
    `/expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`,
  ];

  const urls = new Set<string>();
  let marketplaceError: string | null = null;

  for (const path of paths) {
    try {
      const resposta = await client.request("GET", path);
      const err = extractMarketplaceError(resposta);
      if (err) marketplaceError = err;
      for (const url of extractUrls(resposta)) urls.add(url);
    } catch (e) {
      if (e instanceof TinyApiError && e.statusCode === 400) {
        marketplaceError = e.message;
      }
    }
  }

  return { urls: [...urls], marketplaceError };
}

export async function fetchShippingLabelsForOrder(params: {
  tenantId: string;
  orderId: string;
  /** Quando true, retorna URL já salva em Order.shippingLabel sem chamar o Tiny. */
  useCache?: boolean;
}): Promise<ShippingLabelResult> {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, tenantId: params.tenantId },
    select: {
      id: true,
      erpOrderId: true,
      shippingLabel: true,
      erpSource: true,
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

  let client: TinyApiV3Client;
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

  let pedido: Record<string, unknown>;
  try {
    pedido = asRecord(await client.request("GET", `/pedidos/${pedidoId}`)) ?? {};
  } catch (e) {
    return {
      status: "API_ERROR",
      urls: [],
      message: e instanceof Error ? e.message : "Erro ao buscar pedido no Tiny",
      cached: false,
    };
  }

  if (pedido.erro) {
    return {
      status: "API_ERROR",
      urls: [],
      message: str(pedido.mensagem) ?? "Pedido não encontrado no Tiny",
      cached: false,
    };
  }

  const idNotaFiscal = num(pedido.idNotaFiscal);
  const formaEnvio = asRecord(asRecord(pedido.transportador)?.formaEnvio);
  const idFormaEnvio = num(formaEnvio?.id);
  const formaEnvioNome = str(formaEnvio?.nome);
  const window = dateWindowFromPedido(pedido);

  const match = await buscarExpedicaoDoPedido(client, pedidoId, {
    idNotaFiscal,
    idFormaEnvio,
    ...window,
  });

  if (!match) {
    const isMercadoEnvios = formaEnvioNome?.toLowerCase().includes("mercado");
    return {
      status: "NOT_IN_EXPEDICAO",
      urls: [],
      formaEnvioNome,
      message: isMercadoEnvios
        ? "Pedido não está em agrupamento de expedição no Tiny. Pedidos Mercado Envios costumam ter a etiqueta no marketplace até serem agrupados no ERP."
        : "Pedido/NF não está em nenhum agrupamento de expedição no Tiny. Agrupe o pedido na expedição antes de imprimir a etiqueta.",
      cached: false,
    };
  }

  const { urls, marketplaceError } = await fetchEtiquetaUrls(client, match);

  if (urls.length === 0 && marketplaceError) {
    return {
      status: "MARKETPLACE_ERROR",
      urls: [],
      expedicao: match,
      formaEnvioNome,
      message: marketplaceError,
      cached: false,
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
  };
}
