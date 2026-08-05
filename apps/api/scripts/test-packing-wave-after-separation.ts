import { OrderStatus, PrismaClient } from "@prisma/client";
import { defaultPermissionsForRole } from "@wms/shared";

const API = process.env.API_URL ?? "http://localhost:3333";
const prisma = new PrismaClient();

type AuthResponse = { token: string; user: { email: string; id: string } };

async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body:
      opts.body !== undefined
        ? JSON.stringify(opts.body)
        : opts.method && opts.method !== "GET"
          ? "{}"
          : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `${opts.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(data)}`,
    );
  }
  return data as T;
}

async function ensureOperadorPermissions() {
  const perms = [
    ...new Set([
      ...defaultPermissionsForRole("EXPEDITER"),
      "registers.view",
      "products.manage",
      "reports.view",
    ]),
  ];
  await prisma.user.update({
    where: { email: "operador@wms.local" },
    data: { permissions: perms },
  });
}

async function createMonoItemOrder(suffix: number) {
  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { slug: "default" },
  });

  const location = await prisma.location.findFirst({
    where: {
      tenantId: tenant.id,
      type: "PICK_FACE",
      active: true,
      productId: { not: null },
      currentQuantity: { gt: 0 },
    },
    include: { product: true },
  });
  if (!location?.product) {
    throw new Error("Nenhuma gôndola com produto e estoque");
  }

  const basket = await prisma.basket.findFirstOrThrow({
    where: { tenantId: tenant.id, active: true },
  });

  const erpOrderId = `TEST-WAVE-${suffix}`;

  return prisma.order.create({
    data: {
      tenantId: tenant.id,
      erpOrderId,
      customerName: "Cliente Teste Onda",
      status: OrderStatus.PENDING,
      priority: 50,
      basketId: basket.id,
      items: {
        create: [
          {
            lineNumber: 1,
            productId: location.product.id,
            pickLocationId: location.id,
            quantityOrdered: 1,
            quantityPicked: 0,
            quantityPacked: 0,
          },
        ],
      },
    },
    include: {
      items: true,
      basket: true,
    },
  });
}

type UnifiedQueue = {
  items: Array<
    | { kind: "order"; order: { id: string; erpOrderId: string } }
    | { kind: "wave_line"; line: { id: string; sku: string; waveName: string } }
  >;
};

async function main() {
  console.log("=== Teste E2E: onda → packing (Cenário B) ===\n");

  await ensureOperadorPermissions();

  const suffix = Date.now();
  const order = await createMonoItemOrder(suffix);
  console.log(`[setup] Pedido mono-item: ${order.erpOrderId}`);

  const operadorAuth = await api<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email: "operador@wms.local", password: "operador123" },
  });

  const release = await api<{ waveId: string; orderCount: number; lineCount: number }>(
    "/api/waves/release",
    {
      method: "POST",
      token: operadorAuth.token,
      body: {
        orderIds: [order.id],
        auto: false,
        partitionStrategy: "SINGLE_ITEM",
      },
    },
  );
  console.log(
    `[web] Onda liberada: ${release.waveId} (${release.orderCount} pedidos, ${release.lineCount} linhas)`,
  );

  const waveDetail = await api<{
    lines: Array<{
      id: string;
      locationBarcode: string;
      quantityTotal: number;
      sku: string;
    }>;
  }>(`/api/waves/${release.waveId}`, { token: operadorAuth.token });

  const line = waveDetail.lines[0];
  if (!line) throw new Error("Onda sem linhas");

  const lineRow = await prisma.pickWaveLine.findUniqueOrThrow({
    where: { id: line.id },
    include: { product: { select: { barcode: true } } },
  });

  const pickerAuth = await api<AuthResponse>("/auth/mobile/login", {
    method: "POST",
    body: { email: "picker@wms.local", password: "dev" },
  });

  await api(`/mobile/waves/${release.waveId}/accept`, {
    method: "POST",
    token: pickerAuth.token,
  });
  console.log("[mobile] Onda aceita pelo picker");

  await api(`/mobile/waves/lines/${line.id}/pick`, {
    method: "POST",
    token: pickerAuth.token,
    body: {
      locationBarcode: line.locationBarcode,
      productBarcode: lineRow.product.barcode ?? undefined,
      quantity: line.quantityTotal,
    },
  });
  console.log(`[mobile] Linha coletada na gôndola ${line.locationBarcode}`);

  const queueAfterPick = await api<UnifiedQueue>("/api/packing/queue/unified", {
    token: operadorAuth.token,
  });

  const waveInQueue = queueAfterPick.items.find(
    (i) => i.kind === "wave_line" && i.line.id === line.id,
  );
  const orderInQueueAfterPick = queueAfterPick.items.find(
    (i) => i.kind === "order" && i.order.erpOrderId === order.erpOrderId,
  );

  if (!waveInQueue) {
    throw new Error("FALHA estágio 1: linha da onda não apareceu no packing após coleta");
  }
  if (orderInQueueAfterPick) {
    throw new Error(
      "FALHA estágio 1: pedido apareceu como Pedido antes da triagem (esperado só Onda)",
    );
  }
  console.log("[api] Estágio 1 OK: onda visível no packing, pedido ainda não listado");

  const packingLine = await api<{
    line: {
      allocations: Array<{
        id: string;
        quantity: number;
        remaining: number;
        order: { id: string; erpOrderId: string };
      }>;
    };
  }>(`/api/packing/waves/lines/${line.id}`, { token: operadorAuth.token });

  const alloc = packingLine.line.allocations.find(
    (a) => a.order.erpOrderId === order.erpOrderId,
  );
  if (!alloc) {
    throw new Error("Alocação do pedido não encontrada na linha de packing");
  }

  await api(`/api/packing/waves/lines/${line.id}/sort`, {
    method: "POST",
    token: operadorAuth.token,
    body: {
      allocationId: alloc.id,
      quantity: alloc.quantity,
      basketBarcode: order.basket?.barcode ?? undefined,
    },
  });
  console.log("[web] Triagem na cesta concluída");

  const dbOrder = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { status: true },
  });
  if (dbOrder.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new Error(
      `FALHA estágio 2: status esperado PICKED_AWAITING_CONFERENCE, obtido ${dbOrder.status}`,
    );
  }

  const queueAfterSort = await api<UnifiedQueue>("/api/packing/queue/unified", {
    token: operadorAuth.token,
  });

  const orderInQueue = queueAfterSort.items.find(
    (i) => i.kind === "order" && i.order.erpOrderId === order.erpOrderId,
  );
  if (!orderInQueue) {
    throw new Error("FALHA estágio 2: pedido não apareceu no packing após triagem");
  }

  console.log("[api] Estágio 2 OK: pedido visível no packing após triagem");
  console.log("\n=== RESULTADO: PASSOU (Cenário B — onda) ===");
  console.log(
    JSON.stringify(
      {
        erpOrderId: order.erpOrderId,
        orderId: order.id,
        waveId: release.waveId,
        lineId: line.id,
        flow: "wave",
        afterPick: { waveInQueue: true, orderInQueue: false },
        afterSort: { status: dbOrder.status, orderInQueue: true },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error("\n=== RESULTADO: FALHOU (Cenário B) ===");
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
