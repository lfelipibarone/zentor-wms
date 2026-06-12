/** Teste rápido: achar pedido na expedição e chamar rotas de etiqueta */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient, TinyApiError, TinyApiV3Client } from "../src/services/tiny-api-v3-client.js";

const pedidoId = Number(process.argv[2] ?? 860184598);
const __dirname = dirname(fileURLToPath(import.meta.url));

const asRecord = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asArray = (v: unknown) => (Array.isArray(v) ? v : []);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function get(client: TinyApiV3Client, path: string, query?: Record<string, string | number | undefined>) {
  try {
    return { ok: true, resposta: await client.request("GET", path, { query }) };
  } catch (e) {
    return {
      ok: false,
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

async function main() {
  const conn = await prisma.tinyConnection.findFirst({
    where: { status: TinyConnectionStatus.CONNECTED, isActive: true, deletedAt: null, accessToken: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) throw new Error("Tiny não conectado");
  const client = await getTinyApiClient(conn.tenantId);

  const ped = asRecord((await get(client, `/pedidos/${pedidoId}`)).resposta);
  const nf = num(ped?.idNotaFiscal);
  const idFormaEnvio = num(asRecord(asRecord(ped?.transportador)?.formaEnvio)?.id);
  const dataInicial = "2026-05-01";
  const dataFinal = "2026-06-30";

  console.log(`Pedido ${pedidoId} | NF ${nf} | formaEnvio ${idFormaEnvio}`);
  console.log(`Busca expedicao ${dataInicial} → ${dataFinal}\n`);

  const searches = [
    { label: "forma envio + período amplo", dataInicial, dataFinal, idFormaEnvio },
    { label: "só período jun/2026", dataInicial: "2026-06-01", dataFinal: "2026-06-30" },
  ];

  let found: { idAgrupamento: number; idExpedicao: number } | null = null;
  const vistos = new Set<number>();

  for (const search of searches) {
    if (found) break;
    console.log(`\n--- ${search.label} ---`);
    for (let offset = 0; offset < 5000 && !found; offset += 100) {
      const lista = await get(client, "/expedicao", {
        limit: 100,
        offset,
        orderBy: "desc",
        dataInicial: search.dataInicial,
        dataFinal: search.dataFinal,
        ...(search.idFormaEnvio ? { idFormaEnvio: search.idFormaEnvio } : {}),
      });
      const itens = asArray(asRecord(lista.resposta)?.itens);
      const total = num(asRecord(asRecord(lista.resposta)?.paginacao)?.total) ?? 0;
      console.log(`offset=${offset} itens=${itens.length} total=${total}`);
      if (!itens.length) break;

      for (const item of itens) {
        const idAgr = num(asRecord(item)?.id);
        if (!idAgr || vistos.has(idAgr)) continue;
        vistos.add(idAgr);
        const det = await get(client, `/expedicao/${idAgr}`);
        for (const exp of asArray(asRecord(det.resposta)?.expedicoes)) {
          if (!match(pedidoId, nf, exp)) continue;
          const idExp = num(asRecord(exp)?.id);
          if (idExp) found = { idAgrupamento: idAgr, idExpedicao: idExp };
          break;
        }
        if (found) break;
      }
      if (offset + 100 >= total) break;
    }
  }

  const out: Record<string, unknown> = { pedidoId, nf, agrupamentosVarridos: vistos.size, found };

  if (!found) {
    console.log(`\nNão achado em ${vistos.size} agrupamentos no período.`);
    out.etiquetas = {
      erro: "Sem idAgrupamento/idExpedicao — pedido não está na expedição Tiny",
      tentativas: [],
    };
  } else {
    const a = found.idAgrupamento;
    const e = found.idExpedicao;
    const urlAgrup = `/expedicao/${a}/etiquetas`;
    const urlExp = `/expedicao/${a}/expedicao/${e}/etiquetas`;
    console.log(`\nEncontrado agrupamento=${a} expedicao=${e}`);
    console.log(`GET ${urlAgrup}`);
    const r1 = await get(client, urlAgrup);
    console.log(JSON.stringify(r1.resposta, null, 2));
    console.log(`GET ${urlExp}`);
    const r2 = await get(client, urlExp);
    console.log(JSON.stringify(r2.resposta, null, 2));
    out.etiquetas = {
      [`GET /expedicao/${a}/etiquetas`]: r1,
      [`GET /expedicao/${a}/expedicao/${e}/etiquetas`]: r2,
    };
  }

  const path = resolve(__dirname, `../../../docs/tiny-etiquetas-${pedidoId}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nSalvo ${path}`);
}

main().finally(() => prisma.$disconnect());
