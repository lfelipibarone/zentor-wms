import {
  CargoTransferStatus,
  InventoryMovementType,
  LocationType,
  type LocationStockMode,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isQuantityMode, parseUnits, quantityLevelData, stockModeFields } from "./location-level.js";
import { findProductByBarcode } from "./location-stock.js";
import { getPulmaoSkuPercent, setPulmaoSkuPercent } from "./pulmao-inventory.js";
import { parsePercent, StockPercentError } from "./stock-percent.js";

export class CargoTransferError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "CargoTransferError";
  }
}

function formatLocationLabel(loc: { barcode: string }) {
  return loc.barcode;
}

type TransferRow = {
  id: string;
  status: CargoTransferStatus;
  quantity: number;
  withdrawnAt: Date;
  depositedAt: Date | null;
  targetPickFaceId: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
    imageUrl: string | null;
  };
  fromLocation: { id: string; barcode: string; corridor: string; row: string };
  toLocation: {
    id: string;
    barcode: string;
    corridor: string;
    row: string;
  } | null;
  targetPickFace: {
    id: string;
    barcode: string;
    corridor: string;
    row: string;
    type: LocationType;
    stockMode: LocationStockMode;
    stockQuantity: number;
    capacity: number;
    minQuantity: number;
  } | null;
  withdrawnBy: { id: string; name: string };
};

export function mapCargoTransferSummary(transfer: TransferRow) {
  const durationSeconds =
    transfer.depositedAt != null
      ? Math.round(
          (transfer.depositedAt.getTime() - transfer.withdrawnAt.getTime()) /
            1000,
        )
      : Math.round((Date.now() - transfer.withdrawnAt.getTime()) / 1000);

  return {
    id: transfer.id,
    status: transfer.status,
    quantity: transfer.quantity,
    withdrawnAt: transfer.withdrawnAt.toISOString(),
    depositedAt: transfer.depositedAt?.toISOString() ?? null,
    durationSeconds,
    targetPickFaceId: transfer.targetPickFaceId,
    product: {
      id: transfer.product.id,
      sku: transfer.product.sku,
      name: transfer.product.name,
      barcode: transfer.product.barcode,
      imageUrl: transfer.product.imageUrl,
    },
    fromLocation: {
      id: transfer.fromLocation.id,
      barcode: transfer.fromLocation.barcode,
      label: formatLocationLabel(transfer.fromLocation),
    },
    toLocation: transfer.toLocation
      ? {
          id: transfer.toLocation.id,
          barcode: transfer.toLocation.barcode,
          label: formatLocationLabel(transfer.toLocation),
        }
      : null,
    targetPickFace: transfer.targetPickFace
      ? {
          id: transfer.targetPickFace.id,
          barcode: transfer.targetPickFace.barcode,
          label: formatLocationLabel(transfer.targetPickFace),
          ...stockModeFields(transfer.targetPickFace),
        }
      : null,
    withdrawnByName: transfer.withdrawnBy.name,
  };
}

const transferInclude = {
  product: {
    select: {
      id: true,
      sku: true,
      name: true,
      barcode: true,
      imageUrl: true,
    },
  },
  fromLocation: {
    select: { id: true, barcode: true, corridor: true, row: true, estanteId: true, face: true },
  },
  toLocation: {
    select: { id: true, barcode: true, corridor: true, row: true },
  },
  targetPickFace: {
    select: {
      id: true,
      barcode: true,
      corridor: true,
      row: true,
      estanteId: true,
      face: true,
      type: true,
      stockMode: true,
      stockQuantity: true,
      capacity: true,
      minQuantity: true,
    },
  },
  withdrawnBy: { select: { id: true, name: true } },
} as const;

function parseTransferPercent(value: unknown, label: string): number {
  try {
    return parsePercent(value, label);
  } catch (e) {
    if (e instanceof StockPercentError) throw new CargoTransferError(e.message);
    throw e;
  }
}

