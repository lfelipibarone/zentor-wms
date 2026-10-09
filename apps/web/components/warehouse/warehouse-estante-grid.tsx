"use client";

import { PercentBar } from "@/components/ops/percent-bar";
import { unitsLabel } from "@/lib/stock-mode";
import type { LayoutSituacao, LocationFace } from "@/lib/api/warehouse";
import { EMPTY, type LayoutRow } from "@/lib/warehouse-layout-rows";
import { cn } from "@/lib/utils";

export const FACE_LABEL: Record<LocationFace, string> = { A: "LD", B: "LE" };

const FACE_TITLE: Record<LocationFace, string> = {
  A: "Lado direito (LD)",
  B: "Lado esquerdo (LE)",
};

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function hasSku(row: LayoutRow) {
  return row.sku !== EMPTY;
}

function isPickFace(row: LayoutRow) {
  return row.location?.type !== "PULMAO";
}

function isQuantity(row: LayoutRow) {
  return isPickFace(row) && row.location?.stockMode === "QUANTITY";
}

function colunaModeLabel(rows: LayoutRow[]) {
  const faces = rows.filter(isPickFace);
  const byQty = faces.filter(isQuantity).length;
  if (byQty === 0) return "%";
  return byQty === faces.length ? "un." : "misto";
}

export function isBelowMin(row: LayoutRow) {
  return (
    isPickFace(row) &&
    hasSku(row) &&
    row.fillPercent != null &&
    row.minPercent != null &&
    row.fillPercent <= row.minPercent
  );
}

export function rowMatchesSituacao(row: LayoutRow, situacao: LayoutSituacao | "") {
  switch (situacao) {
    case "":
      return true;
    case "sem_sku":
      return !hasSku(row);
    case "com_sku":
      return hasSku(row);
    case "vazia":
      return (row.fillPercent ?? 0) <= 0;
    case "abaixo_min":
      return isBelowMin(row);
    case "inativa":
      return !row.active;
  }
}

function rowMatchesSearch(row: LayoutRow, q: string) {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  return [row.barcode, row.sku, row.location?.product?.name]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(term));
}

function LinhaCell({
  row,
  dimmed,
  onEdit,
}: {
  row: LayoutRow;
  dimmed: boolean;
  onEdit: (row: LayoutRow) => void;
}) {
  const below = isBelowMin(row);
  const noSku = !hasSku(row);
  return (
    <button
      type="button"
      onClick={() => onEdit(row)}
      title={row.location?.product?.name ?? row.barcode ?? undefined}
      className={cn(
        "w-full rounded-lg border px-2.5 py-2 text-left transition hover:border-[#0d9488] hover:shadow-sm",
        noSku
          ? "border-dashed border-slate-300 bg-slate-50"
          : below
            ? "border-amber-300 bg-amber-50"
            : "border-slate-200 bg-white",
        !row.active && "opacity-60",
        dimmed && "opacity-25",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="font-semibold text-slate-700">Linha {row.linha}</span>
        {!row.active ? (
          <span className="text-slate-500">Inativa</span>
        ) : isQuantity(row) ? (
          <span
            className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-800"
            title="Medida por quantidade"
          >
            un.
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-0.5 truncate font-mono text-xs",
          noSku ? "font-sans text-[#0d9488] underline" : "text-slate-800",
        )}
      >
        {noSku ? "Associar SKU" : row.sku}
      </p>
      {row.fillPercent != null && !noSku ? (
        <PercentBar
          className="mt-1 min-w-0"
          percent={row.fillPercent}
          minPercent={isPickFace(row) ? row.minPercent : null}
          label={unitsLabel(row.location?.stockQuantity, row.location?.stockMode)}
        />
      ) : null}
    </button>
  );
}

export function WarehouseEstanteGrid({
  rows,
  face,
  colunaId,
  situacao,
  search,
  onEdit,
  onColunaStockMode,
}: {
  rows: LayoutRow[];
  face: LocationFace | "";
  colunaId: string;
  situacao: LayoutSituacao | "";
  search: string;
  onEdit: (row: LayoutRow) => void;
  /** Abre "% ou quantidade" já na coluna */
  onColunaStockMode?: (colunaId: string) => void;
}) {
  const visible = rows.filter(
    (r) => (!face || r.face === face) && (!colunaId || r.colunaId === colunaId),
  );

  if (visible.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
        Nenhuma posição nesta estante com esses filtros.
      </p>
    );
  }

  const faces = (["A", "B"] as const).filter((f) => visible.some((r) => r.face === f));

  return (
    <div className="space-y-5">
      {faces.map((f) => {
        const faceRows = visible.filter((r) => r.face === f);
        const colunas = new Map<string, { code: string; rows: LayoutRow[] }>();
        for (const row of faceRows) {
          const key = row.colunaId ?? row.coluna;
          const entry = colunas.get(key) ?? { code: row.coluna, rows: [] };
          entry.rows.push(row);
          colunas.set(key, entry);
        }
        const ordered = [...colunas.entries()].sort((a, b) =>
          collator.compare(a[1].code, b[1].code),
        );

        return (
          <section key={f} className="space-y-2">
            {faces.length > 1 ? (
              <h3 className="text-sm font-semibold text-slate-700">{FACE_TITLE[f]}</h3>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {ordered.map(([key, col]) => {
                const linhas = [...col.rows].sort((a, b) => collator.compare(a.linha, b.linha));
                const alerts = linhas.filter(isBelowMin).length;
                return (
                  <div
                    key={key}
                    className="w-44 shrink-0 space-y-1.5 rounded-xl border bg-slate-50/60 p-2"
                  >
                    <div className="flex items-center justify-between gap-1 px-1">
                      <span className="text-sm font-semibold text-slate-800">
                        Coluna {col.code}
                      </span>
                      <div className="flex items-center gap-1">
                        {alerts > 0 ? (
                          <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">
                            {alerts} baixo
                          </span>
                        ) : null}
                        {onColunaStockMode && linhas[0]?.colunaId ? (
                          <button
                            type="button"
                            onClick={() => onColunaStockMode(linhas[0]!.colunaId!)}
                            title={`Medir a coluna ${col.code} por % ou quantidade`}
                            className="rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-600 hover:border-[#0d9488] hover:text-[#0d9488]"
                          >
                            {colunaModeLabel(linhas)}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {linhas.map((row) => (
                      <LinhaCell
                        key={row.id}
                        row={row}
                        onEdit={onEdit}
                        dimmed={
                          !rowMatchesSituacao(row, situacao) || !rowMatchesSearch(row, search)
                        }
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
