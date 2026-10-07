/**
 * Teste de ponta a ponta da divisão de tarefas entre agentes (banco LOCAL + API local).
 * Cria 2 usuários, produtos, uma onda, uma NF e um pulmão temporários, exercita o fluxo
 * pelas rotas HTTP e apaga tudo no final.
 *
 *   pnpm --filter api teste-divisao
 */
import { LocationType, PickWaveStatus, PurchaseReceiptSessionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3333";
const TAG = `wsdiv${Date.now().toString(36)}`;
const PASSWORD = "teste123";
const ADMIN = { email: "adm@wms.local", password: "admin123" };

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

async function call<T = any>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
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

async function login(email: string, password: string, mobile = true) {
  const res = await fetch(`${API}${mobile ? "/auth/mobile/login" : "/auth/login"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!data.token) throw new Error(`Login falhou para ${email}: ${data.error}`);
  return data.token;
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "default" } });
  if (!tenant) throw new Error("Tenant default não encontrado");
  const tenantId = tenant.id;
  const created = {
    userIds: [] as string[],
    productIds: [] as string[],
    waveId: null as string | null,
    orderId: null as string | null,
    receiptId: null as string | null,
    pulmaoId: null as string | null,
  };

  try {
    // ---------------------------------------------------------------- setup
    const [ana, bruno] = await Promise.all(
      ["Ana", "Bruno"].map((name) =>
        prisma.user.create({
          data: {
            email: `${TAG}.${name.toLowerCase()}@teste.local`,
            name: `${name} Teste ${TAG}`,
            password: hashPassword(PASSWORD),
            role: "PICKER",
            tenantId,
          },
        }),
      ),
    );
    created.userIds.push(ana!.id, bruno!.id);

    const products = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        prisma.product.create({
          data: {
            tenantId,
            sku: `${TAG}-SKU${i}`,
            name: `Produto teste ${i}`,
            barcode: `${TAG}-EAN${i}`,
          },
        }),
      ),
    );
    created.productIds.push(...products.map((p) => p.id));

    const locations = await prisma.location.findMany({
      where: { tenantId, type: LocationType.PICK_FACE, active: true },
      orderBy: { barcode: "asc" },
      take: 4,
    });
    if (locations.length < 4) throw new Error("Precisa de 4 gôndolas no banco local");

    const order = await prisma.order.create({
      data: {
        tenantId,
        erpOrderId: `${TAG}-PED`,
        customerName: "Cliente teste",
        items: {
          create: products.map((p, i) => ({ lineNumber: i + 1, productId: p.id, quantityOrdered: i + 1 })),
        },
      },
      include: { items: true },
    });
    created.orderId = order.id;

    const wave = await prisma.pickWave.create({
      data: {
        tenantId,
        name: `Onda ${TAG}`,
        status: PickWaveStatus.RELEASED,
        releasedAt: new Date(),
      },
    });
    created.waveId = wave.id;
    for (const [i, p] of products.entries()) {
      const item = order.items.find((it) => it.productId === p.id)!;
      await prisma.pickWaveLine.create({
        data: {
          waveId: wave.id,
          productId: p.id,
          pickLocationId: locations[i]!.id,
          quantityTotal: item.quantityOrdered,
          allocations: { create: { orderItemId: item.id, quantity: item.quantityOrdered } },
        },
      });
    }

    const receipt = await prisma.purchaseReceiptSession.create({
      data: {
        tenantId,
        invoiceNumber: `${TAG}`,
        supplierName: "Fornecedor teste",
        status: PurchaseReceiptSessionStatus.IN_CHECK,
        startedById: ana!.id,
        items: {
          create: products.map((p, i) => ({
            lineNumber: i + 1,
            productCode: p.sku,
            description: p.name,
            barcode: p.barcode,
            quantityExpected: 2,
          })),
        },
      },
    });
    created.receiptId = receipt.id;

    const pulmao = await prisma.location.create({
      data: {
        tenantId,
        corridor: "WS",
        row: "T",
        barcode: `${TAG}-PULMAO`.toUpperCase(),
        type: LocationType.PULMAO,
        capacity: 100,
      },
    });
    created.pulmaoId = pulmao.id;

    const tokA = await login(ana!.email, PASSWORD);
    const tokB = await login(bruno!.email, PASSWORD);
    const tokAdmin = await login(ADMIN.email, ADMIN.password, false);

    // ---------------------------------------------------------------- onda
    console.log("\n— Onda");
    const colleagues = await call(tokA, "GET", "/mobile/colleagues");
    check(
      "Ana vê Bruno na lista de colegas",
      colleagues.data.colleagues?.some((c: { id: string }) => c.id === bruno!.id),
      colleagues.data,
    );

    const split = await call(tokA, "POST", "/mobile/work/split", {
      kind: "PICK_WAVE",
      refId: wave.id,
      assigneeIds: [ana!.id, bruno!.id],
    });
    check("Divide a onda em 2", split.status === 200 && split.data.shares?.length === 2, split.data);
    const shareA = split.data.shares?.find((s: any) => s.assignedTo.id === ana!.id);
    const shareB = split.data.shares?.find((s: any) => s.assignedTo.id === bruno!.id);
    const lines = await prisma.pickWaveLine.findMany({
      where: { waveId: wave.id },
      include: { pickLocation: true },
    });
    const linesA = lines.filter((l) => l.partId === shareA?.wavePartId);
    const linesB = lines.filter((l) => l.partId === shareB?.wavePartId);
    check(
      "Linhas distribuídas entre as 2 partes",
      linesA.length > 0 && linesB.length > 0 && linesA.length + linesB.length === 4,
      { a: linesA.length, b: linesB.length },
    );

    const mineB = await call(tokB, "GET", "/mobile/work/mine");
    check(
      "Bruno recebe a parte reservada em Minhas tarefas",
      mineB.data.shares?.some((s: any) => s.id === shareB?.id && s.status === "RESERVED"),
      mineB.data,
    );
    const notifB = await prisma.notification.count({ where: { userId: bruno!.id } });
    check("Bruno recebe notificação", notifB > 0);

    const pick = (tok: string, line: (typeof lines)[number]) =>
      call(tok, "POST", `/mobile/waves/lines/${line.id}/pick`, {
        locationBarcode: line.pickLocation.barcode,
        quantity: line.quantityTotal - line.quantityPicked,
      });

    const beforeStart = await pick(tokA, linesA[0]!);
    check(
      "Separar antes de Iniciar é bloqueado",
      beforeStart.status >= 400 && /Iniciar/i.test(beforeStart.data.error ?? ""),
      beforeStart,
    );

    const startA = await call(tokA, "POST", `/mobile/work/shares/${shareA.id}/start`);
    check("Ana inicia a parte (cronômetro)", startA.data.share?.status === "STARTED", startA.data);

    const otherLine = await pick(tokA, linesB[0]!);
    check(
      "Ana não consegue separar a linha da parte do Bruno",
      otherLine.status >= 400,
      otherLine,
    );
    console.log(`   mensagem: ${otherLine.data.error}`);

    for (const line of linesA) {
      const r = await pick(tokA, line);
      check(`Ana separa ${line.id.slice(-6)}`, r.status === 200, r.data);
    }
    const doneA = await prisma.workShare.findUnique({ where: { id: shareA.id } });
    check("Parte da Ana termina sozinha (finishedAt)", doneA?.status === "FINISHED" && !!doneA.finishedAt, doneA);

    const decline = await call(tokB, "POST", `/mobile/work/shares/${shareB.id}/decline`);
    check("Bruno recusa a parte", decline.data.share?.status === "DECLINED", decline.data);
    const mineA = await call(tokA, "GET", "/mobile/work/mine");
    check(
      "Ana vê a parte recusada para repassar",
      mineA.data.shares?.some((s: any) => s.id === shareB.id && s.status === "DECLINED"),
      mineA.data,
    );
    const reassign = await call(tokA, "POST", `/mobile/work/shares/${shareB.id}/reassign`, {
      userId: ana!.id,
    });
    check("Ana assume a parte recusada", reassign.data.share?.assignedTo?.id === ana!.id, reassign.data);
    await call(tokA, "POST", `/mobile/work/shares/${shareB.id}/start`);
    for (const line of linesB) await pick(tokA, line);
    const doneB = await prisma.workShare.findUnique({ where: { id: shareB.id } });
    check("Parte assumida termina", doneB?.status === "FINISHED", doneB);

    // ---------------------------------------------------------------- NF
    console.log("\n— Conferência NF");
    const splitNf = await call(tokA, "POST", "/mobile/work/split", {
      kind: "RECEIPT_CHECK",
      refId: receipt.id,
      assigneeIds: [ana!.id, bruno!.id],
    });
    check("Divide a NF em 2", splitNf.data.shares?.length === 2, splitNf.data);
    const nfA = splitNf.data.shares?.find((s: any) => s.assignedTo.id === ana!.id);
    const nfB = splitNf.data.shares?.find((s: any) => s.assignedTo.id === bruno!.id);
    const nfItems = await prisma.purchaseReceiptItem.findMany({ where: { sessionId: receipt.id } });
    const itemOfA = nfItems.find((i) => i.workShareId === nfA.id)!;

    const viewB = await call(tokB, "GET", `/mobile/purchase-receipts/${receipt.id}`);
    check(
      "Bruno vê só os itens dele como próximo",
      viewB.data.nextItem && nfItems.find((i) => i.id === viewB.data.nextItem.id)?.workShareId === nfB.id,
      viewB.data.nextItem,
    );

    await call(tokB, "POST", `/mobile/work/shares/${nfB.id}/start`);
    const scanOther = await call(tokB, "POST", `/mobile/purchase-receipts/${receipt.id}/scan`, {
      barcode: itemOfA.barcode,
      quantity: 1,
    });
    check("Bruno não confere item da parte da Ana", scanOther.status >= 400, scanOther);
    console.log(`   mensagem: ${scanOther.data.error}`);

    await call(tokA, "POST", `/mobile/work/shares/${nfA.id}/start`);
    for (const it of nfItems) {
      const tok = it.workShareId === nfA.id ? tokA : tokB;
      const r = await call(tok, "POST", `/mobile/purchase-receipts/${receipt.id}/confirm-item`, {
        itemId: it.id,
        quantity: 2,
      });
      check(`Confere item ${it.lineNumber}`, r.status === 200, r.data);
    }
    const nfDone = await prisma.purchaseReceiptSession.findUnique({ where: { id: receipt.id } });
    check("NF conclui sozinha quando as 2 partes terminam", nfDone?.status === "COMPLETED", nfDone?.status);

    // ---------------------------------------------------------------- armazenagem
    console.log("\n— Armazenagem");
    const splitPut = await call(tokA, "POST", "/mobile/work/split", {
      kind: "PUTAWAY",
      refId: receipt.id,
      assigneeIds: [ana!.id, bruno!.id],
    });
    check("Divide a armazenagem em 2", splitPut.data.shares?.length === 2, splitPut.data);
    const putA = splitPut.data.shares?.find((s: any) => s.assignedTo.id === ana!.id);
    const putB = splitPut.data.shares?.find((s: any) => s.assignedTo.id === bruno!.id);
    const putSessionId = putA?.putawaySessionId as string;
    const queueB = await call(tokB, "GET", "/mobile/putaway/queue");
    check(
      "NF aparece na fila de armazenagem do Bruno",
      queueB.data.queue?.some((q: any) => q.putawaySessionId === putSessionId),
      queueB.data,
    );
    const putItems = await prisma.putawayItem.findMany({ where: { sessionId: putSessionId } });
    const store = (tok: string, itemId: string) =>
      call(tok, "POST", `/mobile/putaway/${putSessionId}/store`, {
        itemId,
        locationBarcode: pulmao.barcode,
        quantity: 2,
        pulmaoPercent: 10,
      });
    await call(tokA, "POST", `/mobile/work/shares/${putA.id}/start`);
    const storeOther = await store(tokA, putItems.find((i) => i.workShareId === putB.id)!.id);
    check("Ana não armazena item da parte do Bruno", storeOther.status >= 400, storeOther);
    console.log(`   mensagem: ${storeOther.data.error}`);
    await call(tokB, "POST", `/mobile/work/shares/${putB.id}/start`);
    for (const it of putItems) {
      const r = await store(it.workShareId === putA.id ? tokA : tokB, it.id);
      check(`Armazena item ${it.id.slice(-6)}`, r.status === 200, r.data);
    }
    const putDone = await prisma.putawaySession.findUnique({ where: { id: putSessionId } });
    check("Armazenagem conclui sozinha", putDone?.status === "COMPLETED", putDone?.status);

    // ---------------------------------------------------------------- métricas
    console.log("\n— Métricas");
    const dash = await call(tokAdmin, "GET", "/api/dashboard/work-shares");
    const mine = (dash.data.byUserStage ?? []).filter((r: any) => created.userIds.includes(r.userId));
    check(
      "Painel tem tempo por funcionário e etapa",
      mine.some((r: any) => r.userId === ana!.id && r.kind === "PICK_WAVE" && r.tasks === 2) &&
        mine.some((r: any) => r.userId === bruno!.id && r.kind === "RECEIPT_CHECK") &&
        mine.some((r: any) => r.kind === "PUTAWAY"),
      mine,
    );
    for (const r of mine) {
      console.log(`   ${r.userName} · ${r.kindLabel}: ${r.tasks} parte(s), ${r.units} un., ${r.totalSec}s`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const rep1 = await call(tokAdmin, "GET", `/api/reports/data?report=work_time_by_user_stage&from=${today}&to=${today}`);
    check("Relatório work_time_by_user_stage", rep1.status === 200 && rep1.data.totalRows >= 3, rep1.data);
    const rep2 = await call(tokAdmin, "GET", `/api/reports/data?report=work_shares&from=${today}&to=${today}`);
    check("Relatório work_shares", rep2.status === 200 && rep2.data.totalRows >= 6, rep2.data);
    const waveShares = await call(tokAdmin, "GET", `/api/waves/${wave.id}/work-shares`);
    check("Página da onda lista as partes", waveShares.data.shares?.length === 2, waveShares.data);
    const nfShares = await call(tokAdmin, "GET", `/api/purchase-receipts/${receipt.id}/work-shares`);
    check("Página do recebimento lista conferência + armazenagem", nfShares.data.shares?.length === 4, nfShares.data);
  } finally {
    await cleanup(created);
  }

  console.log(failures === 0 ? "\nTudo certo." : `\n${failures} verificação(ões) falharam.`);
  if (failures > 0) process.exitCode = 1;
}

async function cleanup(c: {
  userIds: string[];
  productIds: string[];
  waveId: string | null;
  orderId: string | null;
  receiptId: string | null;
  pulmaoId: string | null;
}) {
  const userIds = c.userIds;
  await prisma.workShare.deleteMany({ where: { assignedToId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.inventoryMovement.deleteMany({ where: { userId: { in: userIds } } });
  if (c.receiptId) {
    const putaway = await prisma.putawaySession.findUnique({ where: { purchaseReceiptId: c.receiptId } });
    if (putaway) {
      await prisma.putawayTimeLog.deleteMany({ where: { sessionId: putaway.id } });
      await prisma.putawayItem.deleteMany({ where: { sessionId: putaway.id } });
      await prisma.putawaySession.delete({ where: { id: putaway.id } });
    }
    await prisma.purchaseReceiptTimeLog.deleteMany({ where: { sessionId: c.receiptId } });
    await prisma.purchaseReceiptSession.delete({ where: { id: c.receiptId } });
  }
  if (c.waveId) await prisma.pickWave.delete({ where: { id: c.waveId } });
  if (c.orderId) {
    await prisma.orderTimeLog.deleteMany({ where: { orderId: c.orderId } });
    await prisma.orderStageLog.deleteMany({ where: { orderId: c.orderId } });
    await prisma.orderItem.deleteMany({ where: { orderId: c.orderId } });
    await prisma.order.delete({ where: { id: c.orderId } });
  }
  if (c.pulmaoId) {
    await prisma.locationStock.deleteMany({ where: { locationId: c.pulmaoId } });
    await prisma.location.delete({ where: { id: c.pulmaoId } });
  }
  await prisma.product.deleteMany({ where: { id: { in: c.productIds } } });
  await prisma.pushDevice.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  console.log("\nDados de teste removidos.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
