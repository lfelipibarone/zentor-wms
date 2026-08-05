import { TinyApiError, type TinyApiV3Client } from "../../src/services/tiny-api-v3-client.js";

export const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
};

export function parseTinyPedidoId(arg: string): number | null {
  const m = arg.trim().match(/^TINY-(\d+)$/i) ?? arg.trim().match(/^(\d+)$/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
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

export function dateWindowFromPedido(pedido: Record<string, unknown> | null) {
  const raw =
    pedido?.dataFaturamento ??
    pedido?.dataEnvio ??
    pedido?.data ??
    pedido?.dataPedido;
  const base = raw && String(raw).trim() ? new Date(String(raw)) : new Date();
  const start = new Date(base);
  start.setDate(start.getDate() - 45);
  const end = new Date(base);
  end.setDate(end.getDate() + 14);
  return {
    dataInicial: start.toISOString().slice(0, 10),
    dataFinal: end.toISOString().slice(0, 10),
  };
}

export type ExpedicaoMatch = {
  idAgrupamento: number;
  idExpedicao: number;
  resumo?: unknown;
};

export async function tinyGet(
  client: TinyApiV3Client,
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  try {
    return { ok: true as const, resposta: await client.request("GET", path, { query }) };
  } catch (e) {
    return {
      ok: false as const,
      resposta: {
        erro: true,
        mensagem: e instanceof Error ? e.message : String(e),
        statusCode: e instanceof TinyApiError ? e.statusCode : null,
      },
    };
  }
}

export async function buscarExpedicaoDoPedido(
  client: TinyApiV3Client,
  pedidoId: number,
  options: {
    idNotaFiscal: number | null;
    idFormaEnvio: number | null;
    dataInicial: string;
    dataFinal: string;
    maxAgrupamentos?: number;
    onProgress?: (info: { scanned: number; idAgrupamento: number }) => void;
  },
): Promise<{ match: ExpedicaoMatch | null; agrupamentosVarridos: number }> {
  const pageSize = 100;
  const maxAgrupamentos = options.maxAgrupamentos ?? 500;
  const vistos = new Set<number>();
  let scanned = 0;

  const searches = [
    {
      label: "forma envio + período do pedido",
      dataInicial: options.dataInicial,
      dataFinal: options.dataFinal,
      idFormaEnvio: options.idFormaEnvio,
    },
    {
      label: "período do pedido (sem filtro de forma)",
      dataInicial: options.dataInicial,
      dataFinal: options.dataFinal,
      idFormaEnvio: null as number | null,
    },
  ];

  for (const search of searches) {
    let offset = 0;
    let total = Infinity;

    while (offset < total && scanned < maxAgrupamentos) {
      const lista = await tinyGet(client, "/expedicao", {
        limit: pageSize,
        offset,
        orderBy: "desc",
        dataInicial: search.dataInicial,
        dataFinal: search.dataFinal,
        ...(search.idFormaEnvio ? { idFormaEnvio: search.idFormaEnvio } : {}),
      });

      const body = asRecord(lista.resposta);
      if (!lista.ok || body?.erro) break;

      total = num(asRecord(body?.paginacao)?.total) ?? 0;
      const itens = asArray(body?.itens);
      if (!itens.length) break;

      for (const item of itens) {
        if (scanned >= maxAgrupamentos) break;
        const idAgrupamento = num(asRecord(item)?.id);
        if (!idAgrupamento || vistos.has(idAgrupamento)) continue;
        vistos.add(idAgrupamento);
        scanned += 1;
        options.onProgress?.({ scanned, idAgrupamento });

        const det = await tinyGet(client, `/expedicao/${idAgrupamento}`);
        for (const exp of asArray(asRecord(det.resposta)?.expedicoes)) {
          if (!pedidoNaExpedicao(pedidoId, options.idNotaFiscal, exp)) continue;
          const idExpedicao = num(asRecord(exp)?.id);
          if (idExpedicao) {
            return {
              match: { idAgrupamento, idExpedicao, resumo: exp },
              agrupamentosVarridos: vistos.size,
            };
          }
        }
      }

      offset += pageSize;
      if (offset >= total) break;
    }
  }

  return { match: null, agrupamentosVarridos: vistos.size };
}

export function extractEtiquetaUrls(resposta: unknown): string[] {
  const body = asRecord(resposta);
  if (!body || body.erro) return [];
  return asArray(body.urls)
    .map((u) => str(u))
    .filter((u): u is string => Boolean(u));
}

export function extractMarketplaceError(resposta: unknown): string | null {
  const body = asRecord(resposta);
  if (!body?.erro) return null;
  return str(body.mensagem) ?? "Erro ao obter etiqueta no marketplace";
}
