"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { WorkboardEntryCard } from "@/components/ops/workboard-entry-card";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import type { PaginationMeta } from "@/lib/pagination";
import { OrderStatus } from "@wms/shared";
import {
  fetchOrdersBoard,
  type BoardCounts,
  type BoardEntry,
  type BoardKind,
} from "@/lib/api/operations";

type TabKey =
  | "all"
  | "pending"
  | "picking"
  | "separated"
  | "paused"
  | "dispatching"
  | "wave";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "pending", label: "Aguardando separação" },
  { key: "picking", label: "Em separação" },
  { key: "separated", label: "Separados" },
  { key: "paused", label: "Pausados" },
  { key: "dispatching", label: "Pronto para expedir" },
  { key: "wave", label: "Ondas" },
];

function tabToQuery(tab: TabKey): { kind: BoardKind; status?: string } {
  switch (tab) {
    case "pending":
      return { kind: "order", status: OrderStatus.PENDING };
    case "picking":
      return { kind: "order", status: OrderStatus.PICKING };
    case "separated":
      return { kind: "order", status: OrderStatus.PICKED_AWAITING_CONFERENCE };
    case "paused":
      return { kind: "order", status: OrderStatus.PAUSED_ISSUE };
    case "dispatching":
      return { kind: "order", status: OrderStatus.DISPATCHING };
    case "wave":
      return { kind: "wave" };
    default:
      return { kind: "all" };
  }
}

function tabCount(tab: TabKey, counts: BoardCounts | null): number | null {
  if (!counts) return null;
  switch (tab) {
    case "pending":
      return counts.pending;
    case "picking":
      return counts.picking;
    case "separated":
      return counts.separated;
    case "paused":
      return counts.paused;
    case "dispatching":
      return counts.dispatching;
    case "wave":
      return counts.waves;
    case "all":
      return counts.all;
    default:
      return null;
  }
}

export default function PedidosPage() {
  const [tab, setTab] = useState<TabKey>("all");
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [counts, setCounts] = useState<BoardCounts | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setExpandedIds(new Set());
  }, [tab, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { kind, status } = tabToQuery(tab);
    try {
      const data = await fetchOrdersBoard({
        kind,
        status,
        q: q || undefined,
        page,
      });
      setEntries(data.entries);
      setCounts(data.counts);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [tab, q, page]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos"
        description="Pedidos ERP e ondas de separação — acompanhe o fluxo até packing e expedição. Packing operacional na tela Packing."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = tabCount(t.key, counts);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium",
                tab === t.key
                  ? "bg-[#0d9488] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {t.label}
              {count != null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <div className="mb-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pedido ERP, cliente ou nome da onda…"
          className="min-w-[240px] w-full max-w-md rounded-lg border bg-white px-3 py-2 text-sm"
        />
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={!loading && entries.length === 0}
        emptyMessage="Nenhum registro nesta aba."
      >
        <div className="space-y-4">
          {entries.map((entry) => (
            <WorkboardEntryCard
              key={`${entry.kind}-${entry.id}`}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
            />
          ))}
        </div>
        {pagination && pagination.total > 0 ? (
          <Pagination pagination={pagination} onPageChange={setPage} />
        ) : null}
      </DataState>
    </div>
  );
}
