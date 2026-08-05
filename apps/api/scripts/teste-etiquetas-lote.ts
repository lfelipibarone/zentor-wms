/**
 * Testa vários pedidos Tiny e tenta capturar etiquetas de expedição.
 *
 * Uso:
 *   # IDs na linha de comando
 *   pnpm --filter @wms/api teste-etiquetas-lote TINY-860197915 TINY-860199959
 *
 *   # Últimos pedidos Tiny do banco WMS (tenant com OAuth conectado)
 *   pnpm --filter @wms/api teste-etiquetas-lote --db --limite 15
 *
 *   # Amostra aleatória do banco
 *   pnpm --filter @wms/api teste-etiquetas-lote --db --aleatorio --limite 30
 *
 *   # Aleatório excluindo pedidos já testados (lê pedidoIds de JSONs anteriores)
 *   pnpm --filter @wms/api teste-etiquetas-lote --db --aleatorio --limite 30 --excluir-testados --saida docs/tiny-etiquetas-lote-2.json
 *
 *   # Lista direto da API Tiny (quando o banco WMS está vazio)
 *   pnpm --filter @wms/api teste-etiquetas-lote --fonte-tiny --limite 40 --excluir-testados --saida docs/tiny-etiquetas-lote-3.json
 *
 *   # Lista em arquivo (um TINY-{id} ou só o número por linha)
 *   pnpm --filter @wms/api teste-etiquetas-lote --arquivo docs/pedidos-etiquetas.txt
 *
 *   # Varredura mais profunda na expedição
 *   $env:MAX_AGRUPAMENTOS=800; pnpm --filter @wms/api teste-etiquetas-lote --db --limite 10
 *
 * Saída: docs/tiny-etiquetas-lote.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OrderStatus, Prisma, TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient, type TinyApiV3Client } from "../src/services/tiny-api-v3-client.js";
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
const maxAgrupamentos = Number(process.env.MAX_AGRUPAMENTOS ?? 500);

type CliOptions = {
  pedidoIds: number[];
  fromDb: boolean;
  aleatorio: boolean;
  limite: number;
  status?: OrderStatus;
  arquivo?: string;
  excluirArquivos: string[];
  excluirTestados: boolean;
  fonteTiny: boolean;
  saida?: string;
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function parseCli(argv: string[]): CliOptions {
  const pedidoIds: number[] = [];
  let fromDb = false;
  let aleatorio = false;
  let limite = 10;
  let status: OrderStatus | undefined;
  let arquivo: string | undefined;
  const excluirArquivos: string[] = [];
  let excluirTestados = false;
  let fonteTiny = false;
  let saida: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") {
      fromDb = true;
      continue;
    }
    if (arg === "--fonte-tiny") {
      fonteTiny = true;
      continue;
    }
    if (arg === "--aleatorio") {
      aleatorio = true;
      continue;
    }
    if (arg === "--excluir-testados") {
      excluirTestados = true;
      continue;
    }
    if (arg === "--excluir-arquivo") {
      const path = argv[++i];
      if (!path) throw new Error("--excluir-arquivo requer um caminho");
      excluirArquivos.push(path);
      continue;
    }
    if (arg === "--saida") {
      saida = argv[++i];
      if (!saida) throw new Error("--saida requer um caminho");
      continue;
    }
    if (arg === "--limite") {
      limite = Number(argv[++i]);
      if (!Number.isFinite(limite) || limite <= 0) {
        throw new Error("--limite deve ser um número positivo");
      }
      continue;
    }
    if (arg === "--status") {
      const raw = argv[++i]?.toUpperCase();
      if (!raw || !(raw in OrderStatus)) {
        throw new Error(
          `--status inválido. Use: ${Object.keys(OrderStatus).join(", ")}`,
        );
      }
      status = raw as OrderStatus;
      continue;
    }
    if (arg === "--arquivo") {
      arquivo = argv[++i];
      if (!arquivo) throw new Error("--arquivo requer um caminho");
      continue;
    }
    const id = parseTinyPedidoId(arg);
    if (id) pedidoIds.push(id);
  }

  return {
    pedidoIds,
    fromDb,
    aleatorio,
    limite,
    status,
    arquivo,
    excluirArquivos,
    excluirTestados,
    fonteTiny,
    saida,
  };
}

function collectIdsFromJson(data: unknown, ids: Set<number>) {
  const rec = asRecord(data);
  if (!rec) return;
  if (Array.isArray(rec.pedidoIds)) {
    for (const id of rec.pedidoIds) {
      const n = parseTinyPedidoId(String(id));
      if (n) ids.add(n);
    }
  }
  if (Array.isArray(rec.excluidos)) {
    for (const id of rec.excluidos) {
      const n = parseTinyPedidoId(String(id));
      if (n) ids.add(n);
    }
  }
  if (typeof rec.pedidoId === "number" || typeof rec.pedidoId === "string") {
    const n = parseTinyPedidoId(String(rec.pedidoId));
    if (n) ids.add(n);
  }
  if (Array.isArray(rec.resultados)) {
    for (const item of rec.resultados) {
      const r = asRecord(item);
      if (!r) continue;
      const n = parseTinyPedidoId(String(r.pedidoId ?? r.erpOrderId ?? ""));
      if (n) ids.add(n);
    }
  }
}

function loadExcludeIds(options: CliOptions): Set<number> {
  const ids = new Set<number>();
  const docsDir = resolve(__dirname, "../../../docs");

  if (options.excluirTestados && existsSync(docsDir)) {
    for (const name of readdirSync(docsDir)) {
      if (!name.startsWith("tiny-etiquetas") || !name.endsWith(".json")) continue;
      try {
        collectIdsFromJson(JSON.parse(readFileSync(resolve(docsDir, name), "utf8")), ids);
      } catch {
        // ignora JSON inválido
      }
    }
    const pedidosTxt = resolve(docsDir, "pedidos-etiquetas.txt");
    if (existsSync(pedidosTxt)) {
      for (const id of parseIdsFromFile(pedidosTxt)) ids.add(id);
    }
  }

  for (const path of options.excluirArquivos) {
    const abs = resolve(process.cwd(), path);
    if (!existsSync(abs)) continue;
    if (abs.endsWith(".json")) {
      collectIdsFromJson(JSON.parse(readFileSync(abs, "utf8")), ids);
    } else {
      for (const id of parseIdsFromFile(path)) ids.add(id);
    }
  }

  return ids;
}

function parseIdsFromFile(path: string): number[] {
  const abs = resolve(process.cwd(), path);
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  const ids: number[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const id = parseTinyPedidoId(trimmed);
    if (id) ids.push(id);
  }
  if (!ids.length) {
    throw new Error(`Nenhum pedido válido em ${abs}`);
  }
  return ids;
}

async function loadIdsFromDb(
  tenantId: string,
  options: {
    limite: number;
    status?: OrderStatus;
    aleatorio?: boolean;
    excludeIds?: Set<number>;
  },
): Promise<number[]> {
  const erpOrderIdFilter = options.excludeIds?.size
    ? {
        startsWith: "TINY-" as const,
        notIn: [...options.excludeIds].map((id) => `TINY-${id}`),
      }
    : { startsWith: "TINY-" as const };

  const where = {
    tenantId,
    erpSource: "TINY",
    erpOrderId: erpOrderIdFilter,
    ...(options.status ? { status: options.status } : {}),
  };

  let orders: { erpOrderId: string }[];

  if (options.aleatorio) {
    const statusFilter = options.status
      ? Prisma.sql`AND status = ${options.status}::"OrderStatus"`
      : Prisma.empty;
    const excludeFilter =
      options.excludeIds && options.excludeIds.size > 0
        ? Prisma.sql`AND "erpOrderId" NOT IN (${Prisma.join(
            [...options.excludeIds].map((id) => Prisma.sql`${`TINY-${id}`}`),
          )})`
        : Prisma.empty;
    orders = await prisma.$queryRaw<{ erpOrderId: string }[]>`
      SELECT "erpOrderId"
      FROM "orders"
      WHERE "tenantId" = ${tenantId}
        AND "erpSource" = 'TINY'
        AND "erpOrderId" LIKE 'TINY-%'
        ${statusFilter}
        ${excludeFilter}
      ORDER BY RANDOM()
      LIMIT ${options.limite}
    `;
  } else {
    orders = await prisma.order.findMany({
      where,
      select: { erpOrderId: true },
      orderBy: { updatedAt: "desc" },
      take: options.limite,
    });
  }

  const ids = orders
    .map((o) => parseTinyPedidoId(o.erpOrderId))
    .filter((id): id is number => id !== null);

  if (!ids.length) {
    throw new Error(
      "Nenhum pedido TINY- no banco WMS. Rode sync de pedidos em /integracoes/tiny.",
    );
  }
  return ids;
}

async function loadIdsFromTinyApi(
  client: TinyApiV3Client,
  options: { limite: number; excludeIds: Set<number> },
): Promise<number[]> {
  const pool = new Set<number>();
  const windows = [14, 30, 7];
  const situacoes = [7, 5, 1, 3, 0];

  for (const days of windows) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const dateRange = { dataInicial: isoDate(start), dataFinal: isoDate(end) };

    for (const situacao of situacoes) {
      let offset = 0;
      while (offset < 3000) {
        let page;
        try {
          page = await client.listPedidos({
            ...dateRange,
            situacao,
            limit: 100,
            offset,
          });
        } catch {
          break;
        }

        for (const raw of page.items) {
          const id = num(asRecord(raw)?.id);
          if (id && !options.excludeIds.has(id)) pool.add(id);
        }

        const total = num(asRecord(page.pagination)?.total) ?? 0;
        offset += 100;
        if (offset >= total || page.items.length < 100) break;
        if (pool.size >= options.limite * 4) break;
      }
      if (pool.size >= options.limite * 4) break;
    }
    if (pool.size >= options.limite) break;
  }

  const ids = shuffle([...pool]).slice(0, options.limite);
  if (!ids.length) {
    throw new Error(
      "Nenhum pedido novo encontrado na API Tiny. Reduza exclusões ou ajuste o período.",
    );
  }
  return ids;
}

async function resolvePedidoIds(
  options: CliOptions,
  tenantId: string,
  excludeIds: Set<number>,
  client?: TinyApiV3Client,
): Promise<number[]> {
  if (options.arquivo) {
    return parseIdsFromFile(options.arquivo).filter((id) => !excludeIds.has(id));
  }
  if (options.fonteTiny) {
    if (!client) throw new Error("Cliente Tiny não disponível");
    return loadIdsFromTinyApi(client, { limite: options.limite, excludeIds });
  }
  if (options.fromDb) {
    return loadIdsFromDb(tenantId, {
      limite: options.limite,
      status: options.status,
      aleatorio: options.aleatorio,
      excludeIds,
    });
  }
  if (options.pedidoIds.length) {
    return options.pedidoIds;
  }
  throw new Error(
    [
      "Informe pedidos de uma destas formas:",
      "  pnpm --filter @wms/api teste-etiquetas-lote TINY-860301754 TINY-860197915",
      "  pnpm --filter @wms/api teste-etiquetas-lote --db --aleatorio --limite 30",
      "  pnpm --filter @wms/api teste-etiquetas-lote --arquivo docs/pedidos-etiquetas.txt",
    ].join("\n"),
  );
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
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) throw new Error("Tiny não conectado");
  const client = await getTinyApiClient(conn.tenantId);
  const excludeIds = loadExcludeIds(cli);
  const pedidoIds = await resolvePedidoIds(cli, conn.tenantId, excludeIds, client);

  if (!pedidoIds.length) {
    throw new Error(
      `Nenhum pedido disponível após excluir ${excludeIds.size} ID(s) já testados.`,
    );
  }

  const origem = cli.arquivo
    ? `arquivo ${cli.arquivo}`
    : cli.fonteTiny
      ? `API Tiny (aleatório, limite ${cli.limite}${excludeIds.size ? `, excluídos ${excludeIds.size}` : ""})`
      : cli.fromDb
      ? `banco WMS (${cli.aleatorio ? "aleatório" : "recentes"}, limite ${cli.limite}${cli.status ? `, status ${cli.status}` : ""}${excludeIds.size ? `, excluídos ${excludeIds.size}` : ""})`
      : "linha de comando";

  console.log(
    `Testando ${pedidoIds.length} pedido(s) via ${origem} (max ${maxAgrupamentos} agrup./pedido)…\n`,
  );
  if (excludeIds.size) {
    console.log(`Excluídos (já testados): ${excludeIds.size} pedido(s)\n`);
  }
  const resultados = [];

  for (const pedidoId of pedidoIds) {
    const erpOrderId = `TINY-${pedidoId}`;
    process.stdout.write(`${erpOrderId}… `);

    const ped = asRecord((await tinyGet(client, `/pedidos/${pedidoId}`)).resposta);
    if (!ped || ped.erro) {
      console.log("erro ao buscar pedido");
      resultados.push({ erpOrderId, pedidoId, erro: "Pedido não encontrado ou erro na API" });
      continue;
    }

    const nfRaw = num(ped.idNotaFiscal);
    const nf = nfRaw && nfRaw > 0 ? nfRaw : null;
    const formaEnvio = asRecord(asRecord(ped.transportador)?.formaEnvio);
    const idFormaEnvio = num(formaEnvio?.id);
    const formaEnvioNome = str(formaEnvio?.nome);
    const numeroPedidoEcommerce = str(asRecord(ped.ecommerce)?.numeroPedidoEcommerce);
    const window = dateWindowFromPedido(ped);

    const { match, agrupamentosVarridos } = await buscarExpedicaoDoPedido(
      client,
      pedidoId,
      {
        idNotaFiscal: nf,
        idFormaEnvio,
        ...window,
        maxAgrupamentos,
      },
    );

    let etiquetas: Record<string, unknown> | null = null;
    if (match) {
      const { idAgrupamento: a, idExpedicao: e } = match;
      const r1 = await tinyGet(client, `/expedicao/${a}/etiquetas`);
      const r2 = await tinyGet(client, `/expedicao/${a}/expedicao/${e}/etiquetas`);
      const urls = [
        ...extractEtiquetaUrls(r1.resposta),
        ...extractEtiquetaUrls(r2.resposta),
      ];
      const marketplaceError =
        extractMarketplaceError(r1.resposta) ?? extractMarketplaceError(r2.resposta);
      etiquetas = {
        idAgrupamento: a,
        idExpedicao: e,
        agrupamento: r1.resposta,
        individual: r2.resposta,
        urls,
        marketplaceError,
      };
      console.log(
        urls.length
          ? `ETIQUETA (${urls.length} URL)`
          : marketplaceError
            ? `expedição sem URL (${marketplaceError.slice(0, 60)}…)`
            : "expedição sem URL",
      );
    } else {
      console.log(`sem expedição (${agrupamentosVarridos} agrup. verificados)`);
    }

    resultados.push({
      erpOrderId,
      pedidoId,
      numeroPedido: ped.numeroPedido ?? null,
      situacao: ped.situacao ?? null,
      formaEnvioNome,
      numeroPedidoEcommerce,
      idNotaFiscal: nf,
      buscaExpedicao: { idFormaEnvio, ...window, maxAgrupamentos },
      agrupamentosVerificados: agrupamentosVarridos,
      expedicao: match
        ? {
            idAgrupamento: match.idAgrupamento,
            idExpedicao: match.idExpedicao,
            resumo: match.resumo,
          }
        : null,
      etiquetas,
      temEtiqueta: Boolean(etiquetas?.urls && (etiquetas.urls as string[]).length > 0),
    });
  }

  const comEtiqueta = resultados.filter((r) => r.temEtiqueta);
  const payload = {
    fetchedAt: new Date().toISOString(),
    origem,
    pedidoIds,
    excluidos: [...excludeIds].sort((a, b) => a - b),
    total: resultados.length,
    comEtiqueta: comEtiqueta.length,
    resultados,
  };

  const out = cli.saida
    ? resolve(__dirname, "../../../", cli.saida.replace(/^docs[\\/]/, "docs/"))
    : resolve(__dirname, "../../../docs/tiny-etiquetas-lote.json");
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
