import type { ReportResult } from "@/lib/api/reports";

function reportFilename(result: ReportResult, ext: string): string {
  const period =
    result.from && result.to ? `${result.from}_${result.to}` : "atual";
  return `help-route-${result.report}-${period}.${ext}`;
}

function rowsForExport(result: ReportResult): string[][] {
  const header = result.columns.map((c) => c.header);
  const body = result.rows.map((row) =>
    result.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return "";
      return String(v);
    }),
  );
  return [header, ...body];
}

export async function exportReportXlsx(result: ReportResult): Promise<void> {
  const XLSX = await import("xlsx");
  const sheetData = result.rows.map((row) => {
    const line: Record<string, string | number> = {};
    for (const col of result.columns) {
      const v = row[col.key];
      line[col.header] = v === null || v === undefined ? "" : v;
    }
    return line;
  });

  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, result.title.slice(0, 31));
  XLSX.writeFile(wb, reportFilename(result, "xlsx"));
}

export async function exportReportPdf(result: ReportResult): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const landscape = result.columns.length > 6;
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });

  const periodLabel =
    result.from && result.to
      ? `Período: ${result.from} a ${result.to}`
      : "Gerado em: " + new Date().toLocaleString("pt-BR");

  doc.setFontSize(14);
  doc.text("Help Route WMS", 14, 16);
  doc.setFontSize(11);
  doc.text(result.title, 14, 24);
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(periodLabel, 14, 30);
  doc.text(`${result.totalRows} registro(s)`, 14, 35);
  doc.setTextColor(0, 0, 0);

  const [head, ...body] = rowsForExport(result);

  autoTable(doc, {
    head: [head],
    body,
    startY: 40,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [13, 148, 136] },
    margin: { left: 10, right: 10 },
  });

  doc.save(reportFilename(result, "pdf"));
}