export async function withdrawCargoTransfer(input: {
  tenantId: string;
  userId: string;
  fromLocationBarcode: string;
  productBarcode: string;
  /** % que o SKU ainda ocupa no pulmão depois da retirada */
  remainingPercent?: unknown;
  /** O SKU acabou no pulmão (sai da lista) */
  skuFinished?: boolean;
  /** Unidades levadas (opcional) */
  quantity?: number;
  targetPickFaceId?: string;
}) {
  const quantity = Math.max(0, Math.floor(Number(input.quantity ?? 0)) || 0);
  const remainingPercent = input.skuFinished
    ? 0
    : parseTransferPercent(input.remainingPercent, "% que ficou do SKU no pulmão");

  const fromBarcode = input.fromLocationBarcode.trim();
  const fromLoc = await prisma.location.findFirst({
    where: {
      tenantId: input.tenantId,
      barcode: { equals: fromBarcode, mode: "insensitive" },
      active: true,
    },
  });

  if (!fromLoc) {
    throw new CargoTransferError("Pulmão não encontrado", 404);
  }
  if (fromLoc.type !== LocationType.PULMAO) {
    throw new CargoTransferError("Origem deve ser um pulmão");
  }

  const product = await findProductByBarcode(input.tenantId, input.productBarcode);
  if (!product) {
    throw new CargoTransferError("Produto não cadastrado", 404);
  }
  const previousPercent = await getPulmaoSkuPercent(prisma, fromLoc.id, product.id);
  if (previousPercent <= 0) {
    throw new CargoTransferError(`Pulmão ${fromLoc.barcode} não tem ${product.sku}`);
  }

  let targetPickFaceId: string | null = input.targetPickFaceId ?? null;
  if (targetPickFaceId) {
    const face = await prisma.location.findFirst({
      where: {
        id: targetPickFaceId,
        tenantId: input.tenantId,
        active: true,
        type: LocationType.PICK_FACE,
      },
    });
    if (!face) {
      throw new CargoTransferError("Gôndola alvo não encontrada", 404);
    }
    if (face.productId && face.productId !== product.id) {
      throw new CargoTransferError(
        "Produto do pulmão não corresponde à gôndola alvo",
      );
    }

    const existing = await prisma.cargoTransfer.findFirst({
      where: {
        tenantId: input.tenantId,
        status: CargoTransferStatus.IN_TRANSIT,
        targetPickFaceId: face.id,
      },
    });
    if (existing) {
      throw new CargoTransferError(
        "Já existe transporte em andamento para esta gôndola",
        409,
      );
    }
  }

  const withdrawnAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const transfer = await tx.cargoTransfer.create({
      data: {
        tenantId: input.tenantId,
        status: CargoTransferStatus.IN_TRANSIT,
        productId: product.id,
        quantity,
        fromLocationId: fromLoc.id,
        targetPickFaceId,
        fromPercentBefore: previousPercent,
        withdrawnById: input.userId,
        withdrawnAt,
      },
    });

    const { fillPercent } = await setPulmaoSkuPercent(
      tx,
      { tenantId: input.tenantId, locationId: fromLoc.id, productId: product.id },
      remainingPercent,
    );

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        type: InventoryMovementType.TRANSFER,
        quantity,
        percentBefore: previousPercent,
        percentAfter: remainingPercent,
        userId: input.userId,
        productId: product.id,
        fromLocationId: fromLoc.id,
        toLocationId: null,
        cargoTransferId: transfer.id,
        startedAt: withdrawnAt,
        completedAt: withdrawnAt,
        notes:
          remainingPercent === 0
            ? "Transporte de carga — retirada do pulmão (SKU acabou)"
            : "Transporte de carga — retirada do pulmão",
      },
    });

    await tx.cargoTransfer.update({
      where: { id: transfer.id },
      data: { withdrawMovementId: movement.id },
    });

    const full = await tx.cargoTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: transferInclude,
    });

    return {
      transfer: mapCargoTransferSummary(full),
      fromLocation: {
        barcode: fromLoc.barcode,
        /** % do SKU que ficou no pulmão (0 = acabou) */
        skuPercent: remainingPercent,
        fillPercent,
      },
    };
  });

  if (targetPickFaceId) {
    const { markAssignmentWithdrawn } = await import(
      "./replenishment-assignment.js"
    );
    await markAssignmentWithdrawn(
      input.tenantId,
      targetPickFaceId,
      input.userId,
      result.transfer.id,
    );
  }

  return result;
}

