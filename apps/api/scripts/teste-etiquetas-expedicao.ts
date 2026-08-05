/**
 * Apenas as 4 rotas GET de expedição, nesta ordem:
 *   1. GET /expedicao
 *   2. GET /expedicao/{idAgrupamento}
 *   3. GET /expedicao/{idAgrupamento}/etiquetas
 *   4. GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas
 *
 * Salva resposta bruta de cada chamada + dados completos de cada expedição.
 *
 * Uso:
 *   pnpm teste-etiquetas-expedicao --limite 30
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient } from "../src/services/tiny-api-v3-client.js";
import {
  listarAgrupamentosExpedicao,
  obterAgrupamentoExpedicao,
  obterEtiquetasAgrupamento,
  obterEtiquetasExpedicao,
} from "../src/services/tiny-expedicao-labels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "../../../docs/tiny-etiquetas-expedicao.json");

type RotaChamada = {
  ordem: number;
  rota: string;
  params: Record<string, unknown>;
  ok: boolean;
  urls: string[];
  resposta: unknown;
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

function isErroResposta(resposta: unknown): boolean {
  const body = asRecord(resposta);
  return Boolean(body?.erro);
}

async function chamarRota(
  ordem: number,
  rota: string,
  params: Record<string, unknown>,
  fn: () => Promise<unknown>,
): Promise<RotaChamada> {
  try {
    const resposta = await fn();
    const urls = extractUrls(resposta);
    return {
      ordem,
      rota,
      params,
      ok: !isErroResposta(resposta),
      urls,
      resposta,
    };
  } catch (e) {
    const resposta = {
      erro: true,
      mensagem: e instanceof Error ? e.message : String(e),
    };
    return { ordem, rota, params, ok: false, urls: [], resposta };
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseCli(argv: string[]) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 60);
  let limite = 30;
  let offset = 0;
  let dataInicial = isoDate(start);
  let dataFinal = isoDate(end);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limite") limite = Number(argv[++i]);
    else if (arg === "--offset") offset = Number(argv[++i]);
    else if (arg === "--data-inicial") dataInicial = argv[++i] ?? dataInicial;
    else if (arg === "--data-final") dataFinal = argv[++i] ?? dataFinal;
  }
  return { limite, offset, dataInicial, dataFinal };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const conn = await prisma.tinyConnection.findFirst({
    where: {
      status: TinyConnectionStatus.CONNECTED,
      isActive: true,
      deletedAt: null,
      accessToken: { not: null },
    },
    include: { tenant: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) throw new Error("Tiny não conectado");

  const client = await getTinyApiClient(conn.tenantId);
  console.log(`Tenant: ${conn.tenant.name}`);
  console.log(`Rotas: /expedicao → /{id} → /{id}/etiquetas → /{id}/expedicao/{idExp}/etiquetas\n`);

  const chamadas: RotaChamada[] = [];
  let ordem = 0;

  // 1. GET /expedicao (paginação)
  const itens: unknown[] = [];
  const vistos = new Set<number>();
  let pageOffset = cli.offset;
  let total = Infinity;
  const pageSize = 100;
  const paginasListagem: unknown[] = [];

  while (itens.length < cli.limite && pageOffset < total) {
    const query = {
      limit: pageSize,
      offset: pageOffset,
      orderBy: "desc" as const,
      dataInicial: cli.dataInicial,
      dataFinal: cli.dataFinal,
    };
    const chamada = await chamarRota(
      ++ordem,
      "GET /expedicao",
      query,
      () => listarAgrupamentosExpedicao(client, query),
    );
    chamadas.push(chamada);
    paginasListagem.push(chamada.resposta);

    const lista = asRecord(chamada.resposta);
    total = num(asRecord(lista?.paginacao)?.total) ?? 0;
    for (const item of asArray(lista?.itens)) {
      const id = num(asRecord(item)?.id);
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      itens.push(item);
      if (itens.length >= cli.limite) break;
    }
    pageOffset += pageSize;
    if (!asArray(lista?.itens).length) break;
  }

  console.log(
    `[1] GET /expedicao → ${chamadas.filter((c) => c.rota === "GET /expedicao").length} página(s), ${itens.length} agrup. únicos (total: ${total})`,
  );

  const agrupamentos: unknown[] = [];
  const indiceExpedicoes: unknown[] = [];
  let comEtiqueta = 0;
  let totalExpedicoes = 0;

  for (const item of itens) {
    const idAgrupamento = num(asRecord(item)?.id);
    if (!idAgrupamento) continue;
    const formaEnvioNome = str(asRecord(asRecord(item)?.formaEnvio)?.nome);
    process.stdout.write(`\n#${idAgrupamento} (${formaEnvioNome ?? "?"}) `);

    // 2. GET /expedicao/{idAgrupamento}
    const chamadaDetalhe = await chamarRota(
      ++ordem,
      "GET /expedicao/{idAgrupamento}",
      { idAgrupamento },
      () => obterAgrupamentoExpedicao(client, idAgrupamento),
    );
    chamadas.push(chamadaDetalhe);
    const detalhe = chamadaDetalhe.resposta;
    const expedicoesRaw = asArray(asRecord(detalhe)?.expedicoes);

    // 3. GET /expedicao/{idAgrupamento}/etiquetas
    const chamadaEtiquetasAgr = await chamarRota(
      ++ordem,
      "GET /expedicao/{idAgrupamento}/etiquetas",
      { idAgrupamento },
      () => obterEtiquetasAgrupamento(client, idAgrupamento),
    );
    chamadas.push(chamadaEtiquetasAgr);

    // 4. GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas
    const expedicoes: unknown[] = [];
    for (const exp of expedicoesRaw) {
      const idExpedicao = num(asRecord(exp)?.id);
      if (!idExpedicao) continue;
      totalExpedicoes += 1;

      const pedidoId = num(asRecord(asRecord(exp)?.venda)?.id);
      const idNotaFiscal = num(asRecord(asRecord(exp)?.notaFiscal)?.id);
      const params = { idAgrupamento, idExpedicao, pedidoId, idNotaFiscal };

      const chamadaEtiquetaExp = await chamarRota(
        ++ordem,
        "GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas",
        params,
        () => obterEtiquetasExpedicao(client, idAgrupamento, idExpedicao),
      );
      chamadas.push(chamadaEtiquetaExp);

      const expedicaoEntry = {
        idAgrupamento,
        idExpedicao,
        formaEnvioNome,
        pedidoId,
        idNotaFiscal,
        dados: exp,
        rotas: {
          "GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas": {
            params,
            ok: chamadaEtiquetaExp.ok,
            urls: chamadaEtiquetaExp.urls,
            resposta: chamadaEtiquetaExp.resposta,
          },
        },
        temEtiqueta: chamadaEtiquetaExp.urls.length > 0,
      };
      expedicoes.push(expedicaoEntry);
      indiceExpedicoes.push(expedicaoEntry);
    }

    const temEtiquetaAgr =
      chamadaEtiquetasAgr.urls.length > 0 ||
      expedicoes.some((e) => asRecord(e)?.temEtiqueta === true);
    if (temEtiquetaAgr) comEtiqueta += 1;

    console.log(temEtiquetaAgr ? `✓ ETIQUETA` : `✗ sem URL`);

    agrupamentos.push({
      idAgrupamento,
      formaEnvioNome,
      listagem: item,
      dados: detalhe,
      expedicoes,
      rotas: {
        "GET /expedicao/{idAgrupamento}": {
          params: { idAgrupamento },
          ok: chamadaDetalhe.ok,
          resposta: chamadaDetalhe.resposta,
        },
        "GET /expedicao/{idAgrupamento}/etiquetas": {
          params: { idAgrupamento },
          ok: chamadaEtiquetasAgr.ok,
          urls: chamadaEtiquetasAgr.urls,
          resposta: chamadaEtiquetasAgr.resposta,
        },
      },
      temEtiqueta: temEtiquetaAgr,
    });
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    tenant: conn.tenant.name,
    fluxo: [
      "GET /expedicao",
      "GET /expedicao/{idAgrupamento}",
      "GET /expedicao/{idAgrupamento}/etiquetas",
      "GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas",
    ],
    query: cli,
    resumo: {
      chamadas: chamadas.length,
      paginasListagem: paginasListagem.length,
      agrupamentos: agrupamentos.length,
      expedicoes: totalExpedicoes,
      comEtiqueta,
      semEtiqueta: agrupamentos.length - comEtiqueta,
      paginacaoTotal: total,
    },
    listagemExpedicao: {
      params: {
        dataInicial: cli.dataInicial,
        dataFinal: cli.dataFinal,
        offsetInicial: cli.offset,
        limiteAgrupamentos: cli.limite,
      },
      paginas: paginasListagem,
      itensUnicos: itens,
    },
    chamadas,
    agrupamentos,
    indiceExpedicoes,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(`\n--- Resumo ---`);
  console.log(
    `Chamadas: ${chamadas.length} | Agrupamentos: ${agrupamentos.length} | Expedições: ${totalExpedicoes} | Com etiqueta: ${comEtiqueta}`,
  );
  console.log(`Salvo: ${OUTPUT}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
