/**
 * Cruza artefatos de teste (expedição-first + pedido-first) para mapear:
 *   pedido Tiny → agrupamento/expedição → etiqueta
 *
 * Uso:
 *   pnpm --filter @wms/api cruzar-etiquetas
 *   pnpm --filter @wms/api cruzar-etiquetas --expedicao docs/tiny-etiquetas-expedicao.json
 *
 * Saída: docs/tiny-etiquetas-cruzamento.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asRecord,
  asArray,
  num,
  str,
  parseTinyPedidoId,
} from "./lib/tiny-expedicao-search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "../../../docs");
const OUTPUT = resolve(DOCS, "tiny-etiquetas-cruzamento.json");

type PedidoExpedicao = {
  erpOrderId: string;
  pedidoId: number;
  numeroPedido: number | null;
  idNotaFiscal: number | null;
  idAgrupamento: number;
  idExpedicao: number;
  identificacaoAgrupamento: string | null;
  dataAgrupamento: string | null;
  formaEnvioNome: string | null;
  idFormaEnvio: number | null;
  tipoObjeto: string | null;
  situacaoExpedicao: string | null;
  etiquetaAgrupamento: {
    temEtiqueta: boolean;
    urls: string[];
    marketplaceError: string | null;
  };
  etiquetaIndividual: {
    temEtiqueta: boolean;
    urls: string[];
    marketplaceError: string | null;
  };
  melhorEtiqueta: {
    temEtiqueta: boolean;
    urls: string[];
    fonte: "agrupamento" | "individual" | null;
    marketplaceError: string | null;
  };
};

type TestePedido = {
  origem: string;
  pedidoId: number;
  erpOrderId: string;
  formaEnvioNome: string | null;
  situacao: number | null;
  expedicaoEncontradaViaPedido: boolean;
  temEtiquetaViaPedido: boolean;
  agrupamentosVerificados?: number;
  marketplaceErrorViaPedido?: string | null;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadExpedicaoArquivo(path: string): PedidoExpedicao[] {
  const data = asRecord(readJson(path));
  const out: PedidoExpedicao[] = [];

  for (const agr of asArray(data?.agrupamentos)) {
    const a = asRecord(agr);
    if (!a) continue;
    const idAgrupamento = num(a.idAgrupamento);
    if (!idAgrupamento) continue;

    const etqAgr = asRecord(a.etiquetasAgrupamento);
    const urlsAgr = asArray(etqAgr?.urls).map((u) => str(u)).filter(Boolean) as string[];
    const errAgr = str(etqAgr?.marketplaceError);

    for (const exp of asArray(a.expedicoes)) {
      const e = asRecord(exp);
      const resumo = asRecord(e?.resumo);
      const etqInd = asRecord(e?.etiquetas);
      const pedidoId = num(resumo?.pedidoId);
      const idExpedicao = num(resumo?.idExpedicao);
      if (!pedidoId || !idExpedicao) continue;

      const urlsInd = asArray(etqInd?.urls).map((u) => str(u)).filter(Boolean) as string[];
      const errInd = str(etqInd?.marketplaceError);

      let melhorUrls: string[] = [];
      let fonte: "agrupamento" | "individual" | null = null;
      if (urlsInd.length) {
        melhorUrls = urlsInd;
        fonte = "individual";
      } else if (urlsAgr.length) {
        melhorUrls = urlsAgr;
        fonte = "agrupamento";
      }

      out.push({
        erpOrderId: `TINY-${pedidoId}`,
        pedidoId,
        numeroPedido: num(resumo?.numeroPedido),
        idNotaFiscal: num(resumo?.idNotaFiscal),
        idAgrupamento,
        idExpedicao,
        identificacaoAgrupamento: str(a.identificacao),
        dataAgrupamento: str(a.data),
        formaEnvioNome: str(a.formaEnvioNome),
        idFormaEnvio: num(a.idFormaEnvio),
        tipoObjeto: str(resumo?.tipoObjeto),
        situacaoExpedicao: str(resumo?.situacao),
        etiquetaAgrupamento: {
          temEtiqueta: urlsAgr.length > 0,
          urls: urlsAgr,
          marketplaceError: errAgr,
        },
        etiquetaIndividual: {
          temEtiqueta: urlsInd.length > 0,
          urls: urlsInd,
          marketplaceError: errInd,
        },
        melhorEtiqueta: {
          temEtiqueta: melhorUrls.length > 0,
          urls: melhorUrls,
          fonte,
          marketplaceError: errInd ?? errAgr,
        },
      });
    }
  }

  return out;
}

function loadTestesPedido(): TestePedido[] {
  const testes: TestePedido[] = [];

  for (const name of readdirSync(DOCS)) {
    if (!name.startsWith("tiny-etiquetas") || !name.endsWith(".json")) continue;
    if (name === "tiny-etiquetas-expedicao.json" || name === "tiny-etiquetas-cruzamento.json") {
      continue;
    }

    const data = asRecord(readJson(resolve(DOCS, name)));

    if (Array.isArray(data?.resultados)) {
      for (const r of data.resultados) {
        const rec = asRecord(r);
        const pedidoId = num(rec?.pedidoId);
        if (!pedidoId) continue;
        const etq = asRecord(rec?.etiquetas);
        testes.push({
          origem: name,
          pedidoId,
          erpOrderId: str(rec?.erpOrderId) ?? `TINY-${pedidoId}`,
          formaEnvioNome: str(rec?.formaEnvioNome),
          situacao: num(rec?.situacao),
          expedicaoEncontradaViaPedido: Boolean(rec?.expedicao),
          temEtiquetaViaPedido: Boolean(rec?.temEtiqueta),
          agrupamentosVerificados: num(rec?.agrupamentosVerificados) ?? undefined,
          marketplaceErrorViaPedido: str(asRecord(etq)?.marketplaceError),
        });
      }
      continue;
    }

    const pedidoId = num(data?.pedidoId);
    if (!pedidoId) continue;
    const etq = asRecord(data?.etiquetas);
    const encontrado = asRecord(data?.encontrado);
    const urls = asArray(etq?.urls).length
      ? asArray(etq?.urls)
      : [
          ...asArray(asRecord(etq?.[`GET /expedicao/${encontrado?.idAgrupamento}/etiquetas`])?.resposta)
            .flatMap(() => []),
        ];
    const temEtiqueta = Boolean(
      etq?.temEtiqueta ||
        asArray(etq?.urls).some(Boolean) ||
        Object.values(etq ?? {}).some((v) => {
          const res = asRecord(asRecord(v)?.resposta);
          return asArray(res?.urls).length > 0;
        }),
    );

    testes.push({
      origem: name,
      pedidoId,
      erpOrderId: `TINY-${pedidoId}`,
      formaEnvioNome: str(data?.formaEnvioNome),
      situacao: null,
      expedicaoEncontradaViaPedido: Boolean(encontrado ?? data?.expedicao),
      temEtiquetaViaPedido: temEtiqueta,
      marketplaceErrorViaPedido: str(etq?.marketplaceError),
    });
  }

  return testes;
}

function dedupePedidosExpedicao(rows: PedidoExpedicao[]): Map<number, PedidoExpedicao> {
  const map = new Map<number, PedidoExpedicao>();
  for (const row of rows) {
    const prev = map.get(row.pedidoId);
    if (!prev || row.melhorEtiqueta.temEtiqueta) map.set(row.pedidoId, row);
  }
  return map;
}

function dedupeTestes(rows: TestePedido[]): Map<number, TestePedido> {
  const map = new Map<number, TestePedido>();
  for (const row of rows) map.set(row.pedidoId, row);
  return map;
}

function parseCli(argv: string[]) {
  let expedicaoPath = resolve(DOCS, "tiny-etiquetas-expedicao.json");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--expedicao") expedicaoPath = resolve(process.cwd(), argv[++i]);
  }
  return { expedicaoPath };
}

function main() {
  const { expedicaoPath } = parseCli(process.argv.slice(2));
  if (!existsSync(expedicaoPath)) {
    throw new Error(
      `Arquivo de expedição não encontrado: ${expedicaoPath}\nRode: pnpm teste-etiquetas-expedicao --limite 95`,
    );
  }

  const expedicaoRows = loadExpedicaoArquivo(expedicaoPath);
  const expedicaoPorPedido = dedupePedidosExpedicao(expedicaoRows);
  const testes = dedupeTestes(loadTestesPedido());

  const cruzamentos = [];
  const pedidosSoNaExpedicao: PedidoExpedicao[] = [];
  const pedidosSoNoTeste: TestePedido[] = [];

  for (const [pedidoId, exp] of expedicaoPorPedido) {
    const teste = testes.get(pedidoId);
    if (teste) {
      cruzamentos.push({
        pedidoId,
        erpOrderId: exp.erpOrderId,
        formaEnvioNome: exp.formaEnvioNome ?? teste.formaEnvioNome,
        expedicao: {
          idAgrupamento: exp.idAgrupamento,
          idExpedicao: exp.idExpedicao,
          identificacao: exp.identificacaoAgrupamento,
          data: exp.dataAgrupamento,
        },
        viaExpedicaoFirst: {
          temEtiqueta: exp.melhorEtiqueta.temEtiqueta,
          urls: exp.melhorEtiqueta.urls,
          fonte: exp.melhorEtiqueta.fonte,
          marketplaceError: exp.melhorEtiqueta.marketplaceError,
        },
        viaPedidoFirst: {
          testado: true,
          expedicaoEncontrada: teste.expedicaoEncontradaViaPedido,
          temEtiqueta: teste.temEtiquetaViaPedido,
          agrupamentosVerificados: teste.agrupamentosVerificados ?? null,
          marketplaceError: teste.marketplaceErrorViaPedido,
        },
        diagnostico: diagnosticoCruzamento(exp, teste),
      });
      testes.delete(pedidoId);
    } else {
      pedidosSoNaExpedicao.push(exp);
    }
  }

  for (const teste of testes.values()) pedidosSoNoTeste.push(teste);

  const statsExpedicao = {
    agrupamentosNoArquivo: asRecord(readJson(expedicaoPath))?.resumo,
    pedidosNaExpedicao: expedicaoPorPedido.size,
    comEtiqueta: [...expedicaoPorPedido.values()].filter((e) => e.melhorEtiqueta.temEtiqueta)
      .length,
    comErroMarketplace: [...expedicaoPorPedido.values()].filter(
      (e) => !e.melhorEtiqueta.temEtiqueta && e.melhorEtiqueta.marketplaceError,
    ).length,
    porFormaEnvio: agrupaPorFormaEnvio([...expedicaoPorPedido.values()]),
  };

  const statsTeste = {
    pedidosTestados: pedidosSoNoTeste.length + cruzamentos.length,
    viaPedidoExpedicaoEncontrada: [...cruzamentos, ...pedidosSoNoTeste].filter(
      (p) => ("viaPedidoFirst" in p ? p.viaPedidoFirst?.expedicaoEncontrada : p.expedicaoEncontradaViaPedido),
    ).length,
    viaPedidoSemExpedicao: pedidosSoNoTeste.filter((p) => !p.expedicaoEncontradaViaPedido).length,
  };

  const payload = {
    fetchedAt: new Date().toISOString(),
    fontes: {
      expedicao: expedicaoPath,
      testesPedido: readdirSync(DOCS).filter(
        (n) =>
          n.startsWith("tiny-etiquetas") &&
          n.endsWith(".json") &&
          n !== "tiny-etiquetas-expedicao.json" &&
          n !== "tiny-etiquetas-cruzamento.json",
      ),
    },
    recomendacao: buildRecomendacao(statsExpedicao, cruzamentos, pedidosSoNoTeste),
    estatisticas: {
      expedicao: statsExpedicao,
      testesPedido: statsTeste,
      cruzados: cruzamentos.length,
      soNaExpedicao: pedidosSoNaExpedicao.length,
      soNoTestePedido: pedidosSoNoTeste.length,
    },
    cruzamentos,
    pedidosSoNaExpedicao: pedidosSoNaExpedicao.map((e) => ({
      pedidoId: e.pedidoId,
      erpOrderId: e.erpOrderId,
      formaEnvioNome: e.formaEnvioNome,
      idAgrupamento: e.idAgrupamento,
      idExpedicao: e.idExpedicao,
      melhorEtiqueta: e.melhorEtiqueta,
    })),
    pedidosSoNoTestePedido: pedidosSoNoTeste.map((t) => ({
      pedidoId: t.pedidoId,
      erpOrderId: t.erpOrderId,
      formaEnvioNome: t.formaEnvioNome,
      expedicaoEncontradaViaPedido: t.expedicaoEncontradaViaPedido,
      agrupamentosVerificados: t.agrupamentosVerificados ?? null,
    })),
    indicePorPedido: Object.fromEntries(
      [...expedicaoPorPedido.entries()].map(([id, e]) => [
        id,
        {
          idAgrupamento: e.idAgrupamento,
          idExpedicao: e.idExpedicao,
          formaEnvioNome: e.formaEnvioNome,
          temEtiqueta: e.melhorEtiqueta.temEtiqueta,
          urls: e.melhorEtiqueta.urls,
        },
      ]),
    ),
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));

  console.log("--- Cruzamento pedido ↔ expedição ↔ etiqueta ---\n");
  console.log(`Pedidos na expedição (amostra): ${statsExpedicao.pedidosNaExpedicao}`);
  console.log(`  com etiqueta URL: ${statsExpedicao.comEtiqueta}`);
  console.log(`  erro marketplace: ${statsExpedicao.comErroMarketplace}`);
  console.log(`Pedidos testados (via pedido): ${statsTeste.pedidosTestados}`);
  console.log(`  sem expedição encontrada: ${statsTeste.viaPedidoSemExpedicao}`);
  console.log(`Cruzados (aparecem nos dois): ${cruzamentos.length}`);
  console.log(`Só na expedição: ${pedidosSoNaExpedicao.length}`);
  console.log(`Só no teste por pedido: ${pedidosSoNoTeste.length}`);
  console.log(`\nRecomendação: ${payload.recomendacao.fluxoWms}`);
  console.log(`\nSalvo: ${OUTPUT}`);
}

function agrupaPorFormaEnvio(rows: PedidoExpedicao[]) {
  const acc: Record<string, { total: number; comEtiqueta: number; comErro: number }> = {};
  for (const r of rows) {
    const k = r.formaEnvioNome ?? "Desconhecido";
    acc[k] ??= { total: 0, comEtiqueta: 0, comErro: 0 };
    acc[k].total += 1;
    if (r.melhorEtiqueta.temEtiqueta) acc[k].comEtiqueta += 1;
    else if (r.melhorEtiqueta.marketplaceError) acc[k].comErro += 1;
  }
  return Object.entries(acc).map(([formaEnvio, v]) => ({ formaEnvio, ...v }));
}

function diagnosticoCruzamento(exp: PedidoExpedicao, teste: TestePedido): string {
  if (exp.melhorEtiqueta.temEtiqueta) return "OK — etiqueta disponível na expedição";
  if (!teste.expedicaoEncontradaViaPedido && exp.idAgrupamento) {
    return "INCONSISTÊNCIA — está na expedição (scan direto) mas busca por pedido não achou (janela/filtro?)";
  }
  if (teste.expedicaoEncontradaViaPedido && !exp.melhorEtiqueta.temEtiqueta) {
    return "CONSISTENTE — expedição encontrada nos dois fluxos, sem URL (marketplace)";
  }
  if (!teste.expedicaoEncontradaViaPedido) {
    return "Pedido fora da expedição no teste por pedido";
  }
  return "Verificar manualmente";
}

function buildRecomendacao(
  statsExp: ReturnType<typeof agrupaPorFormaEnvio> extends infer _ ? {
    pedidosNaExpedicao: number;
    comEtiqueta: number;
    comErroMarketplace: number;
    porFormaEnvio: ReturnType<typeof agrupaPorFormaEnvio>;
  } : never,
  cruzamentos: unknown[],
  soTeste: TestePedido[],
) {
  const passos = [
    "1. Manter índice em memória/cache: pedidoId → { idAgrupamento, idExpedicao } construído via GET /expedicao + GET /expedicao/{id} (expedição-first), atualizado periodicamente ou sob demanda no packing.",
    "2. Para pedido WMS (TINY-{id}): consultar índice. Se não existir → status NOT_IN_EXPEDICAO (não varrer 500 agrupamentos por pedido).",
    "3. Com idAgrupamento + idExpedicao: GET /expedicao/{agrup}/expedicao/{exp}/etiquetas (individual primeiro); fallback GET /expedicao/{agrup}/etiquetas.",
    "4. Se urls[] vazio com erro marketplace → MARKETPLACE_ERROR na UI; não confundir com DANFE.",
    "5. Marketplace (ML/Shopee/Amazon): etiqueta só após agrupamento; URL depende da integração do marketplace.",
  ];

  return {
    fluxoWms:
      "Expedição-first com índice pedido→expedição; busca de etiqueta só quando o pedido está no índice.",
    porQueNaoPedidoFirst:
      "Busca pedido-a-pedido varreu 20–22 agrupamentos (filtro forma envio) e não achou pedidos que estão na expedição com outra forma/logística; lento e incompleto.",
    chavesDeLigacao: {
      primaria: "expedicoes[].venda.id === pedidoId Tiny",
      secundaria: "expedicoes[].notaFiscal.id === pedido.idNotaFiscal",
      terciaria: "expedicoes[].idObjeto + tipoObjeto (notafiscal/pedido/venda)",
    },
    rotasEtiqueta: {
      preferida: "GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas",
      fallback: "GET /expedicao/{idAgrupamento}/etiquetas",
    },
    dadosColetados: {
      pedidosNaExpedicaoAmostra: statsExp.pedidosNaExpedicao,
      comEtiquetaUrl: statsExp.comEtiqueta,
      erroMarketplace: statsExp.comErroMarketplace,
      pedidosTestadosSemExpedicao: soTeste.filter((p) => !p.expedicaoEncontradaViaPedido).length,
      cruzamentos,
    },
    passosImplementacao: passos,
  };
}

main();
