/**
 * Amostra pedidos por situação no Tiny, testa etiquetas (expedição-first) e resume.
 *
 * Uso:
 *   pnpm teste-etiquetas-situacoes
 *   pnpm teste-etiquetas-situacoes --por-situacao 2 --limite 3
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient } from "../src/services/tiny-api-v3-client.js";
import {
  buildPedidoExpedicaoIndex,
  buscarEtiquetasExpedicao,
  findPedidoNoIndice,
} from "../src/services/tiny-expedicao-labels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "../../../docs/tiny-etiquetas-situacoes.json");

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

const SITUACOES_ALVO = [0, 3, 4, 5, 6, 7];

/** Pedidos conhecidos para incluir sempre (referência cruzada). */
const PEDIDOS_FIXOS = [860301754, 860342783];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseCli(argv: string[]) {
  let porSituacao = 2;
  let limiteSituacoes: number[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--por-situacao") porSituacao = Number(argv[++i]);
    else if (argv[i] === "--situacoes") {
      limiteSituacoes = (argv[++i] ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
    }
  }
  return { porSituacao, situacoes: limiteSituacoes ?? SITUACOES_ALVO };
}

async function amostrarPorSituacao(
  client: Awaited<ReturnType<typeof getTinyApiClient>>,
  situacoes: number[],
  porSituacao: number,
) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const dataInicial = isoDate(start);
  const dataFinal = isoDate(end);
  const amostra: { pedidoId: number; situacao: number; formaEnvioNome: string | null }[] = [];

  for (const situacao of situacoes) {
    const lista = await client.listPedidos({
      situacao,
      dataInicial,
      dataFinal,
      limit: porSituacao,
      offset: 0,
    });
    for (const item of lista.items) {
      const rec = asRecord(item);
      const pedidoId = num(rec?.id);
      if (!pedidoId) continue;
      const formaEnvioNome = str(asRecord(asRecord(rec?.transportador)?.formaEnvio)?.nome);
      amostra.push({ pedidoId, situacao, formaEnvioNome });
    }
    process.stdout.write(
      `\r  situacao ${situacao} (${SITUACAO_PEDIDO[situacao] ?? "?"}): ${lista.items.length} pedido(s)`,
    );
  }
  console.log();
  return amostra;
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
  console.log(`Amostrando pedidos por situação (${cli.porSituacao} de cada)…`);

  const amostra = await amostrarPorSituacao(client, cli.situacoes, cli.porSituacao);
  const pedidoIds = new Set<number>([...PEDIDOS_FIXOS, ...amostra.map((a) => a.pedidoId)]);

  console.log(`\nTotal a testar: ${pedidoIds.size} pedidos`);
  console.log("Montando índice expedição…");
  const index = await buildPedidoExpedicaoIndex(client, { maxAgrupamentos: 200 });
  console.log(`Índice: ${index.size} chaves\n`);

  const resultados = [];

  for (const pedidoId of [...pedidoIds].sort((a, b) => a - b)) {
    let pedidoResposta: unknown;
    try {
      pedidoResposta = await client.getPedido(pedidoId);
    } catch (e) {
      pedidoResposta = {
        erro: true,
        mensagem: e instanceof Error ? e.message : String(e),
      };
    }

    const ped = asRecord(pedidoResposta);
    const situacao = Number(ped?.situacao);
    const situacaoLabel = SITUACAO_PEDIDO[situacao] ?? `situacao ${situacao}`;
    const formaEnvioNome = str(asRecord(asRecord(ped?.transportador)?.formaEnvio)?.nome);
    const codigoRastreamento = str(asRecord(ped?.transportador)?.codigoRastreamento);
    const idNotaFiscal = num(ped?.idNotaFiscal);
    const match = findPedidoNoIndice(index, pedidoId, idNotaFiscal);

    let urls: string[] = [];
    let marketplaceError: string | null = null;
    let naExpedicao = Boolean(match);

    if (match) {
      const et = await buscarEtiquetasExpedicao(client, match);
      urls = et.urls;
      marketplaceError = et.marketplaceError;
    }

    const diagnostico = urls.length
      ? "ETIQUETA_OK"
      : !naExpedicao
        ? "FORA_EXPEDICAO"
        : marketplaceError
          ? "ERRO_MARKETPLACE"
          : "SEM_URL";

    const linha = `${String(pedidoId).padEnd(10)} sit=${String(situacao).padEnd(2)} ${situacaoLabel.padEnd(16)} ${(formaEnvioNome ?? "—").padEnd(18)} exp=${naExpedicao ? "sim" : "não "} etiq=${diagnostico}`;
    console.log(linha);

    resultados.push({
      pedidoId,
      erpOrderId: `TINY-${pedidoId}`,
      numeroPedido: ped?.numeroPedido ?? null,
      situacao,
      situacaoLabel,
      formaEnvioNome,
      codigoRastreamento: codigoRastreamento || null,
      idNotaFiscal,
      naExpedicao,
      expedicao: match,
      etiquetas: { urls, marketplaceError, diagnostico },
    });
  }

  const porSituacao = new Map<number, typeof resultados>();
  for (const r of resultados) {
    const list = porSituacao.get(r.situacao) ?? [];
    list.push(r);
    porSituacao.set(r.situacao, list);
  }

  const resumoPorSituacao = [...porSituacao.entries()]
    .sort(([a], [b]) => a - b)
    .map(([sit, items]) => ({
      situacao: sit,
      situacaoLabel: SITUACAO_PEDIDO[sit] ?? `situacao ${sit}`,
      total: items.length,
      naExpedicao: items.filter((i) => i.naExpedicao).length,
      comEtiqueta: items.filter((i) => i.etiquetas.urls.length > 0).length,
      erroMarketplace: items.filter((i) => i.etiquetas.diagnostico === "ERRO_MARKETPLACE").length,
      foraExpedicao: items.filter((i) => i.etiquetas.diagnostico === "FORA_EXPEDICAO").length,
    }));

  const payload = {
    fetchedAt: new Date().toISOString(),
    tenant: conn.tenant.name,
    amostraInicial: amostra,
    pedidosFixos: PEDIDOS_FIXOS,
    resumo: {
      total: resultados.length,
      naExpedicao: resultados.filter((r) => r.naExpedicao).length,
      comEtiqueta: resultados.filter((r) => r.etiquetas.urls.length > 0).length,
      erroMarketplace: resultados.filter((r) => r.etiquetas.diagnostico === "ERRO_MARKETPLACE").length,
      foraExpedicao: resultados.filter((r) => r.etiquetas.diagnostico === "FORA_EXPEDICAO").length,
      porSituacao: resumoPorSituacao,
    },
    resultados,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));

  console.log(`\n--- Resumo ---`);
  for (const r of resumoPorSituacao) {
    console.log(
      `  sit ${r.situacao} ${r.situacaoLabel}: ${r.total} ped. | expedição ${r.naExpedicao} | etiqueta ${r.comEtiqueta} | marketplace ${r.erroMarketplace} | fora exp. ${r.foraExpedicao}`,
    );
  }
  console.log(`\nSalvo: ${OUTPUT}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
