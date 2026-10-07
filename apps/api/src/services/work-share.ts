import {
  PickWaveStatus,
  PurchaseReceiptSessionStatus,
  PutawaySessionStatus,
  WorkShareKind,
  WorkShareStatus,
  type Prisma,
  type WorkShare,
} from "@prisma/client";
import { Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { createNotification, listUserIdsWithPermission } from "./notifications.js";
import { acceptPickWave, acceptPickWavePart, getReleasedWaveById } from "./pick-wave.js";

export class WorkShareError extends Error {
  constructor(
    message: string,
    public statusCode = 422,
  ) {
    super(message);
    this.name = "WorkShareError";
  }
}

/** Partes que ainda seguram itens (o cronômetro não fechou). */
export const OPEN_SHARE_STATUSES: WorkShareStatus[] = [
  WorkShareStatus.RESERVED,
  WorkShareStatus.STARTED,
  WorkShareStatus.DECLINED,
];

export const WORK_SHARE_KIND_LABEL: Record<WorkShareKind, string> = {
  PICK_WAVE: "Separação em onda",
  RECEIPT_CHECK: "Conferência NF",
  PUTAWAY: "Armazenagem",
};

export const MAX_WORK_SHARE_AGENTS = 10;

/**
 * Divide itens em `n` blocos seguidos (mantém a ordem da rota/lista), equilibrando pelo peso.
 * Cada bloco recebe pelo menos um item.
 */
export function splitIntoChunks<T>(items: T[], n: number, weight: (item: T) => number): T[][] {
  if (n < 1) throw new WorkShareError("Informe pelo menos 1 agente");
  if (items.length < n) {
    throw new WorkShareError(
      `Só há ${items.length} ${items.length === 1 ? "item" : "itens"} — divida em no máximo ${items.length} agente(s)`,
    );
  }
  const w = (item: T) => Math.max(1, weight(item));
  const chunks: T[][] = [];
  let idx = 0;
  for (let c = 0; c < n; c += 1) {
    const chunksLeft = n - c;
    if (chunksLeft === 1) {
      chunks.push(items.slice(idx));
      break;
    }
    let remaining = 0;
    for (let i = idx; i < items.length; i += 1) remaining += w(items[i]!);
    const target = remaining / chunksLeft;
    const chunk: T[] = [];
    let acc = 0;
    while (idx < items.length && items.length - idx > chunksLeft - 1) {
      const iw = w(items[idx]!);
      if (chunk.length > 0 && acc + iw - target > target - acc) break;
      chunk.push(items[idx]!);
      acc += iw;
      idx += 1;
      if (acc >= target) break;
    }
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Colegas
// ---------------------------------------------------------------------------

export async function listColleagues(tenantId: string, userId: string) {
  const ids = await listUserIdsWithPermission(Permission.MOBILE_ACCESS, tenantId);
  const users = await prisma.user.findMany({
    where: { id: { in: ids.filter((id) => id !== userId) }, tenantId, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}

async function assertAssignees(tenantId: string, assigneeIds: string[]) {
  const unique = [...new Set(assigneeIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) throw new WorkShareError("Escolha pelo menos 1 agente");
  if (unique.length !== assigneeIds.length) throw new WorkShareError("Agente repetido na divisão");
  if (unique.length > MAX_WORK_SHARE_AGENTS) {
    throw new WorkShareError(`Divida em no máximo ${MAX_WORK_SHARE_AGENTS} agentes`);
  }
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, tenantId, active: true },
    select: { id: true, name: true },
  });
  if (users.length !== unique.length) throw new WorkShareError("Agente não encontrado ou inativo", 404);
  const byId = new Map(users.map((u) => [u.id, u]));
  return unique.map((id) => byId.get(id)!);
}

// ---------------------------------------------------------------------------
// Resumo das partes (andamento + destino no app)
// ---------------------------------------------------------------------------

const shareInclude = {
  assignedTo: { select: { id: true, name: true } },
  assignedBy: { select: { id: true, name: true } },
  wave: { select: { id: true, name: true } },
  wavePart: { select: { id: true, name: true, approachWaveId: true } },
  receiptSession: { select: { id: true, invoiceNumber: true, supplierName: true } },
  putawaySession: {
    select: {
      id: true,
      purchaseReceiptId: true,
      purchaseReceipt: { select: { invoiceNumber: true, supplierName: true } },
    },
  },
} satisfies Prisma.WorkShareInclude;

type ShareWithRefs = Prisma.WorkShareGetPayload<{ include: typeof shareInclude }>;

export interface WorkShareSummary {
  id: string;
  kind: WorkShareKind;
  kindLabel: string;
  status: WorkShareStatus;
  shareIndex: number;
  shareCount: number;
  title: string;
  subtitle: string | null;
  assignedTo: { id: string; name: string };
  assignedBy: { id: string; name: string } | null;
  itemsTotal: number;
  unitsTotal: number;
  itemsDone: number;
  unitsDone: number;
  reservedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Segundos de cronômetro (até agora, se ainda está em andamento). */
  elapsedSec: number | null;
  waveId: string | null;
  wavePartId: string | null;
  receiptSessionId: string | null;
  putawaySessionId: string | null;
  route: { pathname: string; params: Record<string, string> };
}

interface ShareProgress {
  itemsDone: number;
  unitsDone: number;
  itemsTotal: number;
  unitsTotal: number;
}

async function loadProgress(shares: WorkShare[]): Promise<Map<string, ShareProgress>> {
  const out = new Map<string, ShareProgress>();
  const add = (shareId: string, done: boolean, unitsDone: number, unitsTotal: number) => {
    const p = out.get(shareId) ?? { itemsDone: 0, unitsDone: 0, itemsTotal: 0, unitsTotal: 0 };
    p.itemsTotal += 1;
    p.unitsTotal += unitsTotal;
    p.unitsDone += Math.min(unitsDone, unitsTotal);
    if (done) p.itemsDone += 1;
    out.set(shareId, p);
  };

  const waveParts = shares.filter((s) => s.kind === WorkShareKind.PICK_WAVE && s.wavePartId);
  const waveWhole = shares.filter((s) => s.kind === WorkShareKind.PICK_WAVE && !s.wavePartId && s.waveId);
  const receipt = shares.filter((s) => s.kind === WorkShareKind.RECEIPT_CHECK);
  const putaway = shares.filter((s) => s.kind === WorkShareKind.PUTAWAY);

  if (waveParts.length > 0) {
    const shareByPart = new Map(waveParts.map((s) => [s.wavePartId!, s.id]));
    const lines = await prisma.pickWaveLine.findMany({
      where: { partId: { in: [...shareByPart.keys()] } },
      select: { partId: true, quantityPicked: true, quantityTotal: true },
    });
    for (const l of lines) {
      add(shareByPart.get(l.partId!)!, l.quantityPicked >= l.quantityTotal, l.quantityPicked, l.quantityTotal);
    }
  }
  if (waveWhole.length > 0) {
    const shareByWave = new Map(waveWhole.map((s) => [s.waveId!, s.id]));
    const lines = await prisma.pickWaveLine.findMany({
      where: { waveId: { in: [...shareByWave.keys()] }, partId: null },
      select: { waveId: true, quantityPicked: true, quantityTotal: true },
    });
    for (const l of lines) {
      add(shareByWave.get(l.waveId)!, l.quantityPicked >= l.quantityTotal, l.quantityPicked, l.quantityTotal);
    }
  }
  if (receipt.length > 0) {
    const items = await prisma.purchaseReceiptItem.findMany({
      where: { workShareId: { in: receipt.map((s) => s.id) } },
      select: { workShareId: true, quantityChecked: true, quantityExpected: true },
    });
    for (const it of items) {
      const checked = Number(it.quantityChecked);
      const expected = Number(it.quantityExpected);
      add(it.workShareId!, checked >= expected, checked, expected);
    }
  }
  if (putaway.length > 0) {
    const items = await prisma.putawayItem.findMany({
      where: { workShareId: { in: putaway.map((s) => s.id) } },
      select: { workShareId: true, quantityStored: true, quantityExpected: true },
    });
    for (const it of items) {
      const stored = Number(it.quantityStored);
      const expected = Number(it.quantityExpected);
      add(it.workShareId!, stored >= expected, stored, expected);
    }
  }
  return out;
}

function shareTitle(s: ShareWithRefs): { title: string; subtitle: string | null } {
  switch (s.kind) {
    case WorkShareKind.PICK_WAVE:
      return {
        title: s.wave?.name ?? "Onda",
        subtitle: s.wavePart?.name ?? null,
      };
    case WorkShareKind.RECEIPT_CHECK:
      return {
        title: `NF ${s.receiptSession?.invoiceNumber ?? "—"}`,
        subtitle: s.receiptSession?.supplierName ?? null,
      };
    case WorkShareKind.PUTAWAY:
      return {
        title: `Armazenagem NF ${s.putawaySession?.purchaseReceipt.invoiceNumber ?? "—"}`,
        subtitle: s.putawaySession?.purchaseReceipt.supplierName ?? null,
      };
  }
}

function shareRoute(s: WorkShare): WorkShareSummary["route"] {
  switch (s.kind) {
    case WorkShareKind.PICK_WAVE:
      return {
        pathname: "/wave-picking",
        params: {
          waveId: s.waveId ?? "",
          ...(s.wavePartId ? { partId: s.wavePartId } : {}),
        },
      };
    case WorkShareKind.RECEIPT_CHECK:
      return {
        pathname: "/purchase-receipt/[sessionId]/check",
        params: { sessionId: s.receiptSessionId ?? "" },
      };
    case WorkShareKind.PUTAWAY:
      return {
        pathname: "/putaway/[sessionId]",
        params: { sessionId: s.putawaySessionId ?? "" },
      };
  }
}

export function shareElapsedSec(
  s: Pick<WorkShare, "startedAt" | "finishedAt">,
  now = new Date(),
): number | null {
  if (!s.startedAt) return null;
  const end = s.finishedAt ?? now;
  return Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 1000));
}

async function summarize(shares: ShareWithRefs[]): Promise<WorkShareSummary[]> {
  const progress = await loadProgress(shares);
  const now = new Date();
  return shares.map((s) => {
    const p = progress.get(s.id);
    const { title, subtitle } = shareTitle(s);
    return {
      id: s.id,
      kind: s.kind,
      kindLabel: WORK_SHARE_KIND_LABEL[s.kind],
      status: s.status,
      shareIndex: s.shareIndex,
      shareCount: s.shareCount,
      title,
      subtitle,
      assignedTo: s.assignedTo,
      assignedBy: s.assignedBy,
      itemsTotal: p?.itemsTotal ?? s.itemsTotal,
      unitsTotal: p?.unitsTotal ?? s.unitsTotal,
      itemsDone: p?.itemsDone ?? 0,
      unitsDone: p?.unitsDone ?? 0,
      reservedAt: s.reservedAt.toISOString(),
      startedAt: s.startedAt?.toISOString() ?? null,
      finishedAt: s.finishedAt?.toISOString() ?? null,
      elapsedSec: shareElapsedSec(s, now),
      waveId: s.waveId,
      wavePartId: s.wavePartId,
      receiptSessionId: s.receiptSessionId,
      putawaySessionId: s.putawaySessionId,
      route: shareRoute(s),
    };
  });
}

export async function summarizeSharesWhere(
  where: Prisma.WorkShareWhereInput,
  options: { orderBy?: Prisma.WorkShareOrderByWithRelationInput[]; take?: number } = {},
) {
  const shares = await prisma.workShare.findMany({
    where,
    include: shareInclude,
    orderBy: options.orderBy ?? [{ reservedAt: "asc" }, { shareIndex: "asc" }],
    take: options.take,
  });
  return summarize(shares);
}

export async function summarizeShareIds(ids: string[]) {
  if (ids.length === 0) return [];
  const shares = await prisma.workShare.findMany({
    where: { id: { in: ids } },
    include: shareInclude,
    orderBy: [{ shareIndex: "asc" }],
  });
  return summarize(shares);
}

/** Partes abertas (ou já terminadas) de uma tarefa, e a do usuário. */
export async function getWorkForRef(
  ref:
    | { kind: "PICK_WAVE"; waveId: string; partId?: string | null }
    | { kind: "RECEIPT_CHECK"; receiptSessionId: string }
    | { kind: "PUTAWAY"; putawaySessionId: string },
  userId: string,
): Promise<{ mine: WorkShareSummary | null; shares: WorkShareSummary[] }> {
  const notCancelled = { status: { not: WorkShareStatus.CANCELLED } };
  let where: Prisma.WorkShareWhereInput;
  if (ref.kind === "PICK_WAVE") {
    where = { waveId: ref.waveId, ...notCancelled };
  } else if (ref.kind === "RECEIPT_CHECK") {
    where = { receiptSessionId: ref.receiptSessionId, kind: WorkShareKind.RECEIPT_CHECK, ...notCancelled };
  } else {
    where = { putawaySessionId: ref.putawaySessionId, kind: WorkShareKind.PUTAWAY, ...notCancelled };
  }
  const shares = await prisma.workShare.findMany({
    where,
    include: shareInclude,
    orderBy: [{ reservedAt: "asc" }, { shareIndex: "asc" }],
  });
  const summaries = await summarize(shares);
  let mine: WorkShareSummary | undefined;
  if (ref.kind === "PICK_WAVE" && ref.partId) {
    mine = summaries.find((s) => s.wavePartId === ref.partId && s.assignedTo.id === userId);
  }
  mine ??= summaries.find(
    (s) => s.assignedTo.id === userId && s.status !== WorkShareStatus.FINISHED,
  );
  mine ??= summaries.find((s) => s.assignedTo.id === userId);
  return { mine: mine ?? null, shares: summaries };
}

/** Partes do usuário em aberto + partes que ele dividiu e foram recusadas. */
export async function listMyWork(tenantId: string, userId: string) {
  const shares = await prisma.workShare.findMany({
    where: {
      tenantId,
      OR: [
        {
          assignedToId: userId,
          status: { in: [WorkShareStatus.RESERVED, WorkShareStatus.STARTED] },
        },
        { assignedById: userId, status: WorkShareStatus.DECLINED },
      ],
    },
    include: shareInclude,
    orderBy: [{ reservedAt: "desc" }],
    take: 50,
  });
  return summarize(shares);
}

// ---------------------------------------------------------------------------
// Dividir / aceitar
// ---------------------------------------------------------------------------

export interface SplitWorkInput {
  tenantId: string;
  kind: WorkShareKind;
  /** Onda: waveId · NF: sessão do recebimento · Armazenagem: sessão do recebimento (NF conferida) */
  refId: string;
  /** Onda dividida por área: parte que está sendo aceita */
  partId?: string | null;
  assigneeIds: string[];
  byUserId: string;
}

export async function splitWork(input: SplitWorkInput) {
  const assignees = await assertAssignees(input.tenantId, input.assigneeIds);
  let shareIds: string[];
  switch (input.kind) {
    case WorkShareKind.PICK_WAVE:
      shareIds = await splitWave(input, assignees);
      break;
    case WorkShareKind.RECEIPT_CHECK:
      shareIds = await splitReceiptCheck(input, assignees);
      break;
    case WorkShareKind.PUTAWAY:
      shareIds = await splitPutaway(input, assignees);
      break;
    default:
      throw new WorkShareError("Tipo de tarefa inválido", 400);
  }
  const shares = await summarizeShareIds(shareIds);
  await notifyAssignees(shares, input.byUserId);
  return {
    shares,
    mine: shares.find((s) => s.assignedTo.id === input.byUserId) ?? null,
  };
}

async function notifyAssignees(shares: WorkShareSummary[], byUserId: string) {
  const by = shares.find((s) => s.assignedBy)?.assignedBy?.name;
  await Promise.all(
    shares
      .filter((s) => s.assignedTo.id !== byUserId)
      .map((s) =>
        createNotification({
          userId: s.assignedTo.id,
          title: `Nova tarefa: ${s.kindLabel}`,
          body: `${by ?? "Um colega"} dividiu ${s.title} com você — parte ${s.shareIndex} de ${s.shareCount} (${s.itemsTotal} itens). Toque para abrir.`,
          category: "WORK",
          data: { type: "work_share", shareId: s.id, kind: s.kind, route: s.route },
        }).catch(() => undefined),
      ),
  );
}

type Assignee = { id: string; name: string };

async function splitWave(input: SplitWorkInput, assignees: Assignee[]): Promise<string[]> {
  const wave = await getReleasedWaveById(input.tenantId, input.refId);
  if (!wave) throw new WorkShareError("Onda não encontrada ou não liberada", 404);

  let part: (typeof wave.parts)[number] | null = null;
  if (wave.parts.length > 0) {
    if (input.partId) {
      part = wave.parts.find((p) => p.id === input.partId) ?? null;
      if (!part) throw new WorkShareError("Parte da onda não encontrada", 404);
    } else {
      part =
        wave.parts.find(
          (p) =>
            !p.acceptedById &&
            wave.lines.some((l) => l.partId === p.id && l.quantityPicked < l.quantityTotal),
        ) ?? null;
      if (!part) throw new WorkShareError("Todas as partes desta onda já foram aceitas", 409);
    }
  }

  const owner = part ? part.acceptedById : wave.acceptedById;
  const ownerName = part ? part.acceptedBy?.name : wave.acceptedBy?.name;
  if (owner && owner !== input.byUserId) {
    throw new WorkShareError(`Já aceita por ${ownerName ?? "outro operador"}`, 409);
  }

  const scopeWhere: Prisma.WorkShareWhereInput = part
    ? { wavePartId: part.id }
    : { waveId: wave.id, wavePartId: null };
  const open = await prisma.workShare.findMany({
    where: { ...scopeWhere, status: { in: OPEN_SHARE_STATUSES } },
  });
  if (open.length > 0) {
    const mine = open.find((s) => s.assignedToId === assignees[0]!.id);
    if (assignees.length === 1 && mine) return [mine.id];
    throw new WorkShareError("Esta onda já foi aceita/dividida", 409);
  }

  const lines = wave.lines.filter((l) => (part ? l.partId === part.id : !l.partId));
  if (lines.length === 0) throw new WorkShareError("Nada para separar nesta onda", 409);
  const unitsOf = (ls: typeof lines) => ls.reduce((sum, l) => sum + l.quantityTotal, 0);

  if (assignees.length === 1) {
    const agent = assignees[0]!;
    if (part) await acceptPickWavePart(part.id, agent.id);
    else await acceptPickWave(wave.id, agent.id);
    const share = await prisma.workShare.create({
      data: {
        tenantId: input.tenantId,
        kind: WorkShareKind.PICK_WAVE,
        assignedToId: agent.id,
        assignedById: agent.id === input.byUserId ? null : input.byUserId,
        waveId: wave.id,
        wavePartId: part?.id ?? null,
        itemsTotal: lines.length,
        unitsTotal: unitsOf(lines),
      },
    });
    return [share.id];
  }

  if (lines.some((l) => l.quantityPicked > 0)) {
    throw new WorkShareError("A separação desta onda já começou — não dá mais para dividir", 409);
  }
  const chunks = splitIntoChunks(lines, assignees.length, (l) => l.quantityTotal);
  const n = assignees.length;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    if (part) {
      const claimed = await tx.pickWavePart.updateMany({
        where: { id: part.id, OR: [{ acceptedById: null }, { acceptedById: input.byUserId }] },
        data: { acceptedById: input.byUserId, acceptedAt: now },
      });
      if (claimed.count === 0) throw new WorkShareError("Esta parte já foi aceita por outro operador", 409);
    } else {
      const claimed = await tx.pickWave.updateMany({
        where: {
          id: wave.id,
          status: PickWaveStatus.RELEASED,
          OR: [{ acceptedById: null }, { acceptedById: input.byUserId }],
        },
        data: { acceptedById: input.byUserId, acceptedAt: now },
      });
      if (claimed.count === 0) throw new WorkShareError("Esta onda já foi aceita por outro operador", 409);
    }

    const ids: string[] = [];
    for (let k = 0; k < n; k += 1) {
      const agent = assignees[k]!;
      const chunk = chunks[k]!;
      const name = part ? `${part.name} · ${k + 1}/${n}` : `Parte ${k + 1}/${n}`;
      let partId: string;
      if (k === 0 && part) {
        await tx.pickWavePart.update({
          where: { id: part.id },
          data: { name, acceptedById: agent.id, acceptedAt: now },
        });
        partId = part.id;
      } else {
        const created = await tx.pickWavePart.create({
          data: {
            waveId: wave.id,
            approachWaveId: part?.approachWaveId ?? null,
            name,
            color: part?.color ?? null,
            sortOrder: part ? part.sortOrder : k,
            acceptedById: agent.id,
            acceptedAt: now,
          },
        });
        partId = created.id;
      }
      await tx.pickWaveLine.updateMany({
        where: { id: { in: chunk.map((l) => l.id) } },
        data: { partId },
      });
      const share = await tx.workShare.create({
        data: {
          tenantId: input.tenantId,
          kind: WorkShareKind.PICK_WAVE,
          assignedToId: agent.id,
          assignedById: input.byUserId,
          shareIndex: k + 1,
          shareCount: n,
          waveId: wave.id,
          wavePartId: partId,
          itemsTotal: chunk.length,
          unitsTotal: unitsOf(chunk),
          reservedAt: now,
        },
      });
      ids.push(share.id);
    }
    return ids;
  });
}

