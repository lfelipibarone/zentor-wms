import { apiFetch } from "@/lib/api/client";

export interface ParsedLocationRow {
  barcode: string;
  corridor: string;
  row: string;
  type: string;
  productSku?: string;
  capacity: number;
  minThreshold: number;
  currentQuantity?: number;
  active?: boolean;
}

export interface LocationImportApiResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; barcode?: string; message: string }>;
}

export type ImportMode = "upsert" | "createOnly";

const TEMPLATE_HEADERS = [
  "barcode",
  "corredor",
  "fileira",
  "tipo",
  "sku_produto",
  "capacidade",
  "minimo",
  "quantidade",
  "ativo",
] as const;

const TEMPLATE_EXAMPLE = [
  "GON-A-01",
  "A",
  "01",
  "Gôndola",
  "SKU-001",
  100,
  10,
  0,
  "sim",
];

/** Mapeia cabeçalhos da planilha (PT/EN) para campos internos */
const HEADER_ALIASES: Record<string, keyof ParsedLocationRow | "skip"> = {
  barcode: "barcode",
  codigo_barras: "barcode",
  codigo_de_barras: "barcode",
  codigobarras: "barcode",
  etiqueta: "barcode",
  corredor: "corridor",
  corridor: "corridor",
  fileira: "row",
  fila: "row",
  row: "row",
  tipo: "type",
  type: "type",
  localizacao_tipo: "type",
  sku_produto: "productSku",
  sku: "productSku",
  produto: "productSku",
  product_sku: "productSku",
  sku_do_produto: "productSku",
  capacidade: "capacity",
  capacity: "capacity",
  cap: "capacity",
  minimo: "minThreshold",
  minimo_reabastecimento: "minThreshold",
  min_threshold: "minThreshold",
  min: "minThreshold",
  quantidade: "currentQuantity",
  qtd: "currentQuantity",
  quantidade_atual: "currentQuantity",
  current_quantity: "currentQuantity",
  estoque: "currentQuantity",
  ativo: "active",
  active: "active",
  status: "active",
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cellToNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function mapSheetRow(
  headers: string[],
  values: unknown[],
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  headers.forEach((header, i) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (!key || key === "skip") return;
    mapped[key] = values[i];
  });
  return mapped;
}

export async function parseLocationsXlsx(file: File): Promise<{
  rows: ParsedLocationRow[];
  parseErrors: string[];
}> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], parseErrors: ["Planilha vazia"] };
  }

  const sheet = workbook.Sheets[sheetName]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  if (matrix.length < 2) {
    return {
      rows: [],
      parseErrors: ["A planilha precisa ter cabeçalho e ao menos uma linha de dados"],
    };
  }

  const headerRow = matrix[0]!.map((h) => cellToString(h));
  const rows: ParsedLocationRow[] = [];
  const parseErrors: string[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i]!;
    const allEmpty = line.every(
      (c) => cellToString(c) === "",
    );
    if (allEmpty) continue;

    const raw = mapSheetRow(headerRow, line);
    const barcode = cellToString(raw.barcode).toUpperCase();
    const corridor = cellToString(raw.corridor);
    const rowVal = cellToString(raw.row);
    const type = cellToString(raw.type);

    if (!barcode) {
      parseErrors.push(`Linha ${i + 1}: barcode obrigatório`);
      continue;
    }
    if (!corridor || !rowVal) {
      parseErrors.push(`Linha ${i + 1} (${barcode}): corredor e fileira obrigatórios`);
      continue;
    }
    if (!type) {
      parseErrors.push(`Linha ${i + 1} (${barcode}): tipo obrigatório`);
      continue;
    }

    const capacity = cellToNumber(raw.capacity) ?? 100;
    const minThreshold = cellToNumber(raw.minThreshold) ?? 0;

    rows.push({
      barcode,
      corridor,
      row: rowVal,
      type,
      productSku: cellToString(raw.productSku) || undefined,
      capacity,
      minThreshold,
      currentQuantity: cellToNumber(raw.currentQuantity),
      active:
        raw.active === undefined || raw.active === ""
          ? undefined
          : ["sim", "s", "yes", "true", "1", "ativo"].includes(
              cellToString(raw.active).toLowerCase(),
            ),
    });
  }

  return { rows, parseErrors };
}

export async function importLocationsToApi(
  rows: ParsedLocationRow[],
  mode: ImportMode,
): Promise<LocationImportApiResult> {
  return apiFetch<LocationImportApiResult>("/api/locations/import", {
    method: "POST",
    body: JSON.stringify({ mode, rows }),
  });
}

export async function downloadLocationsTemplate(): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [...TEMPLATE_EXAMPLE],
  ]);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 10 },
    { wch: 8 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 8 },
    { wch: 12 },
    { wch: 8 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Localizações");
  XLSX.writeFile(wb, "help-route-localizacoes-modelo.xlsx");
}
