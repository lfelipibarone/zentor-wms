import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient } from "../src/services/tiny-api-v3-client.js";
import {
  buildPedidoExpedicaoIndex,
  findPedidoNoIndice,
} from "../src/services/tiny-expedicao-labels.js";

const PEDIDOS = [
  860301754, 860464286, 860464223, 860464194, 860463967, 860463935,
  860371275, 860374180, 860386179, 860347555, 860387758,
  860477599, 860477389, 860477304, 860476961, 860476886, 860385662,
];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
  console.log("Montando índice expedição…");
  const index = await buildPedidoExpedicaoIndex(client, { maxAgrupamentos: 300 });
  console.log(`Índice: ${index.size} chaves\n`);

  for (const pedidoId of PEDIDOS) {
    let idNotaFiscal: number | null = null;
    let formaEnvioNome: string | null = null;
    try {
      const ped = asRecord(await client.getPedido(pedidoId));
      idNotaFiscal = num(ped?.idNotaFiscal);
      formaEnvioNome = String(
        asRecord(asRecord(ped?.transportador)?.formaEnvio)?.nome ?? "",
      ) || null;
    } catch (e) {
      console.log(
        JSON.stringify({
          pedidoId,
          erro: e instanceof Error ? e.message : String(e),
        }),
      );
      continue;
    }

    const match = findPedidoNoIndice(index, pedidoId, idNotaFiscal);
    console.log(
      JSON.stringify({
        pedidoId,
        formaEnvioNome,
        idNotaFiscal,
        naExpedicao: Boolean(match),
        idAgrupamento: match?.idAgrupamento ?? null,
        idExpedicao: match?.idExpedicao ?? null,
      }),
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
