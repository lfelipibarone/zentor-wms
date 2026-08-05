import { OrderStatus, PrismaClient } from "@prisma/client";
import { defaultPermissionsForRole } from "@wms/shared";

const API = process.env.API_URL ?? "http://localhost:3333";
const prisma = new PrismaClient();

type AuthResponse = { token: string; user: { email: string } };

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

async function ensureOperadorShippingPermission() {
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

async function createTestOrder() {
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
    throw new Error("Nenhuma gôndola com produto e estoque para o teste");
  }

  const basket =
    (await prisma.basket.findFirst({
      where: { tenantId: tenant.id, active: true },
    })) ??
    (await prisma.basket.create({
      data: {
        tenantId: tenant.id,
        code: "TEST-CESTA-01",
        barcode: "TESTBASKET01",
      },
    }));

  const suffix = Date.now();
  const erpOrderId = `TEST-PACK-${suffix}`;

  const order = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      erpOrderId,
      customerName: "Cliente Teste Packing",
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

  return { order, location, basket };
}

async function main() {
  console.log("=== Teste E2E: pedido separado aparece no Packing ===\n");

  await ensureOperadorShippingPermission();
  console.log("[prep] Permissões do operador restauradas (inclui shipping.view)");

  const { order, location } = await createTestOrder();
  console.log(
    `[setup] Pedido criado: ${order.erpOrderId} (id=${order.id}) · SKU via ${location.barcode}`,
  );

  const pickerAuth = await api<AuthResponse>("/auth/mobile/login", {
    method: "POST",
    body: { email: "picker@wms.local", password: "dev" },
  });
  console.log(`[mobile] Login picker OK (${pickerAuth.user.email})`);

  await api(`/mobile/orders/${order.id}/accept`, {
    method: "POST",
    token: pickerAuth.token,
  });
  console.log("[mobile] Pedido aceito → PICKING");

  const item = order.items[0]!;
  await api(`/mobile/orders/${order.id}/items/${item.id}/pick`, {
    method: "POST",
    token: pickerAuth.token,
    body: { quantity: item.quantityOrdered },
  });
  console.log(`[mobile] Item bipado (${item.quantityOrdered} un.)`);

  const complete = await api<{ status: OrderStatus }>(
    `/mobile/orders/${order.id}/complete-picking`,
    { method: "POST", token: pickerAuth.token },
  );
  console.log(`[mobile] Separação finalizada → ${complete.status}`);

  if (complete.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new Error(`Status inesperado após complete-picking: ${complete.status}`);
  }

  const dbOrder = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { status: true, erpOrderId: true },
  });
  console.log(`[db] Status confirmado: ${dbOrder.status}`);

  const operadorAuth = await api<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email: "operador@wms.local", password: "operador123" },
  });
  console.log(`[web] Login operador OK (${operadorAuth.user.email})`);

  type UnifiedQueue = {
    items: Array<
      | { kind: "order"; order: { id: string; erpOrderId: string; status: string } }
      | { kind: "wave_line"; line: { id: string } }
      | { kind: "replenishment"; need: { pickFaceId: string } }
    >;
  };

  const queue = await api<UnifiedQueue>("/api/packing/queue/unified", {
    token: operadorAuth.token,
  });

  const found = queue.items.find(
    (i) => i.kind === "order" && i.order.erpOrderId === order.erpOrderId,
  );

  if (!found || found.kind !== "order") {
    const orderItems = queue.items
      .filter((i) => i.kind === "order")
      .map((i) => (i.kind === "order" ? i.order.erpOrderId : ""));
    throw new Error(
      `FALHA: pedido ${order.erpOrderId} não está na fila de packing. Pedidos na fila: ${orderItems.join(", ") || "(nenhum)"}`,
    );
  }

  console.log(`[api] Pedido encontrado na fila unificada: ${found.order.erpOrderId}`);

  const search = await api<{ order: { id: string; erpOrderId: string } }>(
    `/api/packing/orders/search?q=${encodeURIComponent(order.erpOrderId)}`,
    { token: operadorAuth.token },
  );
  console.log(`[api] Busca por erpOrderId OK: ${search.order.erpOrderId}`);

  if (order.basket?.barcode) {
    const basketScan = await api<{ order: { id: string } }>(
      "/api/packing/baskets/scan",
      {
        method: "POST",
        token: operadorAuth.token,
        body: { barcode: order.basket.barcode },
      },
    );
    if (basketScan.order.id !== order.id) {
      throw new Error("Scan de cesta retornou pedido diferente");
    }
    console.log(`[api] Scan de cesta OK (${order.basket.barcode})`);
  }

  await api(`/api/packing/orders/${order.id}/start`, {
    method: "POST",
    token: operadorAuth.token,
    body: {},
  });
  console.log("[web] Sessão de packing iniciada sem erro");

  console.log("\n=== RESULTADO: PASSOU (Cenário A — pedido dedicado) ===");
  console.log(
    JSON.stringify(
      {
        erpOrderId: order.erpOrderId,
        orderId: order.id,
        flow: "dedicated",
        statusAfterSeparation: complete.status,
        inPackingQueue: true,
        basketScan: order.basket?.barcode ?? null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error("\n=== RESULTADO: FALHOU ===");
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
