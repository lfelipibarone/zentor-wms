import { prisma } from "../lib/prisma.js";
import { getTinyApiClient } from "./tiny-api-v3-client.js";
import {
  buildPedidoExpedicaoIndex,
  buscarEtiquetasExpedicao,
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

export function parseTinyPedidoId(erpOrderId: string): number | null {
  const m = erpOrderId.trim().match(/^TINY-(\d+)$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
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
    return {
      status: "NOT_IN_EXPEDICAO",
      urls: [],
      message:
        "Pedido não está em agrupamento de expedição no Tiny. Agrupe na expedição antes de imprimir a etiqueta.",
      cached: false,
    };
  }

  const { urls, marketplaceError } = await buscarEtiquetasExpedicao(client, match);
  const formaEnvioNome = match.formaEnvioNome ?? null;

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

export {
  listarAgrupamentosExpedicao,
  obterAgrupamentoExpedicao,
  obterEtiquetasAgrupamento,
  obterEtiquetasExpedicao,
  buscarEtiquetasExpedicao,
  buildPedidoExpedicaoIndex,
};