export async function cancelCargoTransfer(
  tenantId: string,
  transferId: string,
  userId: string,
) {
  const transfer = await prisma.cargoTransfer.findFirst({
    where: {
      id: transferId,
      tenantId,
      status: CargoTransferStatus.IN_TRANSIT,
    },
    include: { fromLocation: true, product: true },
  });

  if (!transfer) {
    throw new CargoTransferError("Transporte não encontrado ou já concluído", 404);
  }
  if (transfer.withdrawnById !== userId) {
    throw new CargoTransferError(
      "Somente quem retirou pode cancelar o transporte",
      403,
    );
  }

  await prisma.$transaction(async (tx) => {
    let percentBefore: number | null = null;
    let percentAfter: number | null = null;
    if (transfer.fromLocation.type === LocationType.PULMAO && transfer.fromPercentBefore != null) {
      const restored = await setPulmaoSkuPercent(
        tx,
        { tenantId, locationId: transfer.fromLocationId, productId: transfer.productId },
        transfer.fromPercentBefore,
      );
      percentBefore = restored.previous;
      percentAfter = transfer.fromPercentBefore;
    }

    await tx.inventoryMovement.create({
      data: {
        tenantId,
        type: InventoryMovementType.TRANSFER,
        quantity: transfer.quantity,
        percentBefore,
        percentAfter,
        userId,
        productId: transfer.productId,
        toLocationId: transfer.fromLocationId,
        cargoTransferId: transfer.id,
        notes: "Cancelamento de transporte — devolução ao pulmão",
      },
    });

    await tx.cargoTransfer.update({
      where: { id: transfer.id },
      data: { status: CargoTransferStatus.CANCELLED },
    });

    if (transfer.targetPickFaceId) {
      await tx.replenishmentAssignment.updateMany({
        where: {
          cargoTransferId: transfer.id,
          status: "WITHDRAWN",
        },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          cargoTransferId: null,
        },
      });
      await tx.replenishmentAssignment.updateMany({
        where: {
          pickFaceId: transfer.targetPickFaceId,
          assignedToId: userId,
          status: "OPEN",
        },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
        },
      });
    }
  });

  return { cancelled: true, transferId };
}

export async function listPendingCargoTransfers(
  tenantId: string,
  opts?: { userId?: string },
) {
  const transfers = await prisma.cargoTransfer.findMany({
    where: {
      tenantId,
      status: CargoTransferStatus.IN_TRANSIT,
      ...(opts?.userId ? { withdrawnById: opts.userId } : {}),
    },
    include: transferInclude,
  });

  const { getRouteEngine } = await import("./route-engine/index.js");
  const tagged = transfers.map((t) => {
    const anchor = t.targetPickFace ?? t.fromLocation;
    return { ...anchor, transferId: t.id };
  });
  const sortedLocs = (await getRouteEngine(tenantId)).sortByRoute(tagged);
  const sorted = sortedLocs.map(
    (loc) => transfers.find((tr) => tr.id === loc.transferId)!,
  );

  return sorted.map(mapCargoTransferSummary);
}

export async function getCargoTransfer(tenantId: string, id: string) {
  const transfer = await prisma.cargoTransfer.findFirst({
    where: { id, tenantId },
    include: transferInclude,
  });
  if (!transfer) {
    throw new CargoTransferError("Transporte não encontrado", 404);
  }
  return mapCargoTransferSummary(transfer);
}