async function splitReceiptCheck(input: SplitWorkInput, assignees: Assignee[]): Promise<string[]> {
  const session = await prisma.purchaseReceiptSession.findFirst({
    where: { id: input.refId, tenantId: input.tenantId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  if (!session) throw new WorkShareError("Recebimento não encontrado", 404);
  if (
    session.status === PurchaseReceiptSessionStatus.COMPLETED ||
    session.status === PurchaseReceiptSessionStatus.CANCELLED
  ) {
    throw new WorkShareError("Conferência já finalizada", 409);
  }
  const open = await prisma.workShare.findMany({
    where: {
      receiptSessionId: session.id,
      kind: WorkShareKind.RECEIPT_CHECK,
      status: { in: OPEN_SHARE_STATUSES },
    },
  });
  if (open.length > 0) {
    const mine = open.find((s) => s.assignedToId === assignees[0]!.id);
    if (assignees.length === 1 && mine) return [mine.id];
    throw new WorkShareError("Esta NF já foi aceita/dividida", 409);
  }

  const pending = session.items.filter((it) => Number(it.quantityChecked) < Number(it.quantityExpected));
  if (pending.length === 0) throw new WorkShareError("Todos os itens já foram conferidos", 409);
  const remainingOf = (it: (typeof pending)[number]) =>
    Number(it.quantityExpected) - Number(it.quantityChecked);
  const chunks = splitIntoChunks(pending, assignees.length, remainingOf);
  return createItemShares({
    input,
    assignees,
    chunks,
    kind: WorkShareKind.RECEIPT_CHECK,
    ref: { receiptSessionId: session.id },
    units: (chunk) => Math.round(chunk.reduce((sum, it) => sum + remainingOf(it), 0)),
    assignItems: (tx, ids, shareId) =>
      tx.purchaseReceiptItem.updateMany({ where: { id: { in: ids } }, data: { workShareId: shareId } }),
  });
}

async function splitPutaway(input: SplitWorkInput, assignees: Assignee[]): Promise<string[]> {
  const receipt = await prisma.purchaseReceiptSession.findFirst({
    where: { id: input.refId, tenantId: input.tenantId },
    include: { putaway: { include: { assignedTo: { select: { name: true } } } } },
  });
  if (!receipt) throw new WorkShareError("Recebimento não encontrado", 404);
  if (receipt.putaway) {
    if (receipt.putaway.status === PutawaySessionStatus.COMPLETED) {
      throw new WorkShareError("Armazenagem já finalizada", 409);
    }
    const open = await prisma.workShare.findMany({
      where: {
        putawaySessionId: receipt.putaway.id,
        kind: WorkShareKind.PUTAWAY,
        status: { in: OPEN_SHARE_STATUSES },
      },
    });
    if (open.length > 0) {
      const mine = open.find((s) => s.assignedToId === assignees[0]!.id);
      if (assignees.length === 1 && mine) return [mine.id];
      throw new WorkShareError("Esta armazenagem já foi aceita/dividida", 409);
    }
    if (
      receipt.putaway.status === PutawaySessionStatus.IN_PROGRESS &&
      receipt.putaway.assignedToId &&
      receipt.putaway.assignedToId !== input.byUserId
    ) {
      throw new WorkShareError(
        `Armazenagem em andamento por ${receipt.putaway.assignedTo?.name ?? "outro operador"}`,
        409,
      );
    }
  }

  const { ensurePutawaySession } = await import("./putaway.js");
  const session = await ensurePutawaySession(receipt.id, input.byUserId);
  if (!session) throw new WorkShareError("Sessão de armazenagem não encontrada", 404);
  const pending = session.items.filter((it) => Number(it.quantityStored) < Number(it.quantityExpected));
  if (pending.length === 0) throw new WorkShareError("Todos os itens já foram armazenados", 409);
  const remainingOf = (it: (typeof pending)[number]) =>
    Number(it.quantityExpected) - Number(it.quantityStored);
  const chunks = splitIntoChunks(pending, assignees.length, remainingOf);
  return createItemShares({
    input,
    assignees,
    chunks,
    kind: WorkShareKind.PUTAWAY,
    ref: { putawaySessionId: session.id },
    units: (chunk) => Math.round(chunk.reduce((sum, it) => sum + remainingOf(it), 0)),
    assignItems: (tx, ids, shareId) =>
      tx.putawayItem.updateMany({ where: { id: { in: ids } }, data: { workShareId: shareId } }),
  });
}

async function createItemShares<T extends { id: string }>(params: {
  input: SplitWorkInput;
  assignees: Assignee[];
  chunks: T[][];
  kind: WorkShareKind;
  ref: { receiptSessionId?: string; putawaySessionId?: string };
  units: (chunk: T[]) => number;
  assignItems: (tx: Prisma.TransactionClient, ids: string[], shareId: string) => Promise<unknown>;
}): Promise<string[]> {
  const { input, assignees, chunks } = params;
  const n = assignees.length;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (let k = 0; k < n; k += 1) {
      const agent = assignees[k]!;
      const chunk = chunks[k]!;
      const share = await tx.workShare.create({
        data: {
          tenantId: input.tenantId,
          kind: params.kind,
          assignedToId: agent.id,
          assignedById: n === 1 && agent.id === input.byUserId ? null : input.byUserId,
          shareIndex: k + 1,
          shareCount: n,
          ...params.ref,
          itemsTotal: chunk.length,
          unitsTotal: params.units(chunk),
          reservedAt: now,
        },
      });
      await params.assignItems(
        tx,
        chunk.map((it) => it.id),
        share.id,
      );
      ids.push(share.id);
    }
    return ids;
  });
}

// ---------------------------------------------------------------------------
// Iniciar / recusar / repassar / concluir
// ---------------------------------------------------------------------------

async function loadShare(shareId: string, tenantId: string) {
  const share = await prisma.workShare.findFirst({
    where: { id: shareId, tenantId },
    include: shareInclude,
  });
  if (!share) throw new WorkShareError("Parte não encontrada", 404);
  return share;
}

export async function startShare(shareId: string, tenantId: string, userId: string) {
  const share = await loadShare(shareId, tenantId);
  if (share.assignedToId !== userId) {
    throw new WorkShareError(`Esta parte é de ${share.assignedTo.name}`, 403);
  }
  if (share.status === WorkShareStatus.RESERVED) {
    const startedAt = new Date();
    const updated = await prisma.workShare.updateMany({
      where: { id: share.id, status: WorkShareStatus.RESERVED },
      data: { status: WorkShareStatus.STARTED, startedAt },
    });
    if (updated.count > 0 && share.kind === WorkShareKind.RECEIPT_CHECK && share.receiptSessionId) {
      const { markConferenceStarted } = await import("./tiny-purchase-receipt.js");
      await markConferenceStarted(share.receiptSessionId, userId);
    }
  } else if (share.status !== WorkShareStatus.STARTED) {
    throw new WorkShareError("Esta parte não pode mais ser iniciada", 409);
  }
  return (await summarizeShareIds([share.id]))[0]!;
}

export async function declineShare(shareId: string, tenantId: string, userId: string) {
  const share = await loadShare(shareId, tenantId);
  if (share.assignedToId !== userId) {
    throw new WorkShareError(`Esta parte é de ${share.assignedTo.name}`, 403);
  }
  if (share.status !== WorkShareStatus.RESERVED) {
    throw new WorkShareError("Só dá para recusar antes de iniciar", 409);
  }
  if (!share.assignedById || share.assignedById === userId) {
    throw new WorkShareError("Esta parte é sua — use Cancelar aceite", 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.workShare.update({
      where: { id: share.id },
      data: { status: WorkShareStatus.DECLINED },
    });
    if (share.wavePartId) {
      await tx.pickWavePart.update({
        where: { id: share.wavePartId },
        data: { acceptedById: null, acceptedAt: null },
      });
    }
  });
  const [summary] = await summarizeShareIds([share.id]);
  await createNotification({
    userId: share.assignedById,
    title: "Parte recusada",
    body: `${share.assignedTo.name} recusou a parte ${share.shareIndex} de ${share.shareCount} de ${summary!.title}. Passe para outro colega ou assuma.`,
    category: "WORK",
    data: {
      type: "work_share_declined",
      shareId: share.id,
      kind: share.kind,
      route: { pathname: "/minhas-tarefas", params: {} },
    },
  }).catch(() => undefined);
  return summary!;
}

export async function reassignShare(
  shareId: string,
  tenantId: string,
  byUserId: string,
  toUserId: string,
) {
  const share = await loadShare(shareId, tenantId);
  const canReassign = share.assignedById === byUserId || share.assignedToId === byUserId;
  if (!canReassign) throw new WorkShareError("Só quem dividiu pode repassar esta parte", 403);
  if (share.status !== WorkShareStatus.RESERVED && share.status !== WorkShareStatus.DECLINED) {
    throw new WorkShareError("Só dá para repassar uma parte que ainda não começou", 409);
  }
  const [to] = await assertAssignees(tenantId, [toUserId]);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.workShare.update({
      where: { id: share.id },
      data: {
        assignedToId: to!.id,
        assignedById: share.assignedById ?? byUserId,
        status: WorkShareStatus.RESERVED,
        reservedAt: now,
      },
    });
    if (share.wavePartId) {
      await tx.pickWavePart.update({
        where: { id: share.wavePartId },
        data: { acceptedById: to!.id, acceptedAt: now },
      });
    }
  });
  const summaries = await summarizeShareIds([share.id]);
  if (to!.id !== byUserId) await notifyAssignees(summaries, byUserId);
  return summaries[0]!;
}

