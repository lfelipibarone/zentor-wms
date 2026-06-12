/**
 * Testa vários pedidos Tiny e tenta capturar etiquetas de expedição.
 * Uso: pnpm tsx scripts/teste-etiquetas-lote.ts TINY-860197915 TINY-860199959 ...
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient, TinyApiError, TinyApiV3Client } from "../src/services/tiny-api-v3-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const asRecord = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asArray = (v: unknown) => (Array.isArray(v) ? v : []);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function parseIds(argv: string[]): number[] {
  const ids: number[] = [];
  for (const arg of argv) {
    const m = arg.trim().match(/^TINY-(\d+)$/i) ?? arg.trim().match(/^(\d+)$/);
    if (m) ids.push(Number(m[1]));
  }
  if (!ids.length) throw new Error("Informe pelo menos um TINY-{id}");
  return ids;
}

async function get(client: TinyApiV3Client, path: string, query?: Record<string, string | number | undefined>) {
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

function match(pedidoId: number, nf: number | null, exp: unknown) {
  const r = asRecord(exp);
  if (!r) return false;
  if (num(asRecord(r.venda)?.id) === pedidoId) return true;
  if (nf && num(asRecord(r.notaFiscal)?.id) === nf) return true;
  const t = String(r.tipoObjeto ?? "").toLowerCase();
  const obj = num(r.idObjeto);
  if (nf && obj === nf && t.includes("nota")) return true;
  if (obj === pedidoId && (t.includes("pedido") || t.includes("venda"))) return true;
  return false;
}

async function buscarExpedicao(
  client: TinyApiV3Client,
  pedidoId: number,
  nf: number | null,
  idFormaEnvio: number | null,
) {
  const vistos = new Set<number>();
  const searches = [
    { dataInicial: "2026-05-01", dataFinal: "2026-06-30", idFormaEnvio },
    { dataInicial: "2026-06-01", dataFinal: "2026-06-30" },
  ];

  for (const search of searches) {
    for (let offset = 0; offset < 5000; offset += 100) {
      const lista = await get(client, "/expedicao", {
        limit: 100,
        offset,
        orderBy: "desc",
        dataInicial: search.dataInicial,
        dataFinal: search.dataFinal,
        ...(search.idFormaEnvio ? { idFormaEnvio: search.idFormaEnvio } : {}),
      });
      const body = asRecord(lista.resposta);
      if (!lista.ok || body?.erro) break;
      const itens = asArray(body?.itens);
      const total = num(asRecord(body?.paginacao)?.total) ?? 0;
      if (!itens.length) break;

      for (const item of itens) {
        const idAgr = num(asRecord(item)?.id);
        if (!idAgr || vistos.has(idAgr)) continue;
        vistos.add(idAgr);
        const det = await get(client, `/expedicao/${idAgr}`);
        for (const exp of asArray(asRecord(det.resposta)?.expedicoes)) {
          if (!match(pedidoId, nf, exp)) continue;
          const idExp = num(asRecord(exp)?.id);
          if (idExp) return { idAgrupamento: idAgr, idExpedicao: idExp, resumo: exp, vistos: vistos.size };
        }
      }
      if (offset + 100 >= total) break;
    }
  }
  return { idAgrupamento: null, idExpedicao: null, resumo: null, vistos: vistos.size };
}

async function main() {
  const pedidoIds = parseIds(process.argv.slice(2));
  const conn = await prisma.tinyConnection.findFirst({
    where: { status: TinyConnectionStatus.CONNECTED, isActive: true, deletedAt: null, accessToken: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) throw new Error("Tiny não conectado");
  const client = await getTinyApiClient(conn.tenantId);

  console.log(`Testando ${pedidoIds.length} pedido(s)…\n`);
  const resultados = [];

  for (const pedidoId of pedidoIds) {
    const erpOrderId = `TINY-${pedidoId}`;
    process.stdout.write(`${erpOrderId}… `);

    const ped = asRecord((await get(client, `/pedidos/${pedidoId}`)).resposta);
    if (!ped || ped.erro) {
      console.log("erro ao buscar pedido");
      resultados.push({ erpOrderId, pedidoId, erro: "Pedido não encontrado ou erro na API" });
      continue;
    }

    const nf = num(ped.idNotaFiscal);
    const idFormaEnvio = num(asRecord(asRecord(ped.transportador)?.formaEnvio)?.id);
    const formaEnvioNome = asRecord(asRecord(ped.transportador)?.formaEnvio)?.nome ?? null;
    const numeroPedidoEcommerce = asRecord(ped.ecommerce)?.numeroPedidoEcommerce ?? null;

    const found = await buscarExpedicao(client, pedidoId, nf, idFormaEnvio);

    let etiquetas: Record<string, unknown> | null = null;
    if (found.idAgrupamento && found.idExpedicao) {
      const a = found.idAgrupamento;
      const e = found.idExpedicao;
      const r1 = await get(client, `/expedicao/${a}/etiquetas`);
      const r2 = await get(client, `/expedicao/${a}/expedicao/${e}/etiquetas`);
      const urls = [
        ...asArray(asRecord(r1.resposta)?.urls),
        ...asArray(asRecord(r2.resposta)?.urls),
      ].filter(Boolean);
      etiquetas = {
        idAgrupamento: a,
        idExpedicao: e,
        agrupamento: r1.resposta,
        individual: r2.resposta,
        urls,
      };
      console.log(urls.length ? `ETIQUETA (${urls.length} URL)` : "expedição sem URL");
    } else {
      console.log(`sem expedição (${found.vistos} agrup. verificados)`);
    }

    resultados.push({
      erpOrderId,
      pedidoId,
      numeroPedido: ped.numeroPedido ?? null,
      situacao: ped.situacao ?? null,
      formaEnvioNome,
      numeroPedidoEcommerce,
      idNotaFiscal: nf,
      agrupamentosVerificados: found.vistos,
      expedicao: found.idAgrupamento
        ? { idAgrupamento: found.idAgrupamento, idExpedicao: found.idExpedicao, resumo: found.resumo }
        : null,
      etiquetas,
      temEtiqueta: Boolean(etiquetas?.urls && asArray(etiquetas.urls).length > 0),
    });
  }

  const comEtiqueta = resultados.filter((r) => r.temEtiqueta);
  const payload = {
    fetchedAt: new Date().toISOString(),
    total: resultados.length,
    comEtiqueta: comEtiqueta.length,
    resultados,
  };

  const out = resolve(__dirname, "../../../docs/tiny-etiquetas-lote.json");
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`\n--- Resumo ---`);
  console.log(`Com etiqueta: ${comEtiqueta.length}/${resultados.length}`);
  for (const r of resultados) {
    const flag = r.temEtiqueta ? "✓ ETIQUETA" : "✗ sem etiqueta";
    console.log(`  ${r.erpOrderId} — ${r.formaEnvioNome ?? "?"} — ${flag}`);
  }
  console.log(`\nSalvo: ${out}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
