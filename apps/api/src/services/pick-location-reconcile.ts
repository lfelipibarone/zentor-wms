import { LocationType, OrderStatus, PickWaveStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { resolvePickFaceForProduct } from "./pick-face-resolve.js";

export type ReconcileOrderItemRow = {
  orderItemId: string;
  orderId: string;
  erpOrderId: string;
  oldLocationBarcode: string | null;
  newLocationBarcode: string;
};

export type ReconcileWaveLineRow = {
  waveLineId: string;
  waveId: string;
  waveName: string;
  oldLocationBarcode: string;
  newLocationBarcode: string | null;
  action: "updated" | "warning";
  message?: string;
};

export type ReconcileResult = {
  pulmaoOnly: boolean;
  orderItems: ReconcileOrderItemRow[];
  waveLines: ReconcileWaveLineRow[];
  warnings: string[];
  pickingSession?: Awaited<ReturnType<typeof buildPickingSessionSlice>>;
};

export type ReconcileOpts = {
  adjustedLocationId?: string;
  orderId?: string;
  itemId?: string;
  waveLineId?: string;
};

function formatLocation(loc: { barcode: string }) {
  return loc.barcode;
}

export function emptyFaceHint(loc: { fillPercent: number } | null | undefined): string | null {
  return loc && loc.fillPercent <= 0 ? "Gôndola registrada como vazia (0%)" : null;
}

export async function buildPickingSessionSlice(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      basket: true,
      items: {
        orderBy: { lineNumber: "asc" },
        include: { product: true, pickLocation: true },
      },
    },
  });
  if (!order) return null;

  const { getRouteEngine, pickNextItemByEngine, sortPendingItemsByEngine } = await import(
    "./route-engine/index.js"
  );
  const engine = await getRouteEngine(order.tenantId);

  const isPending = (i: (typeof order.items)[0]) =>
    i.quantityPicked < i.quantityOrdered;

  const nextItem =
    pickNextItemByEngine(engine, order.items, isPending, null) ??
    order.items.find(isPending);

  const routeQueue = sortPendingItemsByEngine(engine, order.items, isPending, null);

  const mapLoc = (loc: (typeof order.items)[0]["pickLocation"]) =>
    loc
      ? {
          ...loc,
          label: formatLocation(loc),
        }
      : null;

  const mapItem = (item: (typeof order.items)[0], remaining?: number) => ({
    id: item.id,
    lineNumber: item.lineNumber,
    quantityOrdered: item.quantityOrdered,
    quantityPicked: item.quantityPicked,
    remaining:
      remaining ?? item.quantityOrdered - item.quantityPicked,
    product: item.product,
    pickLocation: mapLoc(item.pickLocation),
    stockMismatchHint: emptyFaceHint(item.pickLocation),
  });

  return {
    order: {
      id: order.id,
      erpOrderId: order.erpOrderId,
      status: order.status,
      basket: order.basket,
    },
    routeQueue: routeQueue.slice(0, 5).map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      pickLocation: mapLoc(item.pickLocation),
    })),
    nextItem: nextItem ? mapItem(nextItem) : null,
    allPicked: !nextItem,
  };
}

async function resolvePrimaryPickLocationId(
  tenantId: string,
  productId: string,
): Promise<string> {
  const loc = await resolvePickFaceForProduct(productId, tenantId, "pick");
  return loc.id;
}

async function migrateWaveLineToNewLocation(
  lineId: string,
  newLocationId: string,
): Promise<{ ok: boolean; message?: string }> {
  const line = await prisma.pickWaveLine.findUnique({
    where: { id: lineId },
    include: { allocations: true, wave: true, pickLocation: true },
  });
  if (!line || line.quantityPicked > 0) {
    return { ok: false, message: "Linha já iniciada — não movida" };
  }

  if (line.pickLocationId === newLocationId) {
    return { ok: true };
  }

  const conflict = await prisma.pickWaveLine.findFirst({
    where: {
      waveId: line.waveId,
      productId: line.productId,
      pickLocationId: newLocationId,
      NOT: { id: line.id },
    },
  });

  if (conflict) {
    const conflictAllocItemIds = new Set(
      (
        await prisma.pickWaveAllocation.findMany({
          where: { waveLineId: conflict.id },
          select: { orderItemId: true },
        })
      ).map((a) => a.orderItemId),
    );
    const lineAllocIds = line.allocations.map((a) => a.orderItemId);
    const overlap = lineAllocIds.some((id) => conflictAllocItemIds.has(id));
    if (overlap) {
      return {
        ok: false,
        message:
          "Já existe linha na gôndola destino com pedidos sobrepostos — ajuste manual na web",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.pickWaveAllocation.updateMany({
        where: { waveLineId: line.id },
        data: { waveLineId: conflict.id },
      });
      await tx.pickWaveLine.update({
        where: { id: conflict.id },
        data: {
          quantityTotal: conflict.quantityTotal + line.quantityTotal,
        },
      });
      await tx.pickWaveLine.delete({ where: { id: line.id } });
    });
    return {
      ok: true,
      message: "Alocações fundidas em linha existente na nova gôndola",
    };
  }

  await prisma.pickWaveLine.update({
    where: { id: line.id },
    data: { pickLocationId: newLocationId },
  });
  return { ok: true };
}

