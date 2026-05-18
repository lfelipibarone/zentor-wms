"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { MOVEMENT_TYPE_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";
import { OrderStatus } from "@wms/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  defaultReportPeriod,
  fetchReportData,
  fetchReportTypes,
  type ReportId,
  type ReportResult,
  type ReportTypeMeta,
} from "@/lib/api/reports";
import { exportReportPdf, exportReportXlsx } from "@/lib/reports-export";

export default function RelatoriosPage() {
  const defaults = useMemo(() => defaultReportPeriod(), []);
  const [periodFrom, setPeriodFrom] = useState(defaults.from);
  const [periodTo, setPeriodTo] = useState(defaults.to);

  const [types, setTypes] = useState<ReportTypeMeta[]>([]);
  const [reportId, setReportId] = useState<ReportId>("dispatched");
  const [statusFilter, setStatusFilter] = useState("");
  const [movementFilter, setMovementFilter] = useState("");

  const [report, setReport] = useState<ReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const selectedType = types.find((t) => t.id === reportId);
  const needsPeriod = reportId !== "low_stock";

  useEffect(() => {
    fetchReportTypes()
      .then((r) => setTypes(r.types))
      .catch(() => {});
  }, []);

  const loadPreview = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const data = await fetchReportData({
        report: reportId,
        from: needsPeriod ? periodFrom : undefined,
        to: needsPeriod ? periodTo : undefined,
        status: reportId === "orders" && statusFilter ? statusFilter : undefined,
        movementType:
          reportId === "movements" && movementFilter
            ? movementFilter
            : undefined,
      });
      setReport(data);
    } catch (e) {
      setReport(null);
      setReportError(e instanceof Error ? e.message : "Erro ao carregar relatório");
    } finally {
      setReportLoading(false);
    }
  }, [
    reportId,
    periodFrom,
    periodTo,
    statusFilter,
    movementFilter,
    needsPeriod,
  ]);

  useEffect(() => {
    const t = setTimeout(loadPreview, 350);
    return () => clearTimeout(t);
  }, [loadPreview]);

  const canExport = report && report.rows.length > 0 && !reportLoading;

  const handleExportPdf = async () => {
    if (!report || !canExport) return;
    setExporting("pdf");
    setReportError(null);
    try {
      await exportReportPdf(report);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Erro ao exportar PDF");
    } finally {
      setExporting(null);
    }
  };

  const handleExportXlsx = async () => {
    if (!report || !canExport) return;
    setExporting("xlsx");
    setReportError(null);
    try {
      await exportReportXlsx(report);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Erro ao exportar Excel");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        description="Selecione o tipo e os filtros para ver a pré-visualização. Exporte em PDF ou Excel quando estiver pronto."
      />

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2">
          {types.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setReportId(t.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                reportId === t.id
                  ? "bg-[#0d9488] text-white"
                  : "border bg-white hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {selectedType ? (
          <p className="mb-4 text-sm text-muted-foreground">
            {selectedType.description}
          </p>
        ) : null}

        <div className="mb-6 flex flex-wrap items-end gap-3">
          {needsPeriod ? (
            <>
              <DateField label="De" value={periodFrom} onChange={setPeriodFrom} />
              <DateField label="Até" value={periodTo} onChange={setPeriodTo} />
            </>
          ) : (
            <p className="pb-2 text-sm text-muted-foreground">
              Estoque atual — sem filtro de data.
            </p>
          )}

          {reportId === "orders" ? (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="">Todos os status</option>
              {Object.values(OrderStatus).map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : null}

          {reportId === "movements" ? (
            <select
              value={movementFilter}
              onChange={(e) => setMovementFilter(e.target.value)}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(MOVEMENT_TYPE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="border-t pt-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Pré-visualização</h2>
              {report && !reportLoading ? (
                <p className="text-xs text-muted-foreground">
                  {report.title}
                  {report.from && report.to
                    ? ` · ${report.from} a ${report.to}`
                    : ""}
                  {" · "}
                  {report.totalRows} registro
                  {report.totalRows === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={!canExport || exporting !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-[#0d9488] px-4 py-2 text-sm font-semibold text-[#0d9488] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                {exporting === "pdf" ? "Gerando PDF…" : "Exportar PDF"}
              </button>
              <button
                type="button"
                onClick={handleExportXlsx}
                disabled={!canExport || exporting !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {exporting === "xlsx" ? "Gerando Excel…" : "Exportar XLSX"}
              </button>
            </div>
          </div>

          {reportError ? (
            <p className="mb-3 text-sm font-medium text-red-600">{reportError}</p>
          ) : null}

          <DataState
            loading={reportLoading}
            error={null}
            empty={!reportLoading && report !== null && report.rows.length === 0}
            emptyMessage="Nenhum registro para os filtros selecionados."
          >
            {report && report.rows.length > 0 ? (
              <div className="max-h-[calc(100vh-320px)] min-h-[200px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {report.columns.map((c) => (
                        <TableHead key={c.key} className="whitespace-nowrap bg-slate-50">
                          {c.header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row, i) => (
                      <TableRow key={i}>
                        {report.columns.map((c) => (
                          <TableCell key={c.key} className="whitespace-nowrap">
                            {formatCell(row[c.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </DataState>
        </div>
      </section>
    </div>
  );
}

function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border bg-white px-3 py-2"
      />
    </label>
  );
}