/** Cancela partes que ainda não começaram (ex.: aceite da onda cancelado). */
export async function cancelOpenWaveShares(scope: { waveId: string; partId?: string | null }) {
  await prisma.workShare.updateMany({
    where: {
      ...(scope.partId ? { wavePartId: scope.partId } : { waveId: scope.waveId, wavePartId: null }),
      status: { in: OPEN_SHARE_STATUSES },
    },
    data: { status: WorkShareStatus.CANCELLED },
  });
}

/** Onda fechada no site: fecha cronômetros em andamento e cancela o que nem começou. */
export async function closeWaveShares(waveId: string) {
  const now = new Date();
  await prisma.workShare.updateMany({
    where: { waveId, status: WorkShareStatus.STARTED },
    data: { status: WorkShareStatus.FINISHED, finishedAt: now },
  });
  await prisma.workShare.updateMany({
    where: { waveId, status: { in: [WorkShareStatus.RESERVED, WorkShareStatus.DECLINED] } },
    data: { status: WorkShareStatus.CANCELLED },
  });
}

/** Para o cronômetro quando todos os itens da parte terminaram. */
export async function finishShareIfDone(shareId: string): Promise<boolean> {
  const share = await prisma.workShare.findUnique({ where: { id: shareId } });
  if (!share || share.status !== WorkShareStatus.STARTED) return false;
  const progress = (await loadProgress([share])).get(share.id);
  if (!progress || progress.itemsDone < progress.itemsTotal) return false;
  const updated = await prisma.workShare.updateMany({
    where: { id: share.id, status: WorkShareStatus.STARTED },
    data: { status: WorkShareStatus.FINISHED, finishedAt: new Date() },
  });
  return updated.count > 0;
}

