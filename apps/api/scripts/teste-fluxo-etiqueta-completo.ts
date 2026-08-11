/**
 * Fluxo completo de etiqueta Tiny — documenta cada etapa + retorno real.
 *
 * Etapas:
 *   1. GET /pedidos/{id}
 *   2. GET /notas/{idNota} (se houver)
 *   3. POST /expedicao (criar agrupamento) — se ainda não estiver em um
 *   4. GET /expedicao/{idAgrupamento}
 *   5. GET /expedicao/{idAgrupamento}/etiquetas
 *   6. GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas
 *   7. POST /expedicao/{idAgrupamento}/concluir
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/teste-fluxo-etiqueta-completo.ts TINY-861203611
 *   pnpm exec tsx --env-file .env scripts/teste-fluxo-etiqueta-completo.ts 861203611
 *   pnpm exec tsx --env-file .env scripts/teste-fluxo-etiqueta-completo.ts --numero 214617
 *
 * Flags:
 *   --skip-concluir   não chama POST .../concluir
 *   --numero N        resolve id via GET /pedidos?numero=N
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import {
  getTinyApiClient,
  TinyApiError,
  TinyApiV3Client,
} from "../src/services/tiny-api-v3-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "../../../docs");

type Etapa = {
  ordem: number;
  nome: string;
  metodo: string;
  rota: string;
  requestBody?: unknown;
  http: number | null;
  ok: boolean;
  resposta: unknown;
  erro?: string;
  observacao?: string;
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

function parseArgs(argv: string[]) {
  let skipConcluir = false;
  let numero: number | null = null;
  let pedidoArg: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skip-concluir") skipConcluir = true;
    else if (a === "--numero") numero = Number(argv[++i]);
    else if (!a.startsWith("-")) pedidoArg = a;
  }

  return { skipConcluir, numero, pedidoArg };
}

function parsePedidoId(raw: string): number {
  const m = raw.trim().match(/^TINY-(\d+)$/i) ?? raw.trim().match(/^(\d+)$/);
  if (!m) throw new Error(`ID inválido: ${raw}`);
  const id = Number(m[1]);
  if (!Number.isFinite(id) || id <= 0) throw new Error(`ID inválido: ${raw}`);
  return id;
}

async function getClient(): Promise<{ client: TinyApiV3Client; tenantId: string }> {
  const conn = await prisma.tinyConnection.findFirst({
    where: {
      status: TinyConnectionStatus.CONNECTED,
      isActive: true,
      deletedAt: null,
      accessToken: { not: null },
    },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });

  if (!conn) {
    const broken = await prisma.tinyConnection.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { status: true, lastError: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    const detalhe = broken
      ? ` Status atual=${broken.status}; lastError=${broken.lastError ?? "—"}; updatedAt=${broken.updatedAt.toISOString()}.`
      : " Nenhuma conexão Tiny ativa no banco.";
    throw new Error(
      "Tiny não CONNECTED." +
        detalhe +
        " Abra http://localhost:3000/integracoes/tiny (API no ar com este DATABASE_URL)," +
        " confira Client ID/Secret do app Tiny, clique Conectar/Reconectar até status CONNECTED," +
        " depois rode de novo: pnpm teste-fluxo-etiqueta --numero 214617",
    );
  }

  console.log(`Tenant: ${conn.tenant.name} (${conn.tenant.slug})`);
  const client = await getTinyApiClient(conn.tenantId);
  return { client, tenantId: conn.tenantId };
}

async function call(
  client: TinyApiV3Client,
  metodo: "GET" | "POST",
  rota: string,
  opts?: { body?: unknown; query?: Record<string, string | number | undefined> },
): Promise<{ http: number | null; ok: boolean; resposta: unknown; erro?: string }> {
  try {
    const resposta = await client.request(metodo, rota, {
      body: opts?.body,
      query: opts?.query,
    });
    return { http: 200, ok: true, resposta };
  } catch (e) {
    const err = e instanceof TinyApiError ? e : null;
    return {
      http: err?.statusCode ?? null,
      ok: false,
      resposta: null,
      erro: e instanceof Error ? e.message : String(e),
    };
  }
}

function pedidoNaExpedicao(
  pedidoId: number,
  idNotaFiscal: number | null,
  exp: unknown,
): boolean {
  const rec = asRecord(exp);
  if (!rec) return false;
  const vendaId = num(asRecord(rec.venda)?.id);
  if (vendaId === pedidoId) return true;
  const notaId = num(asRecord(rec.notaFiscal)?.id);
  if (idNotaFiscal && notaId === idNotaFiscal) return true;
  const idObjeto = num(rec.idObjeto);
  const tipo = String(rec.tipoObjeto ?? "").toLowerCase();
  if (idNotaFiscal && idObjeto === idNotaFiscal && tipo.includes("nota")) return true;
  if (idObjeto === pedidoId && (tipo.includes("pedido") || tipo === "v" || tipo.includes("venda"))) {
    return true;
  }
  return false;
}

async function main() {
  const { skipConcluir, numero, pedidoArg } = parseArgs(process.argv.slice(2));
  const { client, tenantId } = await getClient();
  const etapas: Etapa[] = [];
  let ordem = 0;

  let pedidoId: number | null = null;

  if (numero) {
    ordem++;
    const rota = "/pedidos";
    console.log(`[${ordem}] GET ${rota}?numero=${numero}`);
    const r = await call(client, "GET", rota, { query: { numero } });
    etapas.push({
      ordem,
      nome: "Resolver pedido pelo número de tela",
      metodo: "GET",
      rota: `${rota}?numero=${numero}`,
      http: r.http,
      ok: r.ok,
      resposta: r.resposta,
      erro: r.erro,
    });
    const itens = asArray(asRecord(r.resposta)?.itens);
    pedidoId = num(asRecord(itens[0])?.id);
    if (!pedidoId) {
      throw new Error(`Nenhum pedido com numero=${numero}`);
    }
  } else {
    if (!pedidoArg) {
      throw new Error(
        "Uso: tsx scripts/teste-fluxo-etiqueta-completo.ts TINY-861203611 | --numero 214617",
      );
    }
    pedidoId = parsePedidoId(pedidoArg);
  }

  const erpOrderId = `TINY-${pedidoId}`;
  console.log(`\nAlvo: ${erpOrderId} (id=${pedidoId})\n`);

  // 1) Pedido
  ordem++;
  {
    const rota = `/pedidos/${pedidoId}`;
    console.log(`[${ordem}] GET ${rota}`);
    const r = await call(client, "GET", rota);
    etapas.push({
      ordem,
      nome: "Obter pedido completo",
      metodo: "GET",
      rota,
      http: r.http,
      ok: r.ok,
      resposta: r.resposta,
      erro: r.erro,
    });
  }

  const pedido = asRecord(etapas[etapas.length - 1]?.resposta);
  const idNotaFiscalRaw = num(pedido?.idNotaFiscal);
  const idNotaFiscal = idNotaFiscalRaw && idNotaFiscalRaw > 0 ? idNotaFiscalRaw : null;
  const numeroPedido = num(pedido?.numeroPedido);

  // 2) Nota
  if (idNotaFiscal) {
    ordem++;
    const rota = `/notas/${idNotaFiscal}`;
    console.log(`[${ordem}] GET ${rota}`);
    const r = await call(client, "GET", rota);
    etapas.push({
      ordem,
      nome: "Obter nota fiscal",
      metodo: "GET",
      rota,
      http: r.http,
      ok: r.ok,
      resposta: r.resposta,
      erro: r.erro,
      observacao: `numero tela NF = ${asRecord(r.resposta)?.numero ?? "?"}`,
    });
  }

  // 3) Criar expedição
  ordem++;
  const createBody = { idsPedidos: [pedidoId] };
  console.log(`[${ordem}] POST /expedicao`, JSON.stringify(createBody));
  let create = await call(client, "POST", "/expedicao", { body: createBody });
  etapas.push({
    ordem,
    nome: "Criar agrupamento de expedição",
    metodo: "POST",
    rota: "/expedicao",
    requestBody: createBody,
    http: create.http,
    ok: create.ok,
    resposta: create.resposta,
    erro: create.erro,
  });

  if (!create.ok && idNotaFiscal) {
    ordem++;
    const altBody = { idsNotasFiscais: [idNotaFiscal] };
    console.log(`[${ordem}] POST /expedicao (fallback NF)`, JSON.stringify(altBody));
    create = await call(client, "POST", "/expedicao", { body: altBody });
    etapas.push({
      ordem,
      nome: "Criar agrupamento (fallback idsNotasFiscais)",
      metodo: "POST",
      rota: "/expedicao",
      requestBody: altBody,
      http: create.http,
      ok: create.ok,
      resposta: create.resposta,
      erro: create.erro,
    });
  }

  let idAgrupamento = num(asRecord(create.resposta)?.id);

  // Se create falhou (ex.: já agrupado), ainda tentamos achar via listagem recente
  if (!idAgrupamento) {
    console.log("  create sem id — tentando localizar em GET /expedicao (limit 50)…");
    ordem++;
    const lista = await call(client, "GET", "/expedicao", {
      query: { limit: 50, offset: 0, orderBy: "desc" },
    });
    etapas.push({
      ordem,
      nome: "Listar agrupamentos recentes (fallback se create falhou)",
      metodo: "GET",
      rota: "/expedicao?limit=50&orderBy=desc",
      http: lista.http,
      ok: lista.ok,
      resposta: lista.resposta,
      erro: lista.erro,
    });

    const itens = asArray(asRecord(lista.resposta)?.itens);
    for (const item of itens) {
      const idAgr = num(asRecord(item)?.id);
      if (!idAgr) continue;
      const det = await call(client, "GET", `/expedicao/${idAgr}`);
      const expedicoes = asArray(asRecord(det.resposta)?.expedicoes);
      const found = expedicoes.find((exp) =>
        pedidoNaExpedicao(pedidoId!, idNotaFiscal, exp),
      );
      if (found) {
        idAgrupamento = idAgr;
        console.log(`  encontrado no agrupamento ${idAgrupamento}`);
        break;
      }
    }
  }

  let idExpedicao: number | null = null;
  let urls: string[] = [];

  if (idAgrupamento) {
    // 4) Detalhe
    ordem++;
    const rotaDet = `/expedicao/${idAgrupamento}`;
    console.log(`[${ordem}] GET ${rotaDet}`);
    const det = await call(client, "GET", rotaDet);
    etapas.push({
      ordem,
      nome: "Obter detalhe do agrupamento",
      metodo: "GET",
      rota: rotaDet,
      http: det.http,
      ok: det.ok,
      resposta: det.resposta,
      erro: det.erro,
    });

    const expedicoes = asArray(asRecord(det.resposta)?.expedicoes);
    const match = expedicoes.find((exp) =>
      pedidoNaExpedicao(pedidoId!, idNotaFiscal, exp),
    );
    idExpedicao = num(asRecord(match)?.id);

    // 5) Etiquetas lote
    ordem++;
    const rotaLote = `/expedicao/${idAgrupamento}/etiquetas`;
    console.log(`[${ordem}] GET ${rotaLote}`);
    const etqLote = await call(client, "GET", rotaLote);
    etapas.push({
      ordem,
      nome: "Obter etiquetas do agrupamento (lote)",
      metodo: "GET",
      rota: rotaLote,
      http: etqLote.http,
      ok: etqLote.ok,
      resposta: etqLote.resposta,
      erro: etqLote.erro,
    });
    urls.push(
      ...asArray(asRecord(etqLote.resposta)?.urls).filter(
        (u): u is string => typeof u === "string" && u.length > 0,
      ),
    );

    // 6) Etiqueta individual
    if (idExpedicao) {
      ordem++;
      const rotaInd = `/expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`;
      console.log(`[${ordem}] GET ${rotaInd}`);
      const etqInd = await call(client, "GET", rotaInd);
      etapas.push({
        ordem,
        nome: "Obter etiqueta individual da expedição",
        metodo: "GET",
        rota: rotaInd,
        http: etqInd.http,
        ok: etqInd.ok,
        resposta: etqInd.resposta,
        erro: etqInd.erro,
      });
      urls.push(
        ...asArray(asRecord(etqInd.resposta)?.urls).filter(
          (u): u is string => typeof u === "string" && u.length > 0,
        ),
      );
    }

    // 7) Concluir
    if (!skipConcluir) {
      ordem++;
      const rotaConc = `/expedicao/${idAgrupamento}/concluir`;
      console.log(`[${ordem}] POST ${rotaConc}`);
      const conc = await call(client, "POST", rotaConc);
      etapas.push({
        ordem,
        nome: "Concluir agrupamento de expedição",
        metodo: "POST",
        rota: rotaConc,
        http: conc.http,
        ok: conc.ok,
        resposta: conc.resposta,
        erro: conc.erro,
        observacao:
          "Concluir fecha o lote no Tiny; etiqueta já pode existir antes deste passo.",
      });
    }
  } else {
    etapas.push({
      ordem: ++ordem,
      nome: "Abortado — sem idAgrupamento",
      metodo: "—",
      rota: "—",
      http: null,
      ok: false,
      resposta: null,
      erro: "Não foi possível criar nem localizar agrupamento. Veja etapas POST /expedicao.",
    });
  }

  urls = [...new Set(urls)];

  const out = {
    fetchedAt: new Date().toISOString(),
    tenantId,
    pedidoAlvo: {
      erpOrderId,
      idPedido: pedidoId,
      numeroPedido,
      idNotaFiscal,
      numeroNota: asRecord(
        etapas.find((e) => e.rota.startsWith("/notas/"))?.resposta,
      )?.numero ?? null,
    },
    resultado: {
      idAgrupamento,
      idExpedicao,
      urls,
      etiquetaObtida: urls.length > 0,
      etapasOk: etapas.filter((e) => e.ok).length,
      etapasTotal: etapas.length,
    },
    etapas,
  };

  mkdirSync(DOCS, { recursive: true });
  const path = resolve(DOCS, `tiny-fluxo-etiqueta-${pedidoId}-resultado.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nSalvo: ${path}`);
  console.log(
    `Resumo: agrupamento=${idAgrupamento ?? "—"} expedicao=${idExpedicao ?? "—"} urls=${urls.length}`,
  );

  await prisma.$disconnect();
  if (!urls.length) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
