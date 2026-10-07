import { WorkShareKind, WorkShareStatus, type Prisma } from "@prisma/client";
import { fmtDateBr, type ReportColumn, type ReportResult } from "./report-types.js";
import {
  WORK_SHARE_KIND_LABEL,
  summarizeSharesWhere,
  type WorkShareSummary,
} from "./work-share.js";

const REPORT_ROW_LIMIT = 5000;

const STATUS_LABEL: Record<WorkShareStatus, string> = {
  RESERVED: "Aguardando início",
  STARTED: "Em andamento",
  FINISHED: "Concluída",
  DECLINED: "Recusada",
  CANCELLED: "Cancelada",
};

const KIND_ORDER: WorkShareKind[] = [
  WorkShareKind.RECEIPT_CHECK,
  WorkShareKind.PUTAWAY,
  WorkShareKind.PICK_WAVE,
];

export interface WorkTimeByUserStageRow {
  userId: string;
  userName: string;
  kind: WorkShareKind;
  kindLabel: string;
  tasks: number;
  items: number;
  units: number;
  totalSec: number;
  avgSec: number;
  unitsPerHour: number | null;
}

export function formatHms(totalSec: number | null | undefined): string | null {
  if (totalSec == null) return null;
  const s = Math.max(0, Math.round(totalSec));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Agrupa partes concluídas por funcionário e etapa. */
export function aggregateByUserStage(shares: WorkShareSummary[]): WorkTimeByUserStageRow[] {
  const groups = new Map<string, WorkTimeByUserStageRow>();
  for (const s of shares) {
    if (s.status !== WorkShareStatus.FINISHED || s.elapsedSec == null) continue;
    const key = `${s.assignedTo.id}:${s.kind}`;
    const row = groups.get(key) ?? {
      userId: s.assignedTo.id,
      userName: s.assignedTo.name,
      kind: s.kind,
      kindLabel: WORK_SHARE_KIND_LABEL[s.kind],
      tasks: 0,
      items: 0,
      units: 0,
      totalSec: 0,
      avgSec: 0,
      unitsPerHour: null,
    };
    row.tasks += 1;
    row.items += s.itemsDone;
    row.units += s.unitsDone;
    row.totalSec += s.elapsedSec;
    groups.set(key, row);
  }
  return [...groups.values()]
    .map((r) => ({
      ...r,
      avgSec: r.tasks > 0 ? Math.round(r.totalSec / r.tasks) : 0,
      unitsPerHour: r.totalSec > 0 ? Math.round((r.units / r.totalSec) * 3600 * 10) / 10 : null,
    }))
    .sort(
      (a, b) =>
        a.userName.localeCompare(b.userName, "pt-BR") ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
}

function finishedInRange(tenantId: string, from: Date, to: Date): Prisma.WorkShareWhereInput {
  return {
    tenantId,
    status: WorkShareStatus.FINISHED,
    finishedAt: { gte: from, lte: to },
  };
}

export async function getWorkTimeByUserStage(tenantId: string, from: Date, to: Date) {
  const shares = await summarizeSharesWhere(finishedInRange(tenantId, from, to), {
    take: REPORT_ROW_LIMIT,
  });
  return aggregateByUserStage(shares);
}

export async function listWorkInProgress(tenantId: string) {
  return summarizeSharesWhere(
    { tenantId, status: WorkShareStatus.STARTED },
    { orderBy: [{ startedAt: "asc" }] },
  );
}

/** Painel: tempo de hoje por funcionário/etapa + quem está com cronômetro rodando. */
export async function getDashboardWorkShares(tenantId: string) {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const [byUserStage, inProgress] = await Promise.all([
    getWorkTimeByUserStage(tenantId, from, now),
    listWorkInProgress(tenantId),
  ]);
  return { byUserStage, inProgress, updatedAt: now.toISOString() };
}

const BY_USER_STAGE_COLUMNS: ReportColumn[] = [
  { key: "funcionario", header: "Funcionário" },
  { key: "etapa", header: "Etapa" },
  { key: "tarefas", header: "Partes concluídas" },
  { key: "itens", header: "Itens" },
  { key: "unidades", header: "Unidades" },
  { key: "tempoTotal", header: "Tempo total" },
  { key: "tempoTotalSeg", header: "Tempo total (s)" },
  { key: "tempoMedio", header: "Tempo médio por parte" },
  { key: "tempoMedioSeg", header: "Tempo médio (s)" },
  { key: "unidadesHora", header: "Unidades/hora" },
];

const SHARES_COLUMNS: ReportColumn[] = [
  { key: "etapa", header: "Etapa" },
  { key: "tarefa", header: "Tarefa" },
  { key: "detalhe", header: "Detalhe" },
  { key: "parte", header: "Parte" },
  { key: "funcionario", header: "Funcionário" },
  { key: "divididaPor", header: "Dividida por" },
  { key: "status", header: "Status" },
  { key: "reservadaEm", header: "Reservada em" },
  { key: "inicio", header: "Início" },
  { key: "fim", header: "Fim" },
  { key: "duracao", header: "Duração" },
  { key: "duracaoSeg", header: "Duração (s)" },
  { key: "itens", header: "Itens" },
  { key: "unidades", header: "Unidades" },
];

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function buildWorkTimeByUserStageReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ReportResult> {
  const rows = (await getWorkTimeByUserStage(tenantId, from, to)).map((r) => ({
    funcionario: r.userName,
    etapa: r.kindLabel,
    tarefas: r.tasks,
    itens: r.items,
    unidades: r.units,
    tempoTotal: formatHms(r.totalSec),
    tempoTotalSeg: r.totalSec,
    tempoMedio: formatHms(r.avgSec),
    tempoMedioSeg: r.avgSec,
    unidadesHora: r.unitsPerHour,
  }));
  return {
    report: "work_time_by_user_stage",
    title: "Tempo por funcionário e etapa",
    from: isoDay(from),
    to: isoDay(to),
    columns: BY_USER_STAGE_COLUMNS,
    rows,
    totalRows: rows.length,
  };
}

export async function buildWorkSharesReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ReportResult> {
  const range = { gte: from, lte: to };
  const shares = await summarizeSharesWhere(
    {
      tenantId,
      status: { not: WorkShareStatus.CANCELLED },
      OR: [{ reservedAt: range }, { startedAt: range }, { finishedAt: range }],
    },
    { orderBy: [{ reservedAt: "desc" }, { shareIndex: "asc" }], take: REPORT_ROW_LIMIT },
  );
  const rows = shares.map((s) => ({
    etapa: s.kindLabel,
    tarefa: s.title,
    detalhe: s.subtitle,
    parte: `${s.shareIndex} de ${s.shareCount}`,
    funcionario: s.assignedTo.name,
    divididaPor: s.assignedBy?.name ?? null,
    status: STATUS_LABEL[s.status],
    reservadaEm: fmtDateBr(new Date(s.reservedAt)),
    inicio: s.startedAt ? fmtDateBr(new Date(s.startedAt)) : null,
    fim: s.finishedAt ? fmtDateBr(new Date(s.finishedAt)) : null,
    duracao: formatHms(s.elapsedSec),
    duracaoSeg: s.elapsedSec,
    itens: `${s.itemsDone}/${s.itemsTotal}`,
    unidades: `${s.unitsDone}/${s.unitsTotal}`,
  }));
  return {
    report: "work_shares",
    title: "Partes de tarefas por funcionário",
    from: isoDay(from),
    to: isoDay(to),
    columns: SHARES_COLUMNS,
    rows,
    totalRows: rows.length,
  };
}
