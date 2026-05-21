export type CollectionUrgencyLevel =
  | "unknown"
  | "overdue"
  | "critical"
  | "warning"
  | "soon"
  | "today"
  | "ok";

export type CollectionUrgency = {
  level: CollectionUrgencyLevel;
  /** Cor da bolinha (hex) — web e mobile */
  dotColor: string;
  /** Horário formatado para exibição, ou texto de status */
  timeLabel: string;
  /** Texto curto de contexto (ex.: "Atrasado", "Coleta em 1h30") */
  hint: string;
  hoursUntil: number | null;
  isOverdue: boolean;
  hasDeadline: boolean;
};

const COLORS: Record<CollectionUrgencyLevel, string> = {
  unknown: "#94a3b8",
  overdue: "#dc2626",
  critical: "#ea580c",
  warning: "#d97706",
  soon: "#ca8a04",
  today: "#16a34a",
  ok: "#64748b",
};

function parseDeadline(
  deadline: string | Date | null | undefined,
): Date | null {
  if (deadline == null) return null;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTimePt(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTimePt(d: Date, now: Date): string {
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatTimePt(d);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Urgência visual da coleta com base no horário limite. */
export function getCollectionUrgency(
  deadlineInput: string | Date | null | undefined,
  now = new Date(),
): CollectionUrgency {
  const deadline = parseDeadline(deadlineInput);
  if (!deadline) {
    return {
      level: "unknown",
      dotColor: COLORS.unknown,
      timeLabel: "Sem coleta",
      hint: "Prazo não informado",
      hoursUntil: null,
      isOverdue: false,
      hasDeadline: false,
    };
  }

  const msUntil = deadline.getTime() - now.getTime();
  const hoursUntil = msUntil / (1000 * 60 * 60);
  const timeLabel = formatDateTimePt(deadline, now);

  if (msUntil <= 0) {
    return {
      level: "overdue",
      dotColor: COLORS.overdue,
      timeLabel,
      hint: "Atrasado — coleta já passou",
      hoursUntil,
      isOverdue: true,
      hasDeadline: true,
    };
  }

  if (hoursUntil <= 2) {
    const mins = Math.max(1, Math.round(msUntil / 60000));
    return {
      level: "critical",
      dotColor: COLORS.critical,
      timeLabel,
      hint:
        mins < 60
          ? `Coleta em ${mins} min`
          : `Coleta em ${Math.floor(hoursUntil)}h${Math.round((hoursUntil % 1) * 60)}`,
      hoursUntil,
      isOverdue: false,
      hasDeadline: true,
    };
  }

  if (hoursUntil <= 4) {
    return {
      level: "warning",
      dotColor: COLORS.warning,
      timeLabel,
      hint: `Coleta em ${Math.round(hoursUntil)}h`,
      hoursUntil,
      isOverdue: false,
      hasDeadline: true,
    };
  }

  if (hoursUntil <= 8) {
    return {
      level: "soon",
      dotColor: COLORS.soon,
      timeLabel,
      hint: `Coleta em ${Math.round(hoursUntil)}h`,
      hoursUntil,
      isOverdue: false,
      hasDeadline: true,
    };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (deadline >= start && deadline <= end) {
    return {
      level: "today",
      dotColor: COLORS.today,
      timeLabel,
      hint: "Coleta hoje",
      hoursUntil,
      isOverdue: false,
      hasDeadline: true,
    };
  }

  return {
    level: "ok",
    dotColor: COLORS.ok,
    timeLabel,
    hint: "Prazo confortável",
    hoursUntil,
    isOverdue: false,
    hasDeadline: true,
  };
}

export function collectionUrgencyTailwindDot(
  level: CollectionUrgencyLevel,
): string {
  switch (level) {
    case "overdue":
      return "bg-red-600";
    case "critical":
      return "bg-orange-600";
    case "warning":
      return "bg-amber-600";
    case "soon":
      return "bg-yellow-600";
    case "today":
      return "bg-emerald-600";
    case "ok":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}
