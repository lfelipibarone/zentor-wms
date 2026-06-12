/**
 * Coleta até 4 itens no Tiny e salva o JSON completo de cada rota.
 *
 * Uso: pnpm teste-rotas
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient, TinyApiError, TinyApiV3Client } from "../src/services/tiny-api-v3-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIMITE = 4;
const OUTPUT = resolve(__dirname, "../../../docs/tiny-teste-rotas.json");

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function extractId(row: unknown): number | null {
  const id = Number(asRecord(row)?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
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
    throw new Error(
      "Tiny não conectado. Abra Integrações → Tiny no painel e reconecte OAuth.",
    );
  }

  console.log(`Tenant: ${conn.tenant.name} (${conn.tenant.slug})`);
  const client = await getTinyApiClient(conn.tenantId);
  return { client, tenantId: conn.tenantId };
}

async function getJson(
  client: TinyApiV3Client,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<unknown> {
  try {
    return await client.request("GET", path, { query });
  } catch (e) {
    const err = e instanceof TinyApiError ? e : null;
    return {
      erro: true,
      mensagem: e instanceof Error ? e.message : String(e),
      statusCode: err?.statusCode ?? null,
    };
  }
}

async function main() {
  const { client, tenantId } = await getClient();

  console.log(`Coletando até ${LIMITE} itens por rota…\n`);

  const formasEnvioLista = await getJson(client, "/formas-envio", {
    limit: LIMITE,
    offset: 0,
  });
  const formasEnvioItens = asArray(asRecord(formasEnvioLista)?.itens).slice(0, LIMITE);

  const formasEnvio = [];
  for (const item of formasEnvioItens) {
    const id = extractId(item);
    if (!id) continue;
    console.log(`  GET /formas-envio/${id}`);
    formasEnvio.push({
      id,
      listagem: item,
      detalhe: await getJson(client, `/formas-envio/${id}`),
    });
  }

  const expedicaoLista = await getJson(client, "/expedicao", {
    limit: LIMITE,
    offset: 0,
    orderBy: "desc",
  });
  const agrupamentoItens = asArray(asRecord(expedicaoLista)?.itens).slice(0, LIMITE);

  const agrupamentos = [];
  for (const item of agrupamentoItens) {
    const idAgrupamento = extractId(item);
    if (!idAgrupamento) continue;

    console.log(`  GET /expedicao/${idAgrupamento}`);
    const detalhe = await getJson(client, `/expedicao/${idAgrupamento}`);

    console.log(`  GET /expedicao/${idAgrupamento}/etiquetas`);
    const etiquetasAgrupamento = await getJson(
      client,
      `/expedicao/${idAgrupamento}/etiquetas`,
    );

    const expedicoes = [];
    for (const exp of asArray(asRecord(detalhe)?.expedicoes).slice(0, LIMITE)) {
      const idExpedicao = extractId(exp);
      if (!idExpedicao) continue;
      const path = `/expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`;
      console.log(`  GET ${path}`);
      expedicoes.push({
        id: idExpedicao,
        resumo: exp,
        etiquetas: await getJson(client, path),
      });
    }

    agrupamentos.push({
      id: idAgrupamento,
      listagem: item,
      detalhe,
      etiquetasAgrupamento,
      expedicoes,
    });
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    tenantId,
    limite: LIMITE,
    rotas: {
      "GET /formas-envio": formasEnvioLista,
      "GET /formas-envio/{idFormaEnvio}": formasEnvio,
      "GET /expedicao": expedicaoLista,
      "GET /expedicao/{idAgrupamento}": agrupamentos.map((a) => ({
        id: a.id,
        listagem: a.listagem,
        resposta: a.detalhe,
      })),
      "GET /expedicao/{idAgrupamento}/etiquetas": agrupamentos.map((a) => ({
        id: a.id,
        resposta: a.etiquetasAgrupamento,
      })),
      "GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas":
        agrupamentos.flatMap((a) =>
          a.expedicoes.map((e) => ({
            idAgrupamento: a.id,
            idExpedicao: e.id,
            resposta: e.etiquetas,
          })),
        ),
    },
    agrupamentos,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), "utf8");

  console.log(`\nSalvo: ${OUTPUT}`);
  console.log(
    `Formas de envio: ${formasEnvio.length} | Agrupamentos: ${agrupamentos.length}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
