/**
 * Teste de ponta a ponta das ondas montadas pelo mapa (banco LOCAL + API local).
 * Coloca 3 produtos temporários em gôndolas vazias do mapa, cria 5 pedidos, marca colunas/linhas,
 * gera uma onda temporária e uma de onda fixa pelas rotas HTTP e desfaz tudo no final.
 *
 *   pnpm --filter api teste-ondas-mapa
 */
import { LocationType } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { ordersMatchingSelection, type WaveMapCell, type WaveMapSelectionEntry } from "../src/services/wave-map.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3333";
const TAG = `wmapa${Date.now().toString(36)}`;
const ADMIN = { email: "adm@wms.local", password: "admin123" };

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

async function call<T = any>(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!data.token) throw new Error(`Login falhou: ${data.error}`);
  return data.token;
}

const sorted = (ids: string[]) => [...ids].sort();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "default" } });
  if (!tenant) throw new Error("Tenant default não encontrado");
  const tenantId = tenant.id;
  const plan = await prisma.warehouseFloorPlan.findFirst({ where: { tenantId } });
  if (!plan) throw new Error("Precisa de um mapa de barracão salvo no banco local");

  const created = {
    orderIds: [] as string[],
    templateIds: [] as string[],
    productIds: [] as string[],
    locationIds: [] as string[],
  };

  try {
    // ---------------------------------------------------------------- setup
    // gôndolas vazias do barracão do mapa: recebem um produto de teste e voltam a ficar vazias no fim
    const empty = await prisma.location.findMany({
      where: {
        tenantId,
        type: LocationType.PICK_FACE,
        active: true,
        productId: null,
        barracaoId: plan.barracaoId,
        colunaId: { not: null },
        linhaId: { not: null },
      },
      select: {
        id: true,
        estanteId: true,
        face: true,
        coluna: { select: { code: true } },
        linha: { select: { code: true } },
      },
    });
    const colKey = (f: (typeof empty)[number]) => `${f.estanteId}|${f.face}|${f.coluna!.code}`;
    const byColuna = new Map<string, typeof empty>();
    for (const f of empty) byColuna.set(colKey(f), [...(byColuna.get(colKey(f)) ?? []), f]);
    const colX = [...byColuna.values()].find((list) => new Set(list.map((l) => l.linha!.code)).size >= 2);
    if (!colX) throw new Error("Nenhuma coluna vazia com 2 linhas no banco local");
    const l1Loc = colX[0]!;
    const l2Loc = colX.find((l) => l.linha!.code !== l1Loc.linha!.code)!;
    const l3Loc = empty.find((f) => colKey(f) !== colKey(l1Loc));
    if (!l3Loc) throw new Error("Precisa de uma segunda coluna vazia");

    const [l1, l2, l3] = await Promise.all(
      [l1Loc, l2Loc, l3Loc].map(async (loc, i) => {
        const p = await prisma.product.create({
          data: { tenantId, sku: `${TAG}-SKU${i + 1}`, name: `Produto mapa ${i + 1}`, barcode: `${TAG}-EAN${i + 1}` },
        });
        created.productIds.push(p.id);
        await prisma.location.update({ where: { id: loc.id }, data: { productId: p.id, fillPercent: 50 } });
        created.locationIds.push(loc.id);
        return { ...loc, productId: p.id };
      }),
    );
    if (!l1 || !l2 || !l3) throw new Error("Falha no setup");

    const mkOrder = async (suffix: string, locs: Array<{ productId: string }>) => {
      const o = await prisma.order.create({
        data: {
          tenantId,
          erpOrderId: `${TAG}-${suffix}`,
          customerName: `Cliente ${suffix}`,
          marketplace: TAG,
          items: {
            create: locs.map((l, i) => ({ lineNumber: i + 1, productId: l.productId!, quantityOrdered: 1 })),
          },
        },
      });
      created.orderIds.push(o.id);
      return o.id;
    };
    const o1 = await mkOrder("O1", [l1]);
    const o2 = await mkOrder("O2", [l2]);
    const o3 = await mkOrder("O3", [l3]);
    const o4 = await mkOrder("O4", [l1, l3]);

    const colunaX = { estanteId: l1.estanteId!, face: l1.face, coluna: l1.coluna!.code };
    const colunaY = { estanteId: l3.estanteId!, face: l3.face, coluna: l3.coluna!.code };
    console.log(
      `Setup: coluna X ${colunaX.coluna} (linhas ${l1.linha!.code} e ${l2.linha!.code}), coluna Y ${colunaY.coluna}`,
    );

    const token = await login();

    // ---------------------------------------------------------------- mapa
    const map1 = await call(token, "GET", `/api/waves/map?marketplace=${TAG}&barracaoId=${plan.barracaoId}`);
    check("GET /api/waves/map responde 200 com o barracão", map1.status === 200 && map1.data.barracao?.id === plan.barracaoId, map1.data);
    check("mapa traz os 4 pedidos de teste", sorted(map1.data.orders.map((o: any) => o.id)).join() === sorted([o1, o2, o3, o4]).join());
    check("planta tem gôndolas e estantes", map1.data.plan.elements.length > 0 && map1.data.estantes.length > 0);
    const colunaInfo = map1.data.colunas.find(
      (c: any) => c.estanteId === colunaX.estanteId && c.face === colunaX.face && c.coluna === colunaX.coluna,
    );
    check("estrutura lista as linhas da coluna X", colunaInfo?.linhas.includes(l1.linha!.code) && colunaInfo?.linhas.includes(l2.linha!.code));

    const cells = map1.data.cells as WaveMapCell[];
    const whole = (c: typeof colunaX): WaveMapSelectionEntry => ({ ...c, linha: null });
    check("coluna X inteira → O1, O2, O4", sorted(ordersMatchingSelection(cells, [whole(colunaX)])).join() === sorted([o1, o2, o4]).join());
    check(
      "só a linha de O1 → O1, O4",
      sorted(ordersMatchingSelection(cells, [{ ...colunaX, linha: l1.linha!.code }])).join() === sorted([o1, o4]).join(),
    );
    check("coluna Y → O3, O4", sorted(ordersMatchingSelection(cells, [whole(colunaY)])).join() === sorted([o3, o4]).join());

    // ---------------------------------------------------------------- onda fixa
    const templateSelection = [{ ...colunaX, linha: l2.linha!.code }, whole(colunaY)];
    const tpl = await call(token, "POST", "/api/waves/templates", {
      barracaoId: plan.barracaoId,
      name: `Fixa ${TAG}`,
      color: "#2563eb",
      selection: templateSelection,
    });
    check("cria onda fixa", tpl.status === 200 && tpl.data.template?.id, tpl.data);
    const templateId = tpl.data.template?.id as string;
    if (templateId) created.templateIds.push(templateId);

    const bad = await call(token, "POST", "/api/waves/templates", {
      barracaoId: plan.barracaoId,
      name: "Inválida",
      selection: [{ estanteId: "nao-existe", face: "A", coluna: "1", linha: null }],
    });
    check("recusa onda fixa com estante de fora", bad.status === 400, bad.data);
    const noName = await call(token, "POST", "/api/waves/templates", {
      barracaoId: plan.barracaoId,
      name: " ",
      selection: templateSelection,
    });
    check("recusa onda fixa sem nome", noName.status === 400 && /nome/.test(noName.data.error ?? ""), noName.data);

    // ---------------------------------------------------------------- onda temporária
    const tempOrders = ordersMatchingSelection(cells, [{ ...colunaX, linha: l1.linha!.code }]);
    const temp = await call(token, "POST", "/api/waves/release", {
      orderIds: tempOrders,
      auto: false,
      partitionStrategy: "SINGLE_WAVE",
      marketplace: TAG,
    });
    check("cria onda temporária com O1 e O4", temp.status === 200 && temp.data.orderCount === 2, temp.data);
    const tempWave = temp.data.waveId
      ? await prisma.pickWave.findUnique({ where: { id: temp.data.waveId }, include: { orders: true } })
      : null;
    check("onda temporária sem onda fixa", tempWave?.templateId === null && tempWave?.orders.length === 2);

    const map2 = await call(token, "GET", `/api/waves/map?marketplace=${TAG}&barracaoId=${plan.barracaoId}`);
    check("O1 e O4 saem do mapa", sorted(map2.data.orders.map((o: any) => o.id)).join() === sorted([o2, o3]).join(), map2.data.orders);
    const tplInMap = map2.data.templates.find((t: any) => t.id === templateId);
    check("onda fixa aparece no mapa com a seleção", tplInMap?.selection.length === 2);

    // ---------------------------------------------------------------- gerar da onda fixa
    const fixedOrders = ordersMatchingSelection(map2.data.cells, tplInMap.selection);
    check("onda fixa pega O2 e O3 agora", sorted(fixedOrders).join() === sorted([o2, o3]).join(), fixedOrders);
    const fixed = await call(token, "POST", "/api/waves/release", {
      orderIds: fixedOrders,
      auto: false,
      partitionStrategy: "SINGLE_WAVE",
      marketplace: TAG,
      templateId,
    });
    check("gera onda da onda fixa", fixed.status === 200 && fixed.data.orderCount === 2, fixed.data);
    const list = await call(token, "GET", "/api/waves");
    const fixedRow = list.data.waves.find((w: any) => w.id === fixed.data.waveId);
    check(
      "lista de ondas mostra o nome e a onda fixa de origem",
      fixedRow?.name.startsWith(`Fixa ${TAG}`) && fixedRow?.template?.id === templateId,
      fixedRow,
    );

    const map3 = await call(token, "GET", `/api/waves/map?marketplace=${TAG}&barracaoId=${plan.barracaoId}`);
    check("sem pedidos de teste pendentes no mapa", map3.data.orders.length === 0, map3.data.orders);

    // ---------------------------------------------------------------- desativar / excluir
    const off = await call(token, "PUT", `/api/waves/templates/${templateId}`, { active: false });
    check("desativa a onda fixa", off.status === 200 && off.data.template.active === false);
    const o5 = await mkOrder("O5", [l3]);
    const blocked = await call(token, "POST", "/api/waves/release", {
      orderIds: [o5],
      auto: false,
      partitionStrategy: "SINGLE_WAVE",
      marketplace: TAG,
      templateId,
    });
    check("onda fixa desativada não gera onda", blocked.status === 400 && /desativada/.test(blocked.data.error ?? ""), blocked.data);

    const del = await call(token, "DELETE", `/api/waves/templates/${templateId}`);
    check("exclui a onda fixa", del.status === 200);
    if (del.status === 200) created.templateIds = [];
    const afterDel = await prisma.pickWave.findUnique({ where: { id: fixed.data.waveId } });
    check("onda já gerada continua, sem vínculo", afterDel !== null && afterDel.templateId === null);

    const other = await call(token, "DELETE", `/api/waves/templates/${templateId}`);
    check("excluir de novo dá 404", other.status === 404);
  } finally {
    await cleanup(created);
  }

  console.log(failures === 0 ? "\nTudo certo." : `\n${failures} verificação(ões) falharam.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function cleanup(c: { orderIds: string[]; templateIds: string[]; productIds: string[]; locationIds: string[] }) {
  const waveOrders = await prisma.pickWaveOrder.findMany({
    where: { orderId: { in: c.orderIds } },
    select: { waveId: true },
  });
  const waveIds = [...new Set(waveOrders.map((w) => w.waveId))];
  await prisma.pickWaveAllocation.deleteMany({ where: { waveLine: { waveId: { in: waveIds } } } });
  await prisma.pickWaveLine.deleteMany({ where: { waveId: { in: waveIds } } });
  await prisma.pickWavePart.deleteMany({ where: { waveId: { in: waveIds } } });
  await prisma.pickWaveOrder.deleteMany({ where: { waveId: { in: waveIds } } });
  await prisma.pickWave.deleteMany({ where: { id: { in: waveIds } } });
  await prisma.orderTimeLog.deleteMany({ where: { orderId: { in: c.orderIds } } });
  await prisma.orderStageLog.deleteMany({ where: { orderId: { in: c.orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: c.orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: c.orderIds } } });
  await prisma.pickWaveTemplate.deleteMany({ where: { id: { in: c.templateIds } } });
  await prisma.location.updateMany({ where: { id: { in: c.locationIds } }, data: { productId: null, fillPercent: 0 } });
  await prisma.product.deleteMany({ where: { id: { in: c.productIds } } });
  const left =
    (await prisma.order.count({ where: { erpOrderId: { startsWith: TAG } } })) +
    (await prisma.product.count({ where: { sku: { startsWith: TAG } } })) +
    (await prisma.location.count({ where: { id: { in: c.locationIds }, productId: { not: null } } }));
  console.log(
    `Limpeza: ${waveIds.length} onda(s), ${c.orderIds.length} pedido(s), ${c.productIds.length} produto(s) apagados; ` +
      `${c.locationIds.length} gôndola(s) voltaram a ficar vazias; sobrou ${left}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
