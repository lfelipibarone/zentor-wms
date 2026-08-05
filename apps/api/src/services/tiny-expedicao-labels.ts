import { TinyApiError, type TinyApiV3Client } from "./tiny-api-v3-client.js";

export type ExpedicaoListQuery = {
  limit?: number;
  offset?: number;
  orderBy?: "asc" | "desc";
  dataInicial?: string;
  dataFinal?: string;
  idFormaEnvio?: number;
};

export type ExpedicaoMatch = {
  idAgrupamento: number;
  idExpedicao: number;
  formaEnvioNome?: string | null;
  pedidoId?: number | null;
  idNotaFiscal?: number | null;
};

export type EtiquetasResult = {
  agrupamento: unknown;
  individual: unknown;
  urls: string[];
  marketplaceError: string | null;
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

/** 1. GET /expedicao — listar agrupamentos */
export async function listarAgrupamentosExpedicao(
  client: TinyApiV3Client,
  query: ExpedicaoListQuery = {},
) {
  return client.request("GET", "/expedicao", {
    query: {
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
      orderBy: query.orderBy ?? "desc",
      ...(query.dataInicial ? { dataInicial: query.dataInicial } : {}),
      ...(query.dataFinal ? { dataFinal: query.dataFinal } : {}),
      ...(query.idFormaEnvio ? { idFormaEnvio: query.idFormaEnvio } : {}),
    },
  });
}

/** 2. GET /expedicao/{idAgrupamento} — detalhe do agrupamento */
export async function obterAgrupamentoExpedicao(
  client: TinyApiV3Client,
  idAgrupamento: number,
) {
  return client.request("GET", `/expedicao/${idAgrupamento}`);
}

/** 3. GET /expedicao/{idAgrupamento}/etiquetas */
export async function obterEtiquetasAgrupamento(
  client: TinyApiV3Client,
  idAgrupamento: number,
) {
  return client.request("GET", `/expedicao/${idAgrupamento}/etiquetas`);
}

/** 4. GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas */
export async function obterEtiquetasExpedicao(
  client: TinyApiV3Client,
  idAgrupamento: number,
  idExpedicao: number,
) {
  return client.request(
    "GET",
    `/expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`,
  );
}

/** Passos 3 → 4 na ordem da documentação Olist. */
export async function buscarEtiquetasExpedicao(
  client: TinyApiV3Client,
  match: Pick<ExpedicaoMatch, "idAgrupamento" | "idExpedicao">,
): Promise<EtiquetasResult> {
  const { idAgrupamento, idExpedicao } = match;
  let agrupamento: unknown;
  let individual: unknown;
  let marketplaceError: string | null = null;
  const urls = new Set<string>();

  try {
    agrupamento = await obterEtiquetasAgrupamento(client, idAgrupamento);
    marketplaceError = extractMarketplaceError(agrupamento);
    for (const url of extractUrls(agrupamento)) urls.add(url);
  } catch (e) {
    agrupamento = {
      erro: true,
      mensagem: e instanceof Error ? e.message : String(e),
      statusCode: e instanceof TinyApiError ? e.statusCode : null,
    };
    if (e instanceof TinyApiError) marketplaceError = e.message;
  }

  try {
    individual = await obterEtiquetasExpedicao(client, idAgrupamento, idExpedicao);
    const err = extractMarketplaceError(individual);
    if (err) marketplaceError = err;
    for (const url of extractUrls(individual)) urls.add(url);
  } catch (e) {
    individual = {
      erro: true,
      mensagem: e instanceof Error ? e.message : String(e),
      statusCode: e instanceof TinyApiError ? e.statusCode : null,
    };
    if (e instanceof TinyApiError && !marketplaceError) marketplaceError = e.message;
  }

  return {
    agrupamento,
    individual,
    urls: [...urls],
    marketplaceError,
  };
}

export function pedidoNaExpedicao(
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

function defaultDateWindow() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 60);
  return {
    dataInicial: start.toISOString().slice(0, 10),
    dataFinal: end.toISOString().slice(0, 10),
  };
}

/**
 * Índice pedido → expedição usando apenas rotas 1 e 2.
 */
export async function buildPedidoExpedicaoIndex(
  client: TinyApiV3Client,
  options: {
    dataInicial?: string;
    dataFinal?: string;
    maxAgrupamentos?: number;
  } = {},
): Promise<Map<number, ExpedicaoMatch>> {
  const window = defaultDateWindow();
  const dataInicial = options.dataInicial ?? window.dataInicial;
  const dataFinal = options.dataFinal ?? window.dataFinal;
  const maxAgrupamentos = options.maxAgrupamentos ?? 200;
  const pageSize = 100;
  const index = new Map<number, ExpedicaoMatch>();
  const vistos = new Set<number>();
  let offset = 0;
  let total = Infinity;

  while (offset < total && vistos.size < maxAgrupamentos) {
    const lista = asRecord(
      await listarAgrupamentosExpedicao(client, {
        limit: pageSize,
        offset,
        orderBy: "desc",
        dataInicial,
        dataFinal,
      }),
    );
    total = num(asRecord(lista?.paginacao)?.total) ?? 0;
    const itens = asArray(lista?.itens);
    if (!itens.length) break;

    for (const item of itens) {
      if (vistos.size >= maxAgrupamentos) break;
      const idAgrupamento = num(asRecord(item)?.id);
      if (!idAgrupamento || vistos.has(idAgrupamento)) continue;
      vistos.add(idAgrupamento);

      const detalhe = asRecord(await obterAgrupamentoExpedicao(client, idAgrupamento));
      const formaEnvioNome = str(asRecord(detalhe?.formaEnvio)?.nome);

      for (const exp of asArray(detalhe?.expedicoes)) {
        const idExpedicao = num(asRecord(exp)?.id);
        const pedidoId = num(asRecord(asRecord(exp)?.venda)?.id);
        const idNotaFiscal = num(asRecord(asRecord(exp)?.notaFiscal)?.id);
        if (!idExpedicao) continue;

        const entry: ExpedicaoMatch = {
          idAgrupamento,
          idExpedicao,
          formaEnvioNome,
          pedidoId,
          idNotaFiscal,
        };

        if (pedidoId && !index.has(pedidoId)) index.set(pedidoId, entry);
        if (idNotaFiscal && !index.has(idNotaFiscal)) {
          index.set(idNotaFiscal, entry);
        }
      }
    }

    offset += pageSize;
    if (offset >= total) break;
  }

  return index;
}

export function findPedidoNoIndice(
  index: Map<number, ExpedicaoMatch>,
  pedidoId: number,
  idNotaFiscal?: number | null,
): ExpedicaoMatch | null {
  return index.get(pedidoId) ?? (idNotaFiscal ? index.get(idNotaFiscal) ?? null : null);
}
