import type { InventoryLayoutRow } from "@/lib/api/warehouse";

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const ADDRESS_HEADERS = new Set(["localizacao", "endereco", "local"]);
const SKU_HEADERS = new Set(["codigo_sku", "sku", "codigo", "sku_produto"]);

type SheetRows = { sheetName: string; rows: InventoryLayoutRow[] };

/**
 * Lê a planilha de inventário (colunas "Localização" e "Código (SKU)").
 * Usa a aba chamada "Localização" se existir; senão, a que tiver mais endereços preenchidos.
 */
export async function parseInventoryXlsx(file: File): Promise<SheetRows> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const candidates: SheetRows[] = [];

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    const headers = (matrix[0] ?? []).map(normalizeHeader);
    const addressCol = headers.findIndex((h) => ADDRESS_HEADERS.has(h));
    if (addressCol < 0) continue;
    const skuCol = headers.findIndex((h) => SKU_HEADERS.has(h));
    const rows = matrix.slice(1).map((line) => ({
      address: String(line[addressCol] ?? "").trim(),
      sku: skuCol >= 0 ? String(line[skuCol] ?? "").trim() : "",
    }));
    candidates.push({ sheetName, rows });
  }

  if (!candidates.length) {
    throw new Error('Nenhuma aba com a coluna "Localização" foi encontrada');
  }
  const named = candidates.find((c) => normalizeHeader(c.sheetName).startsWith("localiza"));
  const filled = (c: SheetRows) => c.rows.filter((r) => r.address).length;
  const chosen = named ?? candidates.sort((a, b) => filled(b) - filled(a))[0]!;
  return { sheetName: chosen.sheetName, rows: chosen.rows.filter((r) => r.address || r.sku) };
}
