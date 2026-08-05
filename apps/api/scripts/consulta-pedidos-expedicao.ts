/**
 * Consulta pedidos específicos: GET /pedidos + rotas de expedição (1→4).
 *
 * Uso:
 *   pnpm consulta-pedidos-expedicao 860301754 860342783
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
  obterAgrupamentoExpedicao,
} from "../src/services/tiny-expedicao-labels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "../../../docs/tiny-consulta-pedidos.json");

function parsePedidoIds(argv: string[]): number[] {
  const ids = argv
    .map((a) => {
      const m = a.trim().match(/^(?:TINY-)?(\d+)$/i);
      return m ? Number(m[1]) : NaN;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) {
    throw new Error("Informe pedidos: pnpm consulta-pedidos-expedicao 860301754 860342783");
  }
  return ids;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

async function main() {
  const pedidoIds = parsePedidoIds(process.argv.slice(2));
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
  console.log(`Pedidos: ${pedidoIds.map((id) => `TINY-${id}`).join(", ")}\n`);

  console.log("Montando índice expedição (GET /expedicao + GET /expedicao/{id})…");
  const index = await buildPedidoExpedicaoIndex(client, { maxAgrupamentos: 200 });
  console.log(`Índice: ${index.size} chaves\n`);

  const resultados = [];

  for (const pedidoId of pedidoIds) {
    console.log(`=== TINY-${pedidoId} ===`);

    let pedidoResposta: unknown;
    try {
      pedidoResposta = await client.request("GET", `/pedidos/${pedidoId}`);
    } catch (e) {
      pedidoResposta = {
        erro: true,
        mensagem: e instanceof Error ? e.message : String(e),
      };
    }

    const ped = asRecord(pedidoResposta);
    const formaEnvioNome = str(asRecord(asRecord(ped?.transportador)?.formaEnvio)?.nome);
    console.log(
      `  GET /pedidos/${pedidoId}: situacao=${ped?.situacao ?? "?"} formaEnvio=${formaEnvioNome ?? "—"}`,
    );

    const idNotaFiscal = Number(ped?.idNotaFiscal) > 0 ? Number(ped?.idNotaFiscal) : null;
    const match = findPedidoNoIndice(index, pedidoId, idNotaFiscal);

    if (!match) {
      console.log("  Expedição: NÃO encontrada no índice\n");
      resultados.push({
        pedidoId,
        erpOrderId: `TINY-${pedidoId}`,
        "GET /pedidos/{id}": { resposta: pedidoResposta },
        expedicao: null,
        etiquetas: null,
      });
      continue;
    }

    console.log(
      `  Expedição: agrupamento=${match.idAgrupamento} expedição=${match.idExpedicao} (${match.formaEnvioNome ?? "—"})`,
    );

    const detalhe = await obterAgrupamentoExpedicao(client, match.idAgrupamento);
    const etiquetas = await buscarEtiquetasExpedicao(client, match);

    const temUrl = etiquetas.urls.length > 0;
    console.log(
      temUrl
        ? `  Etiquetas: ✓ ${etiquetas.urls.length} URL(s)`
        : `  Etiquetas: ✗ ${etiquetas.marketplaceError ?? "sem URL"}`,
    );
    console.log();

    resultados.push({
      pedidoId,
      erpOrderId: `TINY-${pedidoId}`,
      "GET /pedidos/{id}": { resposta: pedidoResposta },
      expedicao: match,
      "GET /expedicao/{idAgrupamento}": { resposta: detalhe },
      etiquetas: {
        "GET /expedicao/{idAgrupamento}/etiquetas": { resposta: etiquetas.agrupamento },
        "GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas": {
          resposta: etiquetas.individual,
        },
        urls: etiquetas.urls,
        marketplaceError: etiquetas.marketplaceError,
      },
    });
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    tenant: conn.tenant.name,
    pedidos: resultados,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(`Salvo: ${OUTPUT}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
