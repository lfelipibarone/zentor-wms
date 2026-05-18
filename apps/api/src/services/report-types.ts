export interface ReportColumn {
  key: string;
  header: string;
}

export interface ReportResult {
  report: string;
  title: string;
  from: string | null;
  to: string | null;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totalRows: number;
}

export function fmtDateBr(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
