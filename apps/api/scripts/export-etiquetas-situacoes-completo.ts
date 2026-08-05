/**
 * Exporta JSON completo (todas as rotas) dos 10 pedidos do teste por situação.
 * Um arquivo por pedido + índice.
 *
 * Uso:
 *   pnpm export-etiquetas-situacoes-completo
 *   pnpm export-etiquetas-situacoes-completo --fonte docs/tiny-etiquetas-situacoes.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient, type TinyApiV3Client } from "../src/services/tiny-api-v3-client.js";
import {
  buildPedidoExpedicaoIndex,
  findPedidoNoIndice,
  obterAgrupamentoExpedicao,
  obterEtiquetasAgrupamento,
  obterEtiquetasExpedicao,
} from "../src/services/tiny-expedicao-labels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, "../../../docs");
const OUT_DIR = resolve(DOCS, "tiny-etiquetas-situacoes-completo");
const FONTE_PADRAO = resolve(DOCS, "tiny-etiquetas-situacoes.json");

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

function extractUrls(resposta: unknown): string[] {
  const body = asRecord(resposta);
  if (!body || body.erro) return [];
  const urls = body.urls;
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => str(u)).filter((u): u is string => Boolean(u));
}

async function safeRoute(
  rota: string,
  params: Record<string, unknown>,
  fn: () => Promise<unknown>,
) {
  try {
    const resposta = await fn();
    return {
      rota,
      params,
      ok: !asRecord(resposta)?.erro,
      urls: extractUrls(resposta),
      resposta,
    };
  } catch (e) {
    const resposta = {
      erro: true,
      mensagem: e instanceof Error ? e.message : String(e),
    };
    return { rota, params, ok: false, urls: [], resposta };
  }
}

function parseFonte(argv: string[]): string {
  const i = argv.indexOf("--fonte");
  if (i >= 0 && argv[i + 1]) return resolve(process.cwd(), argv[i + 1]);
  return FONTE_PADRAO;
}

function loadPedidoIds(fonte: string): number[] {
  if (!existsSync(fonte)) {
    throw new Error(`Arquivo não encontrado: ${fonte}`);
  }
  const data = JSON.parse(readFileSync(fonte, "utf8")) as {
    resultados?: { pedidoId: number }[];
  };
  const ids = (data.resultados ?? []).map((r) => r.pedidoId);
  if (!ids.length) throw new Error("Nenhum pedido em resultados[]");
  return [...new Set(ids)].sort((a, b) => a - b);
}

async function exportarPedido(
  client: TinyApiV3Client,
  pedidoId: number,
  index: Awaited<ReturnType<typeof buildPedidoExpedicaoIndex>>,
  resumoAnterior: unknown,
) {
  const erpOrderId = `TINY-${pedidoId}`;

  const pedido = await safeRoute(
    `GET /pedidos/${pedidoId}`,
    { idPedido: pedidoId },
    () => client.getPedido(pedidoId),
  );

  const ped = asRecord(pedido.resposta);
  const situacao = Number(ped?.situacao);
  const idNotaFiscal = num(ped?.idNotaFiscal);
  const formaEnvioNome = str(asRecord(asRecord(ped?.transportador)?.formaEnvio)?.nome);
  const idFormaEnvio = num(asRecord(asRecord(ped?.transportador)?.formaEnvio)?.id);

  const pedidoMarcadores = await safeRoute(
    `GET /pedidos/${pedidoId}/marcadores`,
    { idPedido: pedidoId },
    () => client.request("GET", `/pedidos/${pedidoId}/marcadores`),
  );

  const nota: Record<string, unknown> = {
    idNotaFiscal,
    rotas: {},
  };

  if (idNotaFiscal) {
    nota.rotas = {
      [`GET /notas/${idNotaFiscal}`]: await safeRoute(
        `GET /notas/${idNotaFiscal}`,
        { idNota: idNotaFiscal },
        () => client.request("GET", `/notas/${idNotaFiscal}`),
      ),
      [`GET /notas/${idNotaFiscal}/link`]: await safeRoute(
        `GET /notas/${idNotaFiscal}/link`,
        { idNota: idNotaFiscal },
        () => client.request("GET", `/notas/${idNotaFiscal}/link`),
      ),
      [`GET /notas/${idNotaFiscal}/marcadores`]: await safeRoute(
        `GET /notas/${idNotaFiscal}/marcadores`,
        { idNota: idNotaFiscal },
        () => client.request("GET", `/notas/${idNotaFiscal}/marcadores`),
      ),
    };
  }

  const formaEnvio =
    idFormaEnvio != null
      ? {
          idFormaEnvio,
          rotas: {
            [`GET /formas-envio/${idFormaEnvio}`]: await safeRoute(
              `GET /formas-envio/${idFormaEnvio}`,
              { idFormaEnvio },
              () => client.request("GET", `/formas-envio/${idFormaEnvio}`),
            ),
          },
        }
      : null;

  const match = findPedidoNoIndice(index, pedidoId, idNotaFiscal);
  const expedicao: Record<string, unknown> = {
    encontrada: Boolean(match),
    match: match ?? null,
    rotas: {},
  };

  const etiquetas: Record<string, unknown> = {
    urls: [] as string[],
    rotas: {},
  };

  if (match) {
    const { idAgrupamento, idExpedicao } = match;
    expedicao.rotas = {
      [`GET /expedicao/${idAgrupamento}`]: await safeRoute(
        `GET /expedicao/${idAgrupamento}`,
        { idAgrupamento },
        () => obterAgrupamentoExpedicao(client, idAgrupamento),
      ),
    };

    const etAgr = await safeRoute(
      `GET /expedicao/${idAgrupamento}/etiquetas`,
      { idAgrupamento },
      () => obterEtiquetasAgrupamento(client, idAgrupamento),
    );
    const etInd = await safeRoute(
      `GET /expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`,
      { idAgrupamento, idExpedicao },
      () => obterEtiquetasExpedicao(client, idAgrupamento, idExpedicao),
    );

    etiquetas.rotas = {
      [`GET /expedicao/${idAgrupamento}/etiquetas`]: etAgr,
      [`GET /expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`]: etInd,
    };
    const urls = new Set<string>([...etAgr.urls, ...etInd.urls]);
    etiquetas.urls = [...urls];
  }

  const diagnostico =
    (etiquetas.urls as string[]).length > 0
      ? "ETIQUETA_OK"
      : !match
        ? "FORA_EXPEDICAO"
        : asRecord(
            asRecord(etiquetas.rotas)?.[
              Object.keys(etiquetas.rotas)[0] ?? ""
            ],
          )?.ok === false
          ? "ERRO_MARKETPLACE"
          : "SEM_URL";

  return {
    meta: {
      fetchedAt: new Date().toISOString(),
      pedidoId,
      erpOrderId,
      numeroPedido: ped?.numeroPedido ?? null,
      situacao,
      situacaoLabel: SITUACAO_PEDIDO[situacao] ?? `situacao ${situacao}`,
      formaEnvioNome,
      diagnostico,
      resumoTesteAnterior: resumoAnterior,
    },
    pedido: {
      rotas: {
        [`GET /pedidos/${pedidoId}`]: pedido,
        [`GET /pedidos/${pedidoId}/marcadores`]: pedidoMarcadores,
      },
    },
    nota,
    formaEnvio,
    expedicao,
    etiquetas,
  };
}

async function main() {
  const fonte = parseFonte(process.argv.slice(2));
  const pedidoIds = loadPedidoIds(fonte);
  const fonteData = JSON.parse(readFileSync(fonte, "utf8")) as {
    resultados?: unknown[];
    fetchedAt?: string;
    tenant?: string;
  };
  const resumoPorId = new Map<number, unknown>();
  for (const r of fonteData.resultados ?? []) {
    const rec = asRecord(r);
    const id = num(rec?.pedidoId);
    if (id) resumoPorId.set(id, r);
  }

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
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Exportando ${pedidoIds.length} pedidos → ${OUT_DIR}\n`);
  console.log("Montando índice expedição…");
  const index = await buildPedidoExpedicaoIndex(client, { maxAgrupamentos: 200 });

  const indice: unknown[] = [];

  for (const pedidoId of pedidoIds) {
    process.stdout.write(`  TINY-${pedidoId}…`);
    const payload = await exportarPedido(
      client,
      pedidoId,
      index,
      resumoPorId.get(pedidoId) ?? null,
    );
    const arquivo = `TINY-${pedidoId}.json`;
    const caminho = resolve(OUT_DIR, arquivo);
    writeFileSync(caminho, JSON.stringify(payload, null, 2));
    console.log(` ${payload.meta.diagnostico}`);

    indice.push({
      pedidoId,
      erpOrderId: `TINY-${pedidoId}`,
      arquivo,
      caminhoRelativo: `docs/tiny-etiquetas-situacoes-completo/${arquivo}`,
      situacao: payload.meta.situacao,
      situacaoLabel: payload.meta.situacaoLabel,
      formaEnvioNome: payload.meta.formaEnvioNome,
      diagnostico: payload.meta.diagnostico,
      naExpedicao: asRecord(payload.expedicao)?.encontrada === true,
      urlsEtiqueta: payload.etiquetas.urls,
      idNotaFiscal: asRecord(payload.nota)?.idNotaFiscal ?? null,
      expedicao: asRecord(payload.expedicao)?.match ?? null,
    });
  }

  const manifest = {
    fetchedAt: new Date().toISOString(),
    tenant: conn.tenant.name,
    fonte,
    fonteTesteAnterior: fonteData.fetchedAt ?? null,
    total: pedidoIds.length,
    estruturaPorArquivo: {
      meta: "resumo do pedido + diagnóstico",
      pedido: "GET /pedidos/{id} e /marcadores — resposta literal",
      nota: "GET /notas/{id}, /link, /marcadores — resposta literal (se houver NF)",
      formaEnvio: "GET /formas-envio/{id} — resposta literal",
      expedicao: "match no índice + GET /expedicao/{idAgrupamento}",
      etiquetas:
        "GET /expedicao/{idAgrupamento}/etiquetas e /expedicao/{idExp}/etiquetas — resposta literal",
    },
    pedidos: indice,
  };

  writeFileSync(resolve(OUT_DIR, "index.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(
    resolve(OUT_DIR, "_LEIA-ME.json"),
    JSON.stringify(
      {
        descricao:
          "Um arquivo JSON por pedido do teste tiny-etiquetas-situacoes. Abra index.json para a lista ou abra TINY-{id}.json diretamente.",
        secoes: [
          "meta — identificação e diagnóstico",
          "pedido.rotas — API pedido",
          "nota.rotas — API nota fiscal (DANFE/link)",
          "formaEnvio.rotas — forma de envio do pedido",
          "expedicao.rotas — detalhe do agrupamento",
          "etiquetas.rotas — tentativas de etiqueta de transporte",
        ],
        arquivos: indice.map((i) => asRecord(i)?.arquivo),
      },
      null,
      2,
    ),
  );

  console.log(`\nÍndice: ${resolve(OUT_DIR, "index.json")}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
