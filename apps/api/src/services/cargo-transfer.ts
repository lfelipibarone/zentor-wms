import {
  CargoTransferStatus,
  InventoryMovementType,
  LocationType,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findProductByBarcode } from "./location-stock.js";

export class CargoTransferError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "CargoTransferError";
  }
}

function formatLocationLabel(loc: {
  corridor: string;
  row: string;
  barcode: string;
}) {
  return `${loc.corridor}-${loc.row} (${loc.barcode})`;
}

type TransferRow = {
  id: string;
  status: CargoTransferStatus;
  quantity: number;
  withdrawnAt: Date;
  depositedAt: Date | null;
  targetPickFaceId: string | null;
  product: { id: string; sku: string; name: string; barcode: string | null };
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
        }
      : null,
    withdrawnByName: transfer.withdrawnBy.name,
  };
}

const transferInclude = {
  product: { select: { id: true, sku: true, name: true, barcode: true } },
  fromLocation: {
    select: { id: true, barcode: true, corridor: true, row: true },
  },
  toLocation: {
    select: { id: true, barcode: true, corridor: true, row: true },
  },
  targetPickFace: {
    select: { id: true, barcode: true, corridor: true, row: true },
  },
  withdrawnBy: { select: { id: true, name: true } },
} as const;

export async function withdrawCargoTransfer(input: {
  tenantId: string;
  userId: string;
  fromLocationBarcode: string;
  productBarcode: string;
  quantity: number;
  targetPickFaceId?: string;
}) {
  const quantity = Math.floor(Number(input.quantity));
  if (quantity <= 0) {
    throw new CargoTransferError("Quantidade inválida");
  }

  const fromBarcode = input.fromLocationBarcode.trim().toUpperCase();
  const fromLoc = await prisma.location.findFirst({
    where: {
      tenantId: input.tenantId,
      barcode: fromBarcode,
      active: true,
    },
    include: { product: true },
  });

  if (!fromLoc) {
    throw new CargoTransferError("Pulmão não encontrado", 404);
  }
  if (fromLoc.type !== LocationType.PULMAO) {
    throw new CargoTransferError("Origem deve ser um pulmão");
  }

  const product = await findProductByBarcode(input.productBarcode);
  if (!product || product.tenantId !== input.tenantId) {
    throw new CargoTransferError("Produto não cadastrado", 404);
  }
  if (fromLoc.productId && fromLoc.productId !== product.id) {
    throw new CargoTransferError("Produto não corresponde ao pulmão de origem");
  }
  if (fromLoc.currentQuantity < quantity) {
    throw new CargoTransferError(
      `Estoque insuficiente no pulmão (disponível: ${fromLoc.currentQuantity})`,
    );
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
        withdrawnById: input.userId,
        withdrawnAt,
      },
    });

    const newFromQty = fromLoc.currentQuantity - quantity;
    await tx.location.update({
      where: { id: fromLoc.id },
      data: {
        productId: product.id,
        currentQuantity: newFromQty,
      },
    });

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        type: InventoryMovementType.TRANSFER,
        quantity,
        userId: input.userId,
        productId: product.id,
        fromLocationId: fromLoc.id,
        toLocationId: null,
        cargoTransferId: transfer.id,
        startedAt: withdrawnAt,
        completedAt: withdrawnAt,
        notes: "Transporte de carga — retirada do pulmão",
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
        currentQuantity: newFromQty,
      },
    };
  });

  return result;
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

  const { sortLocationsByRoute } = await import("./location-route.js");
  const tagged = transfers.map((t) => {
    const anchor = t.targetPickFace ?? t.fromLocation;
    return { ...anchor, transferId: t.id };
  });
  const sortedLocs = sortLocationsByRoute(tagged);
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
  quantity?: number;
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

  const toBarcode = input.toLocationBarcode.trim().toUpperCase();
  const toLoc = await prisma.location.findFirst({
    where: {
      tenantId: input.tenantId,
      barcode: toBarcode,
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
    const product = await findProductByBarcode(input.productBarcode);
    if (!product || product.id !== transfer.productId) {
      throw new CargoTransferError("Produto não confere com o transporte");
    }
  }

  const qty =
    input.quantity != null ? Math.floor(input.quantity) : transfer.quantity;
  if (qty !== transfer.quantity) {
    throw new CargoTransferError(
      `Informe a quantidade total do transporte (${transfer.quantity})`,
    );
  }

  const newToQty = Math.min(toLoc.currentQuantity + qty, toLoc.capacity);
  const deposited = newToQty - toLoc.currentQuantity;
  if (deposited <= 0) {
    throw new CargoTransferError("Gôndola já está na capacidade máxima");
  }

  const depositedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.location.update({
      where: { id: toLoc.id },
      data: {
        productId: transfer.productId,
        currentQuantity: newToQty,
      },
    });

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        type: InventoryMovementType.REPLENISHMENT,
        quantity: deposited,
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
        currentQuantity: newToQty,
      },
    };
  });

  return result;
}
