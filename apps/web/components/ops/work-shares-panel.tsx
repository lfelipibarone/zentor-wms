"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  WORK_STATUS_LABEL,
  formatDuration,
  type WorkShareStatus,
  type WorkShareSummary,
} from "@/lib/api/work-shares";
import { cn } from "@/lib/utils";

const REFRESH_MS = 15_000;

const STATUS_CLASS: Record<WorkShareStatus, string> = {
  RESERVED: "bg-amber-100 text-amber-900",
  STARTED: "bg-sky-100 text-sky-900",
  FINISHED: "bg-emerald-100 text-emerald-900",
  DECLINED: "bg-red-100 text-red-900",
  CANCELLED: "bg-slate-100 text-slate-600",
};

export function WorkStatusBadge({ status }: { status: WorkShareStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
        STATUS_CLASS[status],
      )}
    >
      {WORK_STATUS_LABEL[status]}
    </span>
  );
}

/** Tempo da parte; conta ao vivo enquanto está em andamento. */
export function LiveDuration({
  share,
  className,
}: {
  share: Pick<WorkShareSummary, "status" | "elapsedSec">;
  className?: string;
}) {
  const running = share.status === "STARTED";
  const receivedAt = useRef(Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    receivedAt.current = Date.now();
  }, [share.elapsedSec]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const value =
    share.elapsedSec == null
      ? null
      : running
        ? share.elapsedSec + (Date.now() - receivedAt.current) / 1000
        : share.elapsedSec;
  return (
    <span className={cn("font-mono tabular-nums", running && "font-semibold text-sky-700", className)}>
      {formatDuration(value)}
    </span>
  );
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface WorkSharesPanelProps {
  title: string;
  load: () => Promise<{ shares: WorkShareSummary[] }>;
  /** Mostra a coluna de etapa (ex.: conferência + armazenagem na mesma NF). */
  showKind?: boolean;
}

/** Partes da tarefa divididas entre agentes: responsável, status e tempo. */
export function WorkSharesPanel({ title, load, showKind }: WorkSharesPanelProps) {
  const [shares, setShares] = useState<WorkShareSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await load();
      setShares(data.shares);
    } catch {
      /* painel auxiliar: falha silenciosa mantém o último estado */
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (shares.length === 0) return null;

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {showKind ? <TableHead>Etapa</TableHead> : null}
              <TableHead>Parte</TableHead>
              <TableHead>Funcionário</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Itens</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Fim</TableHead>
              <TableHead className="text-right">Tempo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shares.map((s) => (
              <TableRow key={s.id}>
                {showKind ? <TableCell className="text-sm">{s.kindLabel}</TableCell> : null}
                <TableCell className="text-sm">
                  {s.shareIndex} de {s.shareCount}
                  {s.subtitle && s.kind === "PICK_WAVE" ? (
                    <span className="block text-xs text-muted-foreground">{s.subtitle}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {s.assignedTo.name}
                  {s.assignedBy && s.assignedBy.id !== s.assignedTo.id ? (
                    <span className="block text-xs text-muted-foreground">
                      dividida por {s.assignedBy.name}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <WorkStatusBadge status={s.status} />
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {s.itemsDone}/{s.itemsTotal}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {s.unitsDone}/{s.unitsTotal}
                </TableCell>
                <TableCell className="text-sm">{fmtTime(s.startedAt)}</TableCell>
                <TableCell className="text-sm">{fmtTime(s.finishedAt)}</TableCell>
                <TableCell className="text-right text-sm">
                  <LiveDuration share={s} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
