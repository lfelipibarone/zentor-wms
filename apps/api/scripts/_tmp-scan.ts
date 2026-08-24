import { prisma } from '../src/lib/prisma.js';
import { getTinyApiClient } from '../src/services/tiny-api-v3-client.js';

const conn = await prisma.tinyConnection.findFirst({
  where: { id: 'cmst909h50epkl0016ytukm52' },
});
const client = await getTinyApiClient({ tenantId: conn!.tenantId, connectionId: conn!.id });

// Scan recent expeditions looking for NF 862886988 or pedido 862886936
const targets = new Set(['862886988', '862886936', '171579', '238392', '40A0133E85']);
const found: any[] = [];
let offset = 0;
const limit = 100;
let scanned = 0;
const maxScan = 500;

while (scanned < maxScan) {
  const list = await client.request('GET', '/expedicao', { query: { limit, offset } }) as any;
  const items = Array.isArray(list) ? list : (list?.itens ?? list?.data ?? []);
  if (!items.length) break;
  for (const item of items) {
    scanned++;
    const id = item.id ?? item.idAgrupamento;
    let detail = item;
    try {
      detail = await client.request('GET', '/expedicao/' + id);
    } catch {}
    const blob = JSON.stringify(detail);
    const hit = [...targets].some((t) => blob.includes(t));
    if (hit) {
      found.push({ id, situacao: (detail as any).situacao, expedicoesLen: ((detail as any).expedicoes ?? []).length, sample: detail });
    }
  }
  if (items.length < limit) break;
  offset += limit;
  console.log('scanned', scanned, 'found', found.length);
}

console.log(JSON.stringify({ scanned, foundCount: found.length, found: found.map(f => ({
  id: f.id, situacao: f.situacao, expedicoesLen: f.expedicoesLen,
  expedicoes: (f.sample?.expedicoes ?? []).slice(0, 3),
})) }, null, 2));

await prisma.$disconnect();
