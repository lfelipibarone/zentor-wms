"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DataState } from "@/components/ops/data-state";
import { PercentBar } from "@/components/ops/percent-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchReplenishmentNeeds,
  type ReplenishmentNeedSummary,
} from "@/lib/api/operations";
import { unitsLabel } from "@/lib/stock-mode";

function missingLabel(need: ReplenishmentNeedSummary) {
  if (need.stockMode === "QUANTITY" && need.stockQuantity != null) {
    return `${Math.max(0, need.capacity - need.stockQuantity)} un.`;
  }
  return `${need.percentToFill}%`;
}

function minLabel(need: ReplenishmentNeedSummary) {
  return unitsLabel(need.minQuantity, need.stockMode) ?? `${need.minPercent}%`;
}

function statusLabel(need: ReplenishmentNeedSummary) {
  if (!need.assignedToName) return { text: "Livre", className: "bg-slate-100 text-slate-700" };
  if (need.assignmentStatus === "WITHDRAWN") {
    return {
      text: `Em transporte · ${need.assignedToName}`,
      className: "bg-blue-100 text-blue-800",
    };
  }
  return { text: `Com ${need.assignedToName}`, className: "bg-amber-100 text-amber-800" };
}

export function ReplenishmentNeedsPanel({ q }: { q: string }) {
  const [needs, setNeeds] = useState<ReplenishmentNeedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReplenishmentNeeds();
      setNeeds(data.needs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const term = q.trim().toLowerCase();
  const visible = term
    ? needs.filter(
        (n) =>
          n.sku.toLowerCase().includes(term) ||
          n.productName.toLowerCase().includes(term) ||
          n.pickFaceBarcode.toLowerCase().includes(term) ||
          n.routeLabel.toLowerCase().includes(term),
      )
    : needs;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Gôndolas no mínimo ou abaixo. A reposição é feita no app, em Ressuprimento.
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={!loading && visible.length === 0}
        emptyMessage={
          term ? "Nenhuma reposição para essa busca." : "Nenhuma gôndola precisando de reposição."
        }
      >
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Gôndola</TableHead>
                <TableHead>Ocupação</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Falta</TableHead>
                <TableHead>Pulmão sugerido</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((n) => {
                const status = statusLabel(n);
                return (
                  <TableRow key={n.pickFaceId}>
                    <TableCell>
                      <span className="font-mono text-sm font-medium">{n.sku}</span>
                      <span className="block text-xs text-muted-foreground">{n.productName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{n.routeLabel}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {n.pickFaceBarcode}
                      </span>
                    </TableCell>
                    <TableCell>
                      <PercentBar
                        percent={n.fillPercent}
                        minPercent={n.minPercent}
                        label={unitsLabel(n.stockQuantity, n.stockMode)}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{minLabel(n)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {missingLabel(n)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {n.suggestedPulmao ? (
                        <>
                          {n.suggestedPulmao.label}
                          <span className="block text-xs text-muted-foreground">
                            {n.suggestedPulmao.percent}% deste SKU
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Sem pulmão</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {status.text}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DataState>
    </div>
  );
}
