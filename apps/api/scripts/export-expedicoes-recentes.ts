/**
 * Varre GET /expedicao dos últimos N dias e salva JSON completo.
 * Etiquetas: rota do lote + rota individual por expedição (igual ao WMS).
 *
 * Uso: npx tsx scripts/export-expedicoes-recentes.ts --dias 7
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient } from "../src/services/tiny-api-v3-client.js";
import { buscarEtiquetasExpedicao } from "../src/services/tiny-expedicao-labels.js";
import {
  asArray,
  asRecord,
  extractEtiquetaUrls,
  extractMarketplaceError,
  num,
  str,
  tinyGet,
} from "./lib/tiny-expedicao-search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../../docs/postman");

function parseDias(argv: string[]): number {
  const i = argv.indexOf("--dias");
  if (i >= 0 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 7;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function classificarForma(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes("amazon")) return "amazon";
  if (n.includes("shopee")) return "shopee";
  if (n.includes("mercado")) return "mercado_livre";
  return "outros";
}

type EtiquetaProbe = {
  ok: boolean;
  urls: string[];
  erro: string | null;
  resposta: unknown;
};

function probeEtiquetaResposta(resposta: unknown): EtiquetaProbe {
  const urls = extractEtiquetaUrls(resposta);
  const erro = extractMarketplaceError(resposta);
  const rec = asRecord(resposta);
  const msg =
    erro ??
    (rec?.erro && !urls.length ? str(rec.mensagem) : null) ??
    null;
  return {
    ok: urls.length > 0,
    urls,
    erro: msg,
    resposta,
  };
}

async function probeEtiquetaLote(
  client: Parameters<typeof buscarEtiquetasExpedicao>[0],
  idAgrupamento: number,
): Promise<EtiquetaProbe> {
  const wrap = await tinyGet(client, `/expedicao/${idAgrupamento}/etiquetas`);
  if (!wrap.ok) {
    const body = asRecord(wrap.resposta);
    return {
      ok: false,
      urls: [],
      erro: str(body?.mensagem) ?? "falha HTTP",
      resposta: wrap.resposta,
    };
  }
  return probeEtiquetaResposta(wrap.resposta);
}

type ExpedicaoItem = {
  idExpedicao: number | null;
  pedidoId: number | null;
  numeroPedido: number | null;
  idNotaFiscal: number | null;
  numeroNota: number | null;
  situacao: string | null;
  destinatario: string | null;
  etiquetas: {
    ok: boolean;
    urls: string[];
    marketplaceError: string | null;
    rotaLote: unknown;
    rotaIndividual: unknown;
  };
};

type AgrupamentoItem = {
  idAgrupamento: number;
  identificacao: string | null;
  data: string | null;
  quantidadeObjetos: number | null;
  formaEnvio: { id: number | null; nome: string | null };
  categoria: string;
  etiquetasLote: EtiquetaProbe;
  urlsConsolidadas: string[];
  temEtiqueta: boolean;
  expedicoes: ExpedicaoItem[];
};

async function main() {
  const dias = parseDias(process.argv.slice(2));
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - dias);
  const dataInicial = isoDate(inicio);
  const dataFinal = isoDate(fim);

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
  if (!conn) throw new Error("Tiny não conectado.");

  const client = await getTinyApiClient({
    tenantId: conn.tenantId,
    connectionId: conn.id,
  });

  console.log(`Janela: ${dataInicial} → ${dataFinal} (${dias} dias)`);
  console.log("Etiquetas: GET .../etiquetas (lote) + GET .../expedicao/{id}/etiquetas (individual)\n");

  const todas: AgrupamentoItem[] = [];
  const vistos = new Set<number>();
  let offset = 0;
  const limit = 100;
  let total = Infinity;
  let pages = 0;
  const maxPages = 50;
  let expedicoesTestadas = 0;

  while (offset < total && pages < maxPages) {
    const wrap = await tinyGet(client, "/expedicao", {
      limit,
      offset,
      orderBy: "desc",
    });
    if (!wrap.ok) {
      console.error("GET /expedicao falhou:", wrap.resposta);
      break;
    }

    const lista = asRecord(wrap.resposta);
    total = num(asRecord(lista?.paginacao)?.total) ?? 0;
    const itens = asArray(lista?.itens);
    if (!itens.length) break;
    pages++;

    let pararPorData = false;
    for (const item of itens) {
      const rec = asRecord(item);
      const idAgrupamento = num(rec?.id);
      const data = str(rec?.data);
      if (!idAgrupamento || vistos.has(idAgrupamento)) continue;
      vistos.add(idAgrupamento);

      if (data && data > dataFinal) continue;
      if (data && data < dataInicial) {
        pararPorData = true;
        continue;
      }

      const formaRec = asRecord(rec?.formaEnvio);
      const formaNome = str(formaRec?.nome);
      const categoria = classificarForma(formaNome ?? "");

      const detWrap = await tinyGet(client, `/expedicao/${idAgrupamento}`);
      const detalhe = detWrap.ok ? asRecord(detWrap.resposta) : null;
      const expedicoesRaw = asArray(detalhe?.expedicoes);

      const etiquetasLote = await probeEtiquetaLote(client, idAgrupamento);
      const urlsSet = new Set<string>(etiquetasLote.urls);

      const expedicoes: ExpedicaoItem[] = [];
      for (const exp of expedicoesRaw) {
        const e = asRecord(exp);
        const venda = asRecord(e?.venda);
        const nf = asRecord(e?.notaFiscal);
        const dest = asRecord(e?.destinatario);
        const idExpedicao = num(e?.id);

        let etiquetas: ExpedicaoItem["etiquetas"] = {
          ok: false,
          urls: [],
          marketplaceError: null,
          rotaLote: null,
          rotaIndividual: null,
        };

        if (idExpedicao) {
          expedicoesTestadas += 1;
          const et = await buscarEtiquetasExpedicao(client, {
            idAgrupamento,
            idExpedicao,
          });
          for (const u of et.urls) urlsSet.add(u);
          etiquetas = {
            ok: et.urls.length > 0,
            urls: et.urls,
            marketplaceError: et.marketplaceError,
            rotaLote: et.agrupamento,
            rotaIndividual: et.individual,
          };
        }

        expedicoes.push({
          idExpedicao,
          pedidoId: num(venda?.id),
          numeroPedido: num(venda?.numero),
          idNotaFiscal: num(nf?.id),
          numeroNota: num(nf?.numero),
          situacao: str(e?.situacao),
          destinatario: str(dest?.nome),
          etiquetas,
        });
      }

      const urlsConsolidadas = [...urlsSet];
      todas.push({
        idAgrupamento,
        identificacao: str(rec?.identificacao) ?? str(detalhe?.identificacao),
        data,
        quantidadeObjetos: num(rec?.quantidadeObjetos),
        formaEnvio: { id: num(formaRec?.id), nome: formaNome },
        categoria,
        etiquetasLote,
        urlsConsolidadas,
        temEtiqueta: urlsConsolidadas.length > 0,
        expedicoes,
      });

      const okMark = urlsConsolidadas.length > 0 ? "✓" : "✗";
      process.stdout.write(
        `\r  ${todas.length} agr. ${okMark} (${categoria}) ${data} #${idAgrupamento} — ${expedicoesTestadas} exp. testadas   `,
      );
    }

    if (pararPorData && todas.length > 0) break;
    offset += limit;
    if (offset >= total) break;
  }

  console.log("\n");

  const porCategoria = {
    amazon: todas.filter((a) => a.categoria === "amazon"),
    shopee: todas.filter((a) => a.categoria === "shopee"),
    mercado_livre: todas.filter((a) => a.categoria === "mercado_livre"),
    outros: todas.filter((a) => a.categoria === "outros"),
  };

  const expedicoesComEtiqueta = todas.flatMap((a) =>
    a.expedicoes.filter((e) => e.etiquetas.ok).map((e) => ({
      idAgrupamento: a.idAgrupamento,
      data: a.data,
      categoria: a.categoria,
      formaEnvio: a.formaEnvio.nome,
      idExpedicao: e.idExpedicao,
      pedidoId: e.pedidoId,
      urls: e.etiquetas.urls,
    })),
  );

  const resumo = {
    totalAgrupamentos: todas.length,
    amazon: porCategoria.amazon.length,
    shopee: porCategoria.shopee.length,
    mercado_livre: porCategoria.mercado_livre.length,
    outros: porCategoria.outros.length,
    expedicoesTestadas,
    agrupamentosComEtiqueta: todas.filter((a) => a.temEtiqueta).length,
    expedicoesComEtiqueta: expedicoesComEtiqueta.length,
    agrupamentosSoErroLoteMasIndividualOk: todas.filter(
      (a) => !a.etiquetasLote.ok && a.expedicoes.some((e) => e.etiquetas.ok),
    ).length,
  };

  const payload = {
    geradoEm: new Date().toISOString(),
    tenant: conn.tenant.name,
    dataInicial,
    dataFinal,
    dias,
    nota: "temEtiqueta = urls de lote OU individual (buscarEtiquetasExpedicao, igual WMS)",
    resumo,
    expedicoesComEtiqueta,
    agrupamentos: todas,
    porCategoria,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, `expedicoes-ultimos-${dias}-dias.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log("Resumo:");
  console.log(`  Agrupamentos:              ${resumo.totalAgrupamentos}`);
  console.log(`  Amazon / ML / Shopee:      ${resumo.amazon} / ${resumo.mercado_livre} / ${resumo.shopee}`);
  console.log(`  Expedições testadas:       ${resumo.expedicoesTestadas}`);
  console.log(`  Agrup. com etiqueta:       ${resumo.agrupamentosComEtiqueta}`);
  console.log(`  Expedições com etiqueta:   ${resumo.expedicoesComEtiqueta}`);
  console.log(`  Lote falhou, individual OK: ${resumo.agrupamentosSoErroLoteMasIndividualOk}`);
  if (expedicoesComEtiqueta.length) {
    console.log("\n  Com etiqueta:");
    for (const e of expedicoesComEtiqueta.slice(0, 10)) {
      console.log(
        `    ${e.categoria} pedido=${e.pedidoId} agr=${e.idAgrupamento} exp=${e.idExpedicao}`,
      );
    }
  }
  console.log(`\nSalvo: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
