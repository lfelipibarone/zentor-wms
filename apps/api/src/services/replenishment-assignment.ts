import {
  CargoTransferStatus,
  ReplenishmentAssignmentStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  listReplenishmentNeeds,
  type ReplenishmentNeed,
} from "./replenishment-queue.js";

export class ReplenishmentAssignmentError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "ReplenishmentAssignmentError";
  }
}

function enrichNeed(
  need: ReplenishmentNeed,
  userId: string,
  assignment:
    | {
        id: string;
        assignedToId: string;
        status: ReplenishmentAssignmentStatus;
        assignedTo: { name: string };
      }
    | null,
) {
  const isMine = assignment?.assignedToId === userId;
  const isOpen = assignment?.status === ReplenishmentAssignmentStatus.OPEN;
  return {
    ...need,
    assignmentId: assignment?.id ?? null,
    assignedToId: assignment?.assignedToId ?? null,
    assignedToName: assignment?.assignedTo.name ?? null,
    assignmentStatus: assignment?.status ?? null,
    isMine,
    canAccept: !assignment,
    canWork: isMine && assignment != null,
  };
}

export async function listReplenishmentNeedsForMobile(
  tenantId: string,
  userId: string,
) {
  const [needs, openAssignments, inTransitFaces] = await Promise.all([
    listReplenishmentNeeds(tenantId),
    prisma.replenishmentAssignment.findMany({
      where: {
        tenantId,
        status: {
          in: [
            ReplenishmentAssignmentStatus.OPEN,
            ReplenishmentAssignmentStatus.WITHDRAWN,
          ],
        },
      },
      include: { assignedTo: { select: { id: true, name: true } } },
    }),
    prisma.cargoTransfer.findMany({
      where: { tenantId, status: CargoTransferStatus.IN_TRANSIT },
      select: { targetPickFaceId: true, withdrawnById: true, id: true },
    }),
  ]);

  const assignmentByFace = new Map(
    openAssignments.map((a) => [a.pickFaceId, a]),
  );
  const blockedFaceIds = new Set(
    inTransitFaces
      .map((t) => t.targetPickFaceId)
      .filter((id): id is string => id != null),
  );

  const publicNeeds = needs
    .filter((n) => {
      if (blockedFaceIds.has(n.pickFaceId)) {
        const mine = openAssignments.find(
          (a) =>
            a.pickFaceId === n.pickFaceId && a.assignedToId === userId,
        );
        return !!mine;
      }
      const assign = assignmentByFace.get(n.pickFaceId);
      if (!assign) return true;
      return assign.assignedToId === userId;
    })
    .map((n) =>
      enrichNeed(n, userId, assignmentByFace.get(n.pickFaceId) ?? null),
    );

  const myAssignments = openAssignments.filter((a) => a.assignedToId === userId);

  return { needs: publicNeeds, myAssignmentCount: myAssignments.length };
}

export async function acceptReplenishmentNeed(
  tenantId: string,
  pickFaceId: string,
  userId: string,
) {
  const face = await prisma.location.findFirst({
    where: { id: pickFaceId, tenantId, active: true, type: "PICK_FACE" },
    include: { product: true },
  });
  if (!face?.productId) {
    throw new ReplenishmentAssignmentError("Gôndola não encontrada", 404);
  }

  const existing = await prisma.replenishmentAssignment.findFirst({
    where: {
      pickFaceId,
      status: {
        in: [
          ReplenishmentAssignmentStatus.OPEN,
          ReplenishmentAssignmentStatus.WITHDRAWN,
        ],
      },
    },
  });
  if (existing && existing.assignedToId !== userId) {
    throw new ReplenishmentAssignmentError(
      "Reabastecimento já aceito por outro operador",
      409,
    );
  }
  if (existing?.assignedToId === userId) {
    return { assignmentId: existing.id, pickFaceId, status: existing.status };
  }

  const inTransit = await prisma.cargoTransfer.findFirst({
    where: {
      tenantId,
      targetPickFaceId: pickFaceId,
      status: CargoTransferStatus.IN_TRANSIT,
    },
  });
  if (inTransit && inTransit.withdrawnById !== userId) {
    throw new ReplenishmentAssignmentError(
      "Gôndola com transporte em andamento por outro operador",
      409,
    );
  }

  const assignment = await prisma.replenishmentAssignment.create({
    data: {
      tenantId,
      pickFaceId,
      assignedToId: userId,
      status: ReplenishmentAssignmentStatus.OPEN,
    },
  });

  return {
    assignmentId: assignment.id,
    pickFaceId,
    status: assignment.status,
  };
}

export async function releaseReplenishmentAssignment(
  tenantId: string,
  pickFaceId: string,
  userId: string,
) {
  const assignment = await prisma.replenishmentAssignment.findFirst({
    where: {
      tenantId,
      pickFaceId,
      assignedToId: userId,
      status: ReplenishmentAssignmentStatus.OPEN,
    },
  });
  if (!assignment) {
    throw new ReplenishmentAssignmentError("Nenhum aceite aberto para esta gôndola", 404);
  }

  await prisma.replenishmentAssignment.update({
    where: { id: assignment.id },
    data: {
      status: ReplenishmentAssignmentStatus.CANCELLED,
      completedAt: new Date(),
    },
  });

  return { released: true };
}

export async function markAssignmentWithdrawn(
  tenantId: string,
  pickFaceId: string,
  userId: string,
  cargoTransferId: string,
) {
  const assignment = await prisma.replenishmentAssignment.findFirst({
    where: {
      tenantId,
      pickFaceId,
      assignedToId: userId,
      status: ReplenishmentAssignmentStatus.OPEN,
    },
  });
  if (!assignment) return;

  await prisma.replenishmentAssignment.update({
    where: { id: assignment.id },
    data: {
      status: ReplenishmentAssignmentStatus.WITHDRAWN,
      cargoTransferId,
    },
  });
}

export async function completeReplenishmentAssignment(
  tenantId: string,
  cargoTransferId: string,
) {
  await prisma.replenishmentAssignment.updateMany({
    where: {
      tenantId,
      cargoTransferId,
      status: ReplenishmentAssignmentStatus.WITHDRAWN,
    },
    data: {
      status: ReplenishmentAssignmentStatus.COMPLETED,
      completedAt: new Date(),
    },
  });
}

export async function getOpenAssignmentForPickFace(
  tenantId: string,
  pickFaceId: string,
  userId: string,
) {
  return prisma.replenishmentAssignment.findFirst({
    where: {
      tenantId,
      pickFaceId,
      assignedToId: userId,
      status: {
        in: [
          ReplenishmentAssignmentStatus.OPEN,
          ReplenishmentAssignmentStatus.WITHDRAWN,
        ],
      },
    },
  });
}
