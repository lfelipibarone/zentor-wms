/**
 * Captura JSON completo de um pedido Tiny (ex.: TINY-860312794):
 * pedido, marcadores, nota fiscal, forma de envio, expedição e etiquetas.
 *
 * Uso:
 *   pnpm teste-pedido TINY-860312794
 *   pnpm teste-pedido 860312794
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient, TinyApiError, TinyApiV3Client } from "../src/services/tiny-api-v3-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parsePedidoId(arg?: string): number {
  const raw = (arg ?? "").trim();
  const m = raw.match(/^TINY-(\d+)$/i) ?? raw.match(/^(\d+)$/);
  if (!m) {
    throw new Error(
      "Informe o pedido: pnpm teste-pedido TINY-860312794",
    );
  }
  const id = Number(m[1]);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`ID de pedido inválido: ${raw}`);
  }
  return id;
}

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

async function getClient(): Promise<{ client: TinyApiV3Client; tenantId: string }> {
  const conn = await prisma.tinyConnection.findFirst({
    where: {
      status: TinyConnectionStatus.CONNECTED,
      isActive: true,
      deletedAt: null,
      accessToken: { not: null },
    },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });

  if (!conn) {
    throw new Error(
      "Tiny não conectado. Abra Integrações → Tiny no painel e reconecte OAuth.",
    );
  }

  console.log(`Tenant: ${conn.tenant.name} (${conn.tenant.slug})`);
  const client = await getTinyApiClient(conn.tenantId);
  return { client, tenantId: conn.tenantId };
}

async function getJson(
  client: TinyApiV3Client,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<{ path: string; query?: Record<string, string | number | undefined>; resposta: unknown }> {
  try {
    const resposta = await client.request("GET", path, { query });
    return { path, query, resposta };
  } catch (e) {
    const err = e instanceof TinyApiError ? e : null;
    return {
      path,
      query,
      resposta: {
        erro: true,
        mensagem: e instanceof Error ? e.message : String(e),
        statusCode: err?.statusCode ?? null,
      },
    };
  }
}

const SITUACAO_PEDIDO: Record<number, string> = {
  0: "Aberta",
  1: "Faturada",
  2: "Cancelada",
  3: "Aprovada",
  4: "Preparando Envio",
  5: "Enviada",
  6: "Entregue",
  7: "Pronto Envio",
  8: "Dados Incompletos",
  9: "Nao Entregue",
};

type ExpedicaoMatch = {
  idAgrupamento: number;
  idExpedicao: number;
  resumo: unknown;
};

function pedidoNaExpedicao(
  pedidoId: number,
  idNotaFiscal: number | null,
  exp: unknown,
): boolean {
  const rec = asRecord(exp);
  if (!rec) return false;
  const vendaId = num(asRecord(rec.venda)?.id);
  if (vendaId === pedidoId) return true;
  const notaId = num(asRecord(rec.notaFiscal)?.id);
  if (idNotaFiscal && notaId === idNotaFiscal) return true;
  const idObjeto = num(rec.idObjeto);
  const tipo = String(rec.tipoObjeto ?? "").toLowerCase();
  if (idNotaFiscal && idObjeto === idNotaFiscal && tipo.includes("nota")) return true;
  if (idObjeto === pedidoId && (tipo.includes("pedido") || tipo === "v" || tipo.includes("venda"))) {
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
  return { dataInicial: isoDate(start), dataFinal: isoDate(end) };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function buscarExpedicoesDoPedido(
  client: TinyApiV3Client,
  pedidoId: number,
  options: {
    idFormaEnvio?: number | null;
    idNotaFiscal?: number | null;
    dataInicial?: string;
    dataFinal?: string;
    maxAgrupamentos?: number;
  },
): Promise<ExpedicaoMatch[]> {
  const matches: ExpedicaoMatch[] = [];
  const pageSize = 100;
  const maxAgrupamentos = options.maxAgrupamentos ?? 150;
  const vistos = new Set<number>();
  let offset = 0;
  let total = Infinity;
  let scanned = 0;

  while (offset < total && scanned < maxAgrupamentos) {
    const lista = await getJson(client, "/expedicao", {
      limit: pageSize,
      offset,
      orderBy: "desc",
      ...(options.idFormaEnvio ? { idFormaEnvio: options.idFormaEnvio } : {}),
      ...(options.dataInicial ? { dataInicial: options.dataInicial } : {}),
      ...(options.dataFinal ? { dataFinal: options.dataFinal } : {}),
    });
    const body = asRecord(lista.resposta);
    if (body?.erro) break;

    const paginacao = asRecord(body?.paginacao);
    total = num(paginacao?.total) ?? 0;
    const itens = asArray(body?.itens);

    for (const item of itens) {
      if (scanned >= maxAgrupamentos) break;
      const idAgrupamento = num(asRecord(item)?.id);
      if (!idAgrupamento || vistos.has(idAgrupamento)) continue;
      vistos.add(idAgrupamento);

      scanned++;
      process.stdout.write(`  agrupamento ${scanned}/${Math.min(total, maxAgrupamentos)} (id=${idAgrupamento})… `);

      const detalhe = await getJson(client, `/expedicao/${idAgrupamento}`);
      const expedicoes = asArray(asRecord(detalhe.resposta)?.expedicoes);
      const found = expedicoes.filter((exp) =>
        pedidoNaExpedicao(pedidoId, options.idNotaFiscal ?? null, exp),
      );

      if (found.length > 0) {
        console.log(`encontrado (${found.length})`);
        for (const exp of found) {
          const idExpedicao = num(asRecord(exp)?.id);
          if (!idExpedicao) continue;
          matches.push({ idAgrupamento, idExpedicao, resumo: exp });
        }
        return matches;
      }
      console.log("—");
    }

    offset += pageSize;
    if (itens.length === 0) break;
  }

  return matches;
}

async function main() {
  const pedidoId = parsePedidoId(process.argv[2]);
  const erpOrderId = `TINY-${pedidoId}`;
  const output = resolve(
    __dirname,
    `../../../docs/tiny-pedido-${pedidoId}.json`,
  );

  const { client, tenantId } = await getClient();
  console.log(`\nPedido ${erpOrderId} (id=${pedidoId})\n`);

  const rotas: Record<string, unknown> = {};

  console.log(`GET /pedidos/${pedidoId}`);
  rotas[`GET /pedidos/{idPedido}`] = await getJson(client, `/pedidos/${pedidoId}`);

  console.log(`GET /pedidos/${pedidoId}/marcadores`);
  rotas[`GET /pedidos/{idPedido}/marcadores`] = await getJson(
    client,
    `/pedidos/${pedidoId}/marcadores`,
  );

  const pedido = asRecord(
    asRecord(rotas[`GET /pedidos/{idPedido}`])?.resposta,
  );
  const idNotaFiscalRaw = num(pedido?.idNotaFiscal);
  const idNotaFiscal = idNotaFiscalRaw && idNotaFiscalRaw > 0 ? idNotaFiscalRaw : null;

  if (idNotaFiscal) {
    console.log(`GET /notas/${idNotaFiscal}`);
    rotas[`GET /notas/{idNota}`] = await getJson(client, `/notas/${idNotaFiscal}`);
    console.log(`GET /notas/${idNotaFiscal}/link`);
    rotas[`GET /notas/{idNota}/link`] = await getJson(client, `/notas/${idNotaFiscal}/link`);
    console.log(`GET /notas/${idNotaFiscal}/marcadores`);
    rotas[`GET /notas/{idNota}/marcadores`] = await getJson(
      client,
      `/notas/${idNotaFiscal}/marcadores`,
    );
  }

  const transportador = asRecord(pedido?.transportador);
  const idFormaEnvio = num(asRecord(transportador?.formaEnvio)?.id);

  if (idFormaEnvio) {
    console.log(`GET /formas-envio/${idFormaEnvio}`);
    rotas[`GET /formas-envio/{idFormaEnvio}`] = await getJson(
      client,
      `/formas-envio/${idFormaEnvio}`,
    );
  }

  const { dataInicial, dataFinal } = dateWindowFromPedido(pedido);

  console.log(`\nBuscando expedição vinculada ao pedido ${pedidoId}…`);
  if (idFormaEnvio) console.log(`  filtro forma envio: ${idFormaEnvio}`);
  console.log(`  filtro datas: ${dataInicial} → ${dataFinal}`);

  let expedicoesEncontradas = await buscarExpedicoesDoPedido(client, pedidoId, {
    idFormaEnvio,
    idNotaFiscal,
    dataInicial,
    dataFinal,
  });

  if (expedicoesEncontradas.length === 0) {
    console.log("  nenhuma no filtro — buscando todos os agrupamentos recentes…");
    expedicoesEncontradas = await buscarExpedicoesDoPedido(client, pedidoId, {
      idNotaFiscal,
      maxAgrupamentos: 150,
    });
  }
  console.log(`  ${expedicoesEncontradas.length} expedição(ões) encontrada(s)`);

  const expedicao = [];
  for (const match of expedicoesEncontradas) {
    const { idAgrupamento, idExpedicao } = match;

    console.log(`GET /expedicao/${idAgrupamento}`);
    const agrupamento = await getJson(client, `/expedicao/${idAgrupamento}`);

    console.log(`GET /expedicao/${idAgrupamento}/etiquetas`);
    const etiquetasAgrupamento = await getJson(
      client,
      `/expedicao/${idAgrupamento}/etiquetas`,
    );

    const pathEtiquetaExp = `/expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`;
    console.log(`GET ${pathEtiquetaExp}`);
    const etiquetasExpedicao = await getJson(client, pathEtiquetaExp);

    expedicao.push({
      idAgrupamento,
      idExpedicao,
      resumoExpedicao: match.resumo,
      agrupamento,
      etiquetasAgrupamento,
      etiquetasExpedicao,
    });
  }

  rotas[`GET /expedicao (busca por pedido)`] = {
    pedidoId,
    encontradas: expedicoesEncontradas.length,
    matches: expedicoesEncontradas,
  };

  const notaLink = asRecord(
    asRecord(rotas[`GET /notas/{idNota}/link`])?.resposta,
  )?.link;

  const etiquetas = {
    disponivel: expedicoesEncontradas.length > 0,
    urls: expedicoesEncontradas.length
      ? expedicao.flatMap((e) => {
          const agrupamento = asArray(
            asRecord(asRecord(e.etiquetasAgrupamento)?.resposta)?.urls,
          );
          const individual = asArray(
            asRecord(asRecord(e.etiquetasExpedicao)?.resposta)?.urls,
          );
          return [...agrupamento, ...individual].filter(Boolean);
        })
      : [],
    rotasTinyV3: {
      agrupamento: "GET /expedicao/{idAgrupamento}/etiquetas → { urls: string[] }",
      individual:
        "GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas → { urls: string[] }",
      pedido: "Não existe GET /pedidos/{id}/etiquetas na API v3",
    },
    motivoIndisponivel:
      expedicoesEncontradas.length === 0
        ? "Pedido/NF não está em nenhum agrupamento de expedição no Tiny. Sem agrupamento, as rotas de etiqueta retornam vazio ou 404."
        : null,
    naoConfundirCom: {
      linkNotaFiscal: notaLink ?? null,
      descricao:
        "O link acima é da DANFE (documento fiscal), não da etiqueta de transporte.",
    },
  };

  const payload = {
    fetchedAt: new Date().toISOString(),
    tenantId,
    erpOrderId,
    pedidoId,
    doc: {
      pedido: "https://api-docs.erp.olist.com/api-reference/pedidos/obter-pedido",
      expedicao:
        "https://api-docs.erp.olist.com/api-reference/expedição/obter-agrupamento-de-expedição",
      etiquetasAgrupamento:
        "https://api-docs.erp.olist.com/api-reference/expedição/obter-etiquetas-de-um-agrupamento-de-expedição",
      etiquetasExpedicao:
        "https://api-docs.erp.olist.com/api-reference/expedição/obter-etiquetas-de-uma-expedição-dentro-de-um-agrupamento",
      nota: idNotaFiscal
        ? "https://api-docs.erp.olist.com/api-reference/notas/obter-nota-fiscal"
        : null,
    },
    resumo: {
      numeroPedido: pedido?.numeroPedido ?? null,
      situacao: pedido?.situacao ?? null,
      situacaoLabel:
        SITUACAO_PEDIDO[Number(pedido?.situacao)] ?? "desconhecida",
      dataPedido: pedido?.data ?? null,
      idNotaFiscal,
      idFormaEnvio,
      formaEnvioNome: asRecord(transportador?.formaEnvio)?.nome ?? null,
      codigoRastreamento: transportador?.codigoRastreamento ?? null,
      urlRastreamento: transportador?.urlRastreamento ?? null,
      expedicoesEncontradas: expedicoesEncontradas.length,
      observacao:
        expedicoesEncontradas.length === 0
          ? Number(pedido?.situacao) === 7
            ? "Pedido Pronto Envio, mas ainda não está em agrupamento de expedição no Tiny. Etiqueta/rastreio podem vir do marketplace (ex.: Mercado Envios) e não das rotas /expedicao/.../etiquetas."
            : "Pedido sem agrupamento de expedição no Tiny. Normal se ainda não foi enviado ao módulo de expedição."
          : null,
      buscaExpedicao: {
        idFormaEnvio,
        idNotaFiscal,
        dataInicial,
        dataFinal,
      },
    },
    rotas,
    etiquetas,
    expedicao,
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(payload, null, 2), "utf8");

  console.log(`\nSalvo: ${output}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
