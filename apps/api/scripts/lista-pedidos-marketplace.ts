/**
 * Lista pedidos Mercado Envios e Shopee com IDs para teste Postman.
 * Uso: pnpm lista-pedidos-marketplace
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient } from "../src/services/tiny-api-v3-client.js";
import {
  buildPedidoExpedicaoIndex,
  findPedidoNoIndice,
} from "../src/services/tiny-expedicao-labels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../../../docs/tiny-pedidos-marketplace-postman.json");

const SITUACAO: Record<number, string> = {
  0: "Aberta",
  1: "Faturada",
  5: "Enviada",
  6: "Entregue",
  7: "Pronto Envio",
};

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

function matchForma(nome: string | null, alvo: "ml" | "shopee"): boolean {
  const n = (nome ?? "").toLowerCase();
  if (alvo === "ml") return n.includes("mercado");
  return n.includes("shopee");
}

async function coletar(
  client: Awaited<ReturnType<typeof getTinyApiClient>>,
  index: Awaited<ReturnType<typeof buildPedidoExpedicaoIndex>>,
  alvo: "ml" | "shopee",
  limite: number,
) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const dataInicial = isoDate(start);
  const dataFinal = isoDate(end);

  const vistos = new Set<number>();
  const resultados: unknown[] = [];

  for (const situacao of [7, 5, 6, 0, 1]) {
    if (resultados.length >= limite) break;
    let offset = 0;
    while (resultados.length < limite) {
      const lista = await client.listPedidos({
        situacao,
        dataInicial,
        dataFinal,
        limit: 50,
        offset,
      });
      if (!lista.items.length) break;

      for (const item of lista.items) {
        if (resultados.length >= limite) break;
        const rec = asRecord(item);
        const pedidoId = num(rec?.id);
        if (!pedidoId || vistos.has(pedidoId)) continue;

        const formaEnvioNome = str(asRecord(asRecord(rec?.transportador)?.formaEnvio)?.nome);
        if (!matchForma(formaEnvioNome, alvo)) continue;

        vistos.add(pedidoId);
        const idNotaFiscal = num(rec?.idNotaFiscal);
        const match = findPedidoNoIndice(index, pedidoId, idNotaFiscal);
        const situacaoN = Number(rec?.situacao);

        resultados.push({
          marketplace: alvo === "ml" ? "Mercado Livre" : "Shopee",
          pedidoId,
          erpOrderId: `TINY-${pedidoId}`,
          numeroPedido: rec?.numeroPedido ?? null,
          situacao: situacaoN,
          situacaoLabel: SITUACAO[situacaoN] ?? `sit ${situacaoN}`,
          formaEnvioNome,
          idNotaFiscal,
          codigoRastreamento: str(asRecord(rec?.transportador)?.codigoRastreamento),
          pedidoEcommerce: str(asRecord(rec?.ecommerce)?.numeroPedidoEcommerce),
          naExpedicao: Boolean(match),
          idAgrupamento: match?.idAgrupamento ?? null,
          idExpedicao: match?.idExpedicao ?? null,
          postman: {
            passo3: `GET /pedidos/${pedidoId}`,
            passo2: match
              ? `GET /expedicao/${match.idAgrupamento}`
              : null,
            passo5: match
              ? `GET /expedicao/${match.idAgrupamento}/etiquetas`
              : null,
            passo6: match
              ? `GET /expedicao/${match.idAgrupamento}/expedicao/${match.idExpedicao}/etiquetas`
              : null,
          },
        });
      }

      offset += 50;
      if (offset >= lista.total) break;
    }
  }

  return resultados;
}

async function main() {
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
  console.log("Montando índice expedição…");
  const index = await buildPedidoExpedicaoIndex(client, { maxAgrupamentos: 250 });

  console.log("Buscando Mercado Livre…");
  const mercado = await coletar(client, index, "ml", 5);
  console.log("Buscando Shopee…");
  const shopee = await coletar(client, index, "shopee", 5);

  const payload = {
    fetchedAt: new Date().toISOString(),
    tenant: conn.tenant.name,
    baseUrl: "https://api.tiny.com.br/public-api/v3",
    mercadoLivre: mercado,
    shopee,
    referenciaFixa: {
      mercadoLivreNaExpedicao: {
        pedidoId: 860301754,
        idNotaFiscal: 860301759,
        idAgrupamento: 746503742,
        idExpedicao: 749882106,
        diagnostico: "Na expedição — erro ML S47281733718",
      },
    },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));

  console.log(`\nMercado Livre: ${mercado.length} pedidos`);
  for (const p of mercado as { pedidoId: number; naExpedicao: boolean; idAgrupamento: number | null }[]) {
    console.log(
      `  TINY-${p.pedidoId} exp=${p.naExpedicao ? p.idAgrupamento : "fora"}`,
    );
  }
  console.log(`\nShopee: ${shopee.length} pedidos`);
  for (const p of shopee as { pedidoId: number; naExpedicao: boolean; idAgrupamento: number | null }[]) {
    console.log(
      `  TINY-${p.pedidoId} exp=${p.naExpedicao ? p.idAgrupamento : "fora"}`,
    );
  }
  console.log(`\nSalvo: ${OUT}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