export async function depositCargoTransfer(input: {
  tenantId: string;
  userId: string;
  transferId: string;
  toLocationBarcode: string;
  productBarcode?: string;
  /** % que a gôndola ficou depois de abastecer */
  percent?: unknown;
  /** Gôndola por quantidade: unidades que ficaram depois de abastecer */
  quantity?: unknown;
}) {
  const transfer = await prisma.cargoTransfer.findFirst({
    where: {
      id: input.transferId,
      tenantId: input.tenantId,
      status: CargoTransferStatus.IN_TRANSIT,
    },
    include: {
      product: true,
      fromLocation: true,
      targetPickFace: true,
    },
  });

  if (!transfer) {
    throw new CargoTransferError("Transporte não encontrado ou já concluído", 404);
  }

  const toBarcode = input.toLocationBarcode.trim();
  const toLoc = await prisma.location.findFirst({
    where: {
      tenantId: input.tenantId,
      barcode: { equals: toBarcode, mode: "insensitive" },
      active: true,
    },
  });

  if (!toLoc) {
    throw new CargoTransferError("Gôndola não encontrada", 404);
  }
  if (toLoc.type !== LocationType.PICK_FACE) {
    throw new CargoTransferError("Destino deve ser uma gôndola (estoque de giro)");
  }
  if (toLoc.productId && toLoc.productId !== transfer.productId) {
    throw new CargoTransferError("Gôndola já alocada para outro produto");
  }

  if (transfer.targetPickFaceId && toLoc.id !== transfer.targetPickFaceId) {
    throw new CargoTransferError(
      `Bipe a gôndola alvo (${transfer.targetPickFace?.barcode ?? "definida no transporte"})`,
    );
  }

  if (input.productBarcode?.trim()) {
    const product = await findProductByBarcode(input.tenantId, input.productBarcode);
    if (!product || product.id !== transfer.productId) {
      throw new CargoTransferError("Produto não confere com o transporte");
    }
  }

  let units: number | null = null;
  let percent: number;
  if (isQuantityMode(toLoc)) {
    try {
      units = parseUnits(input.quantity, "Quantidade que ficou na gôndola");
    } catch (e) {
      throw new CargoTransferError(e instanceof Error ? e.message : "Quantidade inválida");
    }
    percent = quantityLevelData(units, toLoc).fillPercent;
  } else {
    percent = parseTransferPercent(input.percent, "% que a gôndola ficou");
  }

  const depositedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.location.update({
      where: { id: toLoc.id },
      data: {
        productId: transfer.productId,
        ...(units !== null ? quantityLevelData(units, toLoc) : { fillPercent: percent }),
      },
    });

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        type: InventoryMovementType.REPLENISHMENT,
        quantity: transfer.quantity,
        percentBefore: toLoc.fillPercent,
        percentAfter: percent,
        userId: input.userId,
        productId: transfer.productId,
        fromLocationId: transfer.fromLocationId,
        toLocationId: toLoc.id,
        cargoTransferId: transfer.id,
        startedAt: transfer.withdrawnAt,
        completedAt: depositedAt,
        notes: "Abastecimento estoque de giro",
      },
    });

    const updated = await tx.cargoTransfer.update({
      where: { id: transfer.id },
      data: {
        status: CargoTransferStatus.COMPLETED,
        toLocationId: toLoc.id,
        depositedById: input.userId,
        depositedAt,
        depositMovementId: movement.id,
      },
      include: transferInclude,
    });

    return {
      transfer: mapCargoTransferSummary(updated),
      toLocation: {
        barcode: toLoc.barcode,
        fillPercent: percent,
        stockQuantity: units,
      },
    };
  });

  const { completeReplenishmentAssignment } = await import(
    "./replenishment-assignment.js"
  );
  await completeReplenishmentAssignment(input.tenantId, input.transferId);

  return result;
}
