import { prisma } from '../src/lib/prisma.js';
import { getTinyApiClient } from '../src/services/tiny-api-v3-client.js';
import { TinyApiError } from '../src/services/tiny-api-v3-client.js';

const conn = await prisma.tinyConnection.findFirst({ where: { id: 'cmst909h50epkl0016ytukm52' } });
const client = await getTinyApiClient({ tenantId: conn!.tenantId, connectionId: conn!.id });

function errInfo(e: any) {
  if (e instanceof TinyApiError) return { msg: e.message, status: e.statusCode, body: (e as any).body ?? (e as any).responseBody ?? null };
  return { msg: String(e?.message ?? e) };
}

const FORMA_JADLOG = 851418498;
const windows = [
  ['2026-08-14', '2026-08-17'],
  ['2026-08-10', '2026-08-14'],
  ['2026-08-01', '2026-08-10'],
  ['2026-07-20', '2026-08-01'],
];

async function tryLabelFlow(p: any) {
  const idNota = Number(p.idNotaFiscal);
  const meta = {
    pedidoId: p.id, numero: p.numeroPedido,
    ecommerce: p.ecommerce?.numeroPedidoEcommerce,
    forma: p.transportador?.formaEnvio?.nome,
    frete: p.transportador?.formaFrete?.nome, idNota,
  };
  console.log('TRY', JSON.stringify(meta));

  // Prefer NF; fallback pedido
  let agrId: number | null = null;
  let createPath = '';
  for (const [path, body] of [
    ['idsNotasFiscais', { idsNotasFiscais: [idNota] }],
    ['idsPedidos', { idsPedidos: [p.id] }],
  ] as const) {
    try {
      const created: any = await client.request('POST', '/expedicao', { body });
      agrId = Number(created.id);
      createPath = path;
      console.log('CREATE_OK', path, agrId);
      break;
    } catch (e: any) {
      console.log('CREATE_FAIL', path, JSON.stringify(errInfo(e)).slice(0, 300));
    }
  }
  if (!agrId) return false;

  const detail: any = await client.request('GET', '/expedicao/' + agrId);
  const exps = detail.expedicoes ?? [];
  console.log('DETAIL', { agrId, createPath, expLen: exps.length, situacao: detail.situacao });
  if (!exps.length) {
    // try add origens
    for (const body of [{ idsNotasFiscais: [idNota] }, { idsPedidos: [p.id] }]) {
      try {
        await client.request('POST', '/expedicao/' + agrId + '/origens', { body });
        console.log('ORIGENS_OK', body);
      } catch (e: any) {
        console.log('ORIGENS_FAIL', JSON.stringify(errInfo(e)).slice(0, 250));
      }
    }
    const detail2: any = await client.request('GET', '/expedicao/' + agrId);
    console.log('DETAIL2 expLen', (detail2.expedicoes ?? []).length);
    if (!(detail2.expedicoes ?? []).length) return false;
    detail.expedicoes = detail2.expedicoes;
  }

  try {
    const before = await client.request('GET', '/expedicao/' + agrId + '/etiquetas');
    console.log('ETIQ_BEFORE', JSON.stringify(before));
    if ((before as any)?.urls?.length) {
      console.log('SUCCESS_URLS', (before as any).urls);
      return true;
    }
  } catch (e: any) {
    console.log('ETIQ_BEFORE_FAIL', JSON.stringify(errInfo(e)).slice(0, 250));
  }

  try {
    const c = await client.request('POST', '/expedicao/' + agrId + '/concluir');
    console.log('CONCLUIR', JSON.stringify(c));
  } catch (e: any) {
    console.log('CONCLUIR_FAIL', JSON.stringify(errInfo(e)).slice(0, 250));
  }

  try {
    const after = await client.request('GET', '/expedicao/' + agrId + '/etiquetas');
    console.log('ETIQ_AFTER', JSON.stringify(after, null, 2));
    if ((after as any)?.urls?.length) {
      console.log('SUCCESS_URLS', (after as any).urls);
      return true;
    }
  } catch (e: any) {
    console.log('ETIQ_AFTER_FAIL', JSON.stringify(errInfo(e)).slice(0, 300));
  }

  const idExp = detail.expedicoes?.[0]?.id;
  if (idExp) {
    try {
      const ind = await client.request('GET', '/expedicao/' + agrId + '/expedicao/' + idExp + '/etiquetas');
      console.log('ETIQ_IND', JSON.stringify(ind, null, 2));
      if ((ind as any)?.urls?.length) {
        console.log('SUCCESS_URLS', (ind as any).urls);
        return true;
      }
    } catch (e: any) {
      console.log('ETIQ_IND_FAIL', JSON.stringify(errInfo(e)).slice(0, 300));
    }
  }
  return false;
}

let success = false;
const seen = new Set<number>();
for (const [dataInicial, dataFinal] of windows) {
  if (success) break;
  console.log('WINDOW', dataInicial, dataFinal);
  let offset = 0;
  for (let page = 0; page < 4 && !success; page++) {
    const list = await client.request('GET', '/pedidos', {
      query: { limit: 50, offset, orderBy: 'desc', dataInicial, dataFinal },
    }) as any;
    const itens = Array.isArray(list) ? list : (list?.itens ?? list?.data ?? []);
    if (!itens.length) break;
    for (const item of itens) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      let p: any;
      try { p = await client.request('GET', '/pedidos/' + item.id); } catch { continue; }
      const formaId = Number(p.transportador?.formaEnvio?.id);
      const formaNome = String(p.transportador?.formaEnvio?.nome ?? '');
      const idNota = Number(p.idNotaFiscal);
      if (!(idNota > 0)) continue;
      const isMe =
        formaId === FORMA_JADLOG ||
        /melhor|jadlog/i.test(formaNome);
      if (!isMe) continue;
      if (await tryLabelFlow(p)) { success = true; break; }
    }
    offset += 50;
    if (itens.length < 50) break;
  }
}

console.log(success ? 'DONE_SUCCESS' : 'DONE_NO_LABEL');
// sample that previously worked
try {
  const etiq = await client.request('GET', '/expedicao/746537716/etiquetas');
  console.log('SAMPLE', JSON.stringify(etiq));
} catch (e: any) {
  console.log('SAMPLE_FAIL', JSON.stringify(errInfo(e)));
}
await prisma.$disconnect();
