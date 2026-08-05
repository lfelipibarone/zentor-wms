/**
 * Teste rápido: localizar pedido na expedição Tiny e chamar rotas de etiqueta.
 *
 * Uso:
 *   pnpm --filter @wms/api teste-etiquetas 860301754
 *   pnpm --filter @wms/api teste-etiquetas TINY-860301754
 *
 * Saída: docs/tiny-etiquetas-{id}.json
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient } from "../src/services/tiny-api-v3-client.js";
import {
  asRecord,
  buscarExpedicaoDoPedido,
  dateWindowFromPedido,
  extractEtiquetaUrls,
  extractMarketplaceError,
  num,
  parseTinyPedidoId,
  str,
  tinyGet,
} from "./lib/tiny-expedicao-search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pedidoArg = process.argv[2];
const pedidoId = parseTinyPedidoId(pedidoArg ?? "");
if (!pedidoId) {
  throw new Error(
    "Informe o pedido: pnpm --filter @wms/api teste-etiquetas TINY-860301754",
  );
}

const maxAgrupamentos = Number(process.env.MAX_AGRUPAMENTOS ?? 500);

async function main() {
  const conn = await prisma.tinyConnection.findFirst({
    where: {
      status: TinyConnectionStatus.CONNECTED,
      isActive: true,
      deletedAt: null,
      accessToken: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) throw new Error("Tiny não conectado");

  const client = await getTinyApiClient(conn.tenantId);
  const ped = asRecord((await tinyGet(client, `/pedidos/${pedidoId}`)).resposta);
  if (!ped || ped.erro) {
    throw new Error(str(ped?.mensagem) ?? "Pedido não encontrado no Tiny");
  }

  const nfRaw = num(ped.idNotaFiscal);
  const nf = nfRaw && nfRaw > 0 ? nfRaw : null;
  const formaEnvio = asRecord(asRecord(ped.transportador)?.formaEnvio);
  const idFormaEnvio = num(formaEnvio?.id);
  const formaEnvioNome = str(formaEnvio?.nome);
  const window = dateWindowFromPedido(ped);

  console.log(`Pedido TINY-${pedidoId}`);
  console.log(`  situacao=${ped.situacao} numero=${ped.numeroPedido}`);
  console.log(`  NF=${nf ?? "—"} formaEnvio=${formaEnvioNome ?? idFormaEnvio ?? "—"}`);
  console.log(
    `  janela expedição: ${window.dataInicial} → ${window.dataFinal} (max ${maxAgrupamentos} agrup.)\n`,
  );

  const { match, agrupamentosVarridos } = await buscarExpedicaoDoPedido(
    client,
    pedidoId,
    {
      idNotaFiscal: nf,
      idFormaEnvio,
      ...window,
      maxAgrupamentos,
      onProgress: ({ scanned, idAgrupamento }) => {
        process.stdout.write(`\r  agrupamento ${scanned} (id=${idAgrupamento})…`);
      },
    },
  );
  console.log(`\n  varridos: ${agrupamentosVarridos}`);

  const out: Record<string, unknown> = {
    fetchedAt: new Date().toISOString(),
    pedidoId,
    idNotaFiscal: nf,
    formaEnvioNome,
    buscaExpedicao: { idFormaEnvio, ...window, maxAgrupamentos },
    agrupamentosVarridos,
    encontrado: match,
  };

  if (!match) {
    console.log("\nPedido não encontrado em agrupamento de expedição.");
    out.etiquetas = {
      erro: "Sem idAgrupamento/idExpedicao — pedido não está na expedição Tiny",
      tentativas: [],
    };
  } else {
    const { idAgrupamento: a, idExpedicao: e } = match;
    console.log(`\nEncontrado agrupamento=${a} expedicao=${e}`);

    const r1 = await tinyGet(client, `/expedicao/${a}/etiquetas`);
    const r2 = await tinyGet(client, `/expedicao/${a}/expedicao/${e}/etiquetas`);
    const urls = [
      ...extractEtiquetaUrls(r1.resposta),
      ...extractEtiquetaUrls(r2.resposta),
    ];
    const marketplaceError =
      extractMarketplaceError(r1.resposta) ?? extractMarketplaceError(r2.resposta);

    console.log(`GET /expedicao/${a}/etiquetas`);
    console.log(JSON.stringify(r1.resposta, null, 2));
    console.log(`GET /expedicao/${a}/expedicao/${e}/etiquetas`);
    console.log(JSON.stringify(r2.resposta, null, 2));
    console.log(
      urls.length
        ? `\n✓ ${urls.length} URL(s) de etiqueta`
        : marketplaceError
          ? `\n✗ marketplace: ${marketplaceError}`
          : "\n✗ expedição sem URL",
    );

    out.etiquetas = {
      [`GET /expedicao/${a}/etiquetas`]: r1,
      [`GET /expedicao/${a}/expedicao/${e}/etiquetas`]: r2,
      urls,
      marketplaceError,
      temEtiqueta: urls.length > 0,
    };
  }

  const path = resolve(__dirname, `../../../docs/tiny-etiquetas-${pedidoId}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nSalvo ${path}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