export async function reconcilePickTargetsAfterStockChange(
  tenantId: string,
  productId: string,
  opts?: ReconcileOpts,
): Promise<ReconcileResult> {
  const adjustedLoc = opts?.adjustedLocationId
    ? await prisma.location.findUnique({ where: { id: opts.adjustedLocationId } })
    : null;

  const pulmaoOnly = adjustedLoc?.type === LocationType.PULMAO;

  const orderItems: ReconcileOrderItemRow[] = [];
  const waveLines: ReconcileWaveLineRow[] = [];
  const warnings: string[] = [];

  if (!pulmaoOnly) {
    const itemsRaw = await prisma.orderItem.findMany({
      where: {
        productId,
        order: {
          tenantId,
          status: { in: [OrderStatus.PENDING, OrderStatus.PICKING] },
        },
      },
      include: {
        pickLocation: true,
        order: { select: { id: true, erpOrderId: true } },
      },
    });

    const items = itemsRaw.filter(
      (i) => i.quantityPicked < i.quantityOrdered,
    );

    for (const item of items) {
      const remaining = item.quantityOrdered - item.quantityPicked;
      if (remaining <= 0) continue;

      const oldBarcode = item.pickLocation?.barcode ?? null;
      let newLocationId: string;
      try {
        newLocationId = await resolvePrimaryPickLocationId(tenantId, productId);
      } catch (e) {
        warnings.push(
          `Pedido ${item.order.erpOrderId}: ${e instanceof Error ? e.message : "sem gôndola"}`,
        );
        continue;
      }

      const newLoc = await prisma.location.findUnique({
        where: { id: newLocationId },
      });
      if (!newLoc) continue;

      if (item.pickLocationId !== newLocationId) {
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { pickLocationId: newLocationId },
        });
        orderItems.push({
          orderItemId: item.id,
          orderId: item.order.id,
          erpOrderId: item.order.erpOrderId,
          oldLocationBarcode: oldBarcode,
          newLocationBarcode: newLoc.barcode,
        });
      }
    }
  } else {
    warnings.push(
      "Ajuste em pulmão: % do pulmão atualizada; gôndolas dos pedidos não alteradas",
    );
  }

  const waveLineRecords = await prisma.pickWaveLine.findMany({
    where: {
      productId,
      wave: { tenantId, status: PickWaveStatus.RELEASED },
    },
    include: {
      pickLocation: true,
      wave: { select: { id: true, name: true } },
    },
  });

  for (const line of waveLineRecords) {
    const remaining = line.quantityTotal - line.quantityPicked;

    if (line.quantityPicked > 0) {
      const loc = await prisma.location.findUnique({
        where: { id: line.pickLocationId },
      });
      if (loc && remaining > 0 && loc.fillPercent <= 0) {
        waveLines.push({
          waveLineId: line.id,
          waveId: line.waveId,
          waveName: line.wave.name,
          oldLocationBarcode: line.pickLocation.barcode,
          newLocationBarcode: null,
          action: "warning",
          message: `Linha em andamento: gôndola registrada como vazia e faltam ${remaining} un.`,
        });
        warnings.push(
          `Onda ${line.wave.name}: linha ${line.pickLocation.barcode} já iniciada`,
        );
      }
      continue;
    }

    let newLocationId: string;
    try {
      newLocationId = await resolvePrimaryPickLocationId(tenantId, productId);
    } catch (e) {
      waveLines.push({
        waveLineId: line.id,
        waveId: line.waveId,
        waveName: line.wave.name,
        oldLocationBarcode: line.pickLocation.barcode,
        newLocationBarcode: null,
        action: "warning",
        message: e instanceof Error ? e.message : "Sem gôndola disponível",
      });
      continue;
    }

    const newLoc = await prisma.location.findUnique({
      where: { id: newLocationId },
    });
    if (!newLoc) continue;

    if (newLocationId !== line.pickLocationId) {
      const migrated = await migrateWaveLineToNewLocation(line.id, newLocationId);
      waveLines.push({
        waveLineId: line.id,
        waveId: line.waveId,
        waveName: line.wave.name,
        oldLocationBarcode: line.pickLocation.barcode,
        newLocationBarcode: newLoc.barcode,
        action: migrated.ok ? "updated" : "warning",
        message: migrated.message,
      });
    } else if (newLoc.fillPercent <= 0) {
      waveLines.push({
        waveLineId: line.id,
        waveId: line.waveId,
        waveName: line.wave.name,
        oldLocationBarcode: line.pickLocation.barcode,
        newLocationBarcode: newLoc.barcode,
        action: "warning",
        message: "Gôndola registrada como vazia (0%) e não há outra com produto",
      });
      warnings.push(
        `Onda ${line.wave.name}: ${newLoc.barcode} vazia após ajuste`,
      );
    }
  }

  let pickingSession: ReconcileResult["pickingSession"];
  if (opts?.orderId) {
    pickingSession = await buildPickingSessionSlice(opts.orderId);
  }

  return {
    pulmaoOnly,
    orderItems,
    waveLines,
    warnings,
    pickingSession: pickingSession ?? undefined,
  };
}
