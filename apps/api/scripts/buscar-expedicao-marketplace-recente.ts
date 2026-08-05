import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient } from "../src/services/tiny-api-v3-client.js";
import { asArray, asRecord, num, str, tinyGet } from "./lib/tiny-expedicao-search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../../../docs/postman/expedicoes-recentes-marketplace.json");

const ALVOS = [
  { chave: "mercado", match: (n: string) => /mercado/i.test(n) },
  { chave: "shopee", match: (n: string) => /shopee/i.test(n) },
];

const conn = await prisma.tinyConnection.findFirst({
  where: { status: TinyConnectionStatus.CONNECTED, accessToken: { not: null } },
  select: { id: true, tenantId: true },
});
const client = await getTinyApiClient({
  tenantId: conn!.tenantId,
  connectionId: conn!.id,
});

const encontrados: Record<string, unknown> = {};
const vistos = new Set<number>();
let offset = 0;

while (Object.keys(encontrados).length < ALVOS.length && offset < 3000) {
  const wrap = await tinyGet(client, "/expedicao", {
    limit: 100,
    offset,
    orderBy: "desc",
  });
  if (!wrap.ok) break;
  const itens = asArray(asRecord(wrap.resposta)?.itens);
  if (!itens.length) break;

  for (const item of itens) {
    const rec = asRecord(item);
    const idAgrupamento = num(rec?.id);
    const formaNome = str(asRecord(rec?.formaEnvio)?.nome) ?? "";
    if (!idAgrupamento || vistos.has(idAgrupamento)) continue;
    vistos.add(idAgrupamento);

    const alvo = ALVOS.find((a) => !encontrados[a.chave] && a.match(formaNome));
    if (!alvo) continue;

    const det = await tinyGet(client, `/expedicao/${idAgrupamento}`);
    if (!det.ok) continue;
    const detalhe = asRecord(det.resposta);
    const exp = asRecord(asArray(detalhe?.expedicoes)[0]);
    const idExpedicao = num(exp?.id);
    if (!idExpedicao) continue;

    const et = await tinyGet(
      client,
      `/expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`,
    );
    const etBody = asRecord(et.ok ? et.resposta : et.resposta);
    const urls = asArray(etBody?.urls).map((u) => str(u)).filter(Boolean);

    encontrados[alvo.chave] = {
      formaEnvioNome: formaNome,
      idAgrupamento,
      identificacao: str(rec?.identificacao),
      dataAgrupamento: str(rec?.data),
      idExpedicao,
      pedidoId: num(asRecord(exp?.venda)?.id),
      idNotaFiscal: num(asRecord(exp?.notaFiscal)?.id),
      etiquetas: {
        ok: urls.length > 0,
        urls,
        erro: urls.length ? null : str(etBody?.mensagem),
      },
    };
  }

  offset += 100;
  const total = num(asRecord(wrap.resposta)?.paginacao)?.total ?? 0;
  if (offset >= total) break;
}

const minDate = "2026-06-30";
const dentroJanela = Object.fromEntries(
  Object.entries(encontrados).filter(([, v]) => {
    const d = str(asRecord(v)?.dataAgrupamento) ?? "";
    return d >= minDate;
  }),
);

const payload = {
  geradoEm: new Date().toISOString(),
  aviso:
    "Hoje/ontem (30/06–01/07) só há Amazon DBA na expedição. ML/Shopee recentes estão como pedidos mas ainda FORA do agrupamento.",
  janelaHojeOntem: dentroJanela,
  maisRecenteDisponivel: encontrados,
  pedidosParaAgrupar: {
    mercado: [860587506, 860587271, 860587014],
    shopee: [860586945, 860586560, 860585537],
  },
  postmanVars: {
    mercadoMaisRecente: encontrados.mercado
      ? {
          pedidoMercado: String(asRecord(encontrados.mercado)?.pedidoId ?? ""),
          idNotaMercado: String(asRecord(encontrados.mercado)?.idNotaFiscal ?? ""),
          idAgrupamentoMercado: String(asRecord(encontrados.mercado)?.idAgrupamento ?? ""),
          idExpedicaoMercado: String(asRecord(encontrados.mercado)?.idExpedicao ?? ""),
          data: asRecord(encontrados.mercado)?.dataAgrupamento,
        }
      : null,
    shopeeMaisRecente: encontrados.shopee
      ? {
          pedidoShopee: String(asRecord(encontrados.shopee)?.pedidoId ?? ""),
          idNotaShopee: String(asRecord(encontrados.shopee)?.idNotaFiscal ?? ""),
          idAgrupamentoShopee: String(asRecord(encontrados.shopee)?.idAgrupamento ?? ""),
          idExpedicaoShopee: String(asRecord(encontrados.shopee)?.idExpedicao ?? ""),
          data: asRecord(encontrados.shopee)?.dataAgrupamento,
        }
      : null,
  },
};

writeFileSync(OUT, JSON.stringify(payload, null, 2));

for (const [k, v] of Object.entries(encontrados)) {
  const r = asRecord(v)!;
  console.log(`${k}: agr=${r.idAgrupamento} pedido=${r.pedidoId} data=${r.dataAgrupamento} etiqueta=${asRecord(r.etiquetas)?.ok ? "OK" : "erro"}`);
}
console.log(`\nSalvo: ${OUT}`);

await prisma.$disconnect();