function assertOwnStartedShare(
  share: { assignedToId: string; status: WorkShareStatus; assignedTo?: { name: string } | null },
  userId: string,
  what: string,
) {
  if (share.assignedToId !== userId) {
    throw new WorkShareError(`Esse item é da parte de ${share.assignedTo?.name ?? "outro operador"}`, 403);
  }
  if (share.status === WorkShareStatus.RESERVED) {
    throw new WorkShareError(`Toque em Iniciar para começar ${what}`, 409);
  }
  if (share.status === WorkShareStatus.DECLINED) {
    throw new WorkShareError("Você recusou esta parte", 409);
  }
  if (share.status === WorkShareStatus.CANCELLED) {
    throw new WorkShareError("Esta parte foi cancelada", 409);
  }
}

/**
 * Onda: exige a parte do próprio usuário iniciada.
 * Sem parte registrada (aceite antigo), mantém o comportamento anterior.
 */
export async function assertWaveShareStarted(
  waveId: string,
  partId: string | null,
  userId: string,
): Promise<string | null> {
  const share = await prisma.workShare.findFirst({
    where: {
      ...(partId ? { wavePartId: partId } : { waveId, wavePartId: null }),
      status: { not: WorkShareStatus.CANCELLED },
    },
    orderBy: { reservedAt: "desc" },
    include: { assignedTo: { select: { name: true } } },
  });
  if (!share) return null;
  if (share.status === WorkShareStatus.FINISHED) return share.id;
  assertOwnStartedShare(share, userId, "sua parte da onda");
  return share.id;
}

/** NF / armazenagem: exige que o item seja da parte iniciada do próprio usuário. */
export async function assertItemShareStarted(
  workShareId: string | null,
  userId: string,
): Promise<string | null> {
  if (!workShareId) return null;
  const share = await prisma.workShare.findUnique({
    where: { id: workShareId },
    include: { assignedTo: { select: { name: true } } },
  });
  if (!share || share.status === WorkShareStatus.FINISHED) return share?.id ?? null;
  assertOwnStartedShare(share, userId, "sua parte");
  return share.id;
}

/** Partes do usuário (abertas) numa NF/armazenagem — para preferir os itens dele no bip. */
export async function openShareIdsForUser(
  where: { receiptSessionId: string } | { putawaySessionId: string },
  userId: string,
) {
  const shares = await prisma.workShare.findMany({
    where: { ...where, assignedToId: userId, status: { in: OPEN_SHARE_STATUSES } },
    select: { id: true },
  });
  return new Set(shares.map((s) => s.id));
}

export async function hasShares(
  where: { receiptSessionId: string } | { putawaySessionId: string },
) {
  return (await prisma.workShare.count({ where: { ...where, status: { not: WorkShareStatus.CANCELLED } } })) > 0;
}
