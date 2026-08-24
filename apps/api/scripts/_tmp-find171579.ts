import { prisma } from '../src/lib/prisma.js';
import { getTinyApiClient } from '../src/services/tiny-api-v3-client.js';

const TARGET_NUM = '171579';
const TARGET_ID = 862886988;
const PED = 862886936;

const conn = await prisma.tinyConnection.findFirst({ where: { id: 'cmst909h50epkl0016ytukm52' } });
const client = await getTinyApiClient({ tenantId: conn!.tenantId, connectionId: conn!.id });

const found: any[] = [];
let offset = 0;
let scanned = 0;
const windows = [
  ['2026-08-14', '2026-08-14'],
  ['2026-08-12', '2026-08-17'],
  ['2026-08-01', '2026-08-17'],
];

for (const [dataInicial, dataFinal] of windows) {
  offset = 0;
  console.log('WINDOW', dataInicial, dataFinal);
  while (offset < 800) {
    const list = await client.request('GET', '/expedicao', {
      query: { limit: 50, offset, orderBy: 'desc', dataInicial, dataFinal, idFormaEnvio: 851418498 },
    }) as any;
    const itens = list?.itens ?? [];
    if (!itens.length) break;
    const seen = new Set<number>();
    for (const it of itens) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      scanned++;
      const d: any = await client.request('GET', '/expedicao/' + it.id);
      const blob = JSON.stringify(d);
      if (blob.includes(TARGET_NUM) || blob.includes(String(TARGET_ID)) || blob.includes(String(PED))) {
        const hits = (d.expedicoes ?? []).filter((e: any) =>
          String(e.notaFiscal?.numero) === TARGET_NUM ||
          e.notaFiscal?.id === TARGET_ID ||
          e.idObjeto === TARGET_ID ||
          e.venda?.id === PED
        );
        found.push({ idAgrupamento: it.id, identificacao: d.identificacao, data: d.data, hits });
        console.log('FOUND', JSON.stringify(found[found.length-1], null, 2));
      }
    }
    offset += 50;
    if (itens.length < 50) break;
    if (scanned % 50 === 0) console.log('scanned', scanned);
  }
  if (found.length) break;
}

// also without forma filter on Aug 14
if (!found.length) {
  console.log('RETRY all formas Aug 14');
  offset = 0;
  while (offset < 300) {
    const list = await client.request('GET', '/expedicao', {
      query: { limit: 50, offset, orderBy: 'desc', dataInicial: '2026-08-14', dataFinal: '2026-08-14' },
    }) as any;
    const itens = list?.itens ?? [];
    if (!itens.length) break;
    for (const it of itens) {
      scanned++;
      const d: any = await client.request('GET', '/expedicao/' + it.id);
      const blob = JSON.stringify(d);
      if (blob.includes(TARGET_NUM) || blob.includes(String(TARGET_ID))) {
        found.push({ idAgrupamento: it.id, identificacao: d.identificacao, forma: d.formaEnvio, hits: d.expedicoes });
        console.log('FOUND', it.id);
        break;
      }
    }
    if (found.length) break;
    offset += 50;
    if (itens.length < 50) break;
  }
}

console.log(JSON.stringify({ scanned, foundCount: found.length, found }, null, 2));

// confirm NF still blocked
try {
  await client.request('POST', '/expedicao', { body: { idsNotasFiscais: [TARGET_ID] } });
} catch (e: any) {
  console.log('CREATE_NF_ERR', e.message);
}

await prisma.$disconnect();
