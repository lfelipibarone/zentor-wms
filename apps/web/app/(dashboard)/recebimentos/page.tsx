"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NewReceiptModal } from "@/components/ops/new-receipt-modal";
import { PageHeader } from "@/components/ops/page-header";
import { PurchaseReceiptStatusBadge } from "@/components/ops/purchase-receipt-status-badge";
import { DataState } from "@/components/ops/data-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import {
  fetchMovements,
  fetchPurchaseReceipts,
  syncPurchaseReceipts,
  type PurchaseReceiptListSession,
} from "@/lib/api/operations";
import {
  LOCATION_TYPE_LABEL,
  MOVEMENT_TYPE_LABEL,
  PURCHASE_RECEIPT_STATUS_LABEL,
  RECEIPT_KIND_LABEL,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import Link from "next/link";

type MainTab = "nfs" | "devolucao" | "movimentos";

const ENTRY_STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "WAITING_ENTRY", label: PURCHASE_RECEIPT_STATUS_LABEL.WAITING_ENTRY },
  { value: "READY_TO_CHECK", label: PURCHASE_RECEIPT_STATUS_LABEL.READY_TO_CHECK },
  { value: "IN_CHECK", label: PURCHASE_RECEIPT_STATUS_LABEL.IN_CHECK },
  { value: "COMPLETED", label: PURCHASE_RECEIPT_STATUS_LABEL.COMPLETED },
  { value: "ISSUE", label: PURCHASE_RECEIPT_STATUS_LABEL.ISSUE },
];

const PUTAWAY_LABEL: Record<string, string> = {
  PENDING: "Aguardando",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
};

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "nfs", label: "Nota fiscal de entrada" },
  { key: "devolucao", label: "Devolução" },
  { key: "movimentos", label: "Movimentações" },
];

function formatDuration(ms: number | null) {
  if (ms == null || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}min`;
  }
  return m > 0 ? `${m}min ${s}s` : `${s}s`;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function RecebimentosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const mainTab: MainTab =
    tabParam === "devolucao" || tabParam === "movimentos" ? tabParam : "nfs";

  const setMainTab = (tab: MainTab) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (tab === "nfs") sp.delete("tab");
    else sp.set("tab", tab);
    router.replace(`/recebimentos?${sp.toString()}`);
  };

  const initialRange = defaultDateRange();
  const [sessions, setSessions] = useState<PurchaseReceiptListSession[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [movements, setMovements] = useState<
    Awaited<ReturnType<typeof fetchMovements>>["movements"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newModalMode, setNewModalMode] = useState<"entry" | "return">("entry");

  const receiptKind =
    mainTab === "devolucao" ? "RETURN" : mainTab === "nfs" ? "ENTRY" : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mainTab === "movimentos") {
        const data = await fetchMovements(page);
        setMovements(data.movements);
        setPagination(data.pagination);
      } else {
        if (mainTab === "nfs") {
          try {
            const sync = await syncPurchaseReceipts();
            if (sync.warning) setSyncMessage(sync.warning);
            else if (sync.created > 0) {
              setSyncMessage(`${sync.created} nota(s) importada(s) do Tiny.`);
            } else setSyncMessage(null);
          } catch {
            setSyncMessage(null);
          }
        }

        const data = await fetchPurchaseReceipts({
          page,
          status: statusFilter || undefined,
          kind: receiptKind,
          q: searchQ.trim() || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          sort: "desc",
        });
        setSessions(data.sessions);
        setPagination(data.pagination);
        setStatusCounts(data.statusCounts ?? {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [mainTab, page, statusFilter, receiptKind, searchQ, dateFrom, dateTo]);

  useEffect(() => {
    setPage(1);
  }, [mainTab, statusFilter, searchQ, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const openSession = (id: string) => {
    const sp = new URLSearchParams();
    if (mainTab !== "nfs") sp.set("tab", mainTab);
    const qs = sp.toString();
    router.push(`/recebimentos/${id}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Conferência de compra"
          description="Recebimento e conferência de NF e devoluções pelo navegador. Notas de entrada são sincronizadas do Tiny ERP."
        />
        {mainTab !== "movimentos" ? (
          <button
            type="button"
            onClick={() => {
              setNewModalMode(mainTab === "devolucao" ? "return" : "entry");
              setNewModalOpen(true);
            }}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0f766e]"
          >
            Novo recebimento
          </button>
        ) : null}
      </div>

      <NewReceiptModal
        open={newModalOpen}
        defaultMode={newModalMode}
        onClose={() => setNewModalOpen(false)}
        onStarted={(id) => openSession(id)}
      />

      {syncMessage ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {syncMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {MAIN_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setMainTab(t.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              mainTab === t.key
                ? "bg-[#0d9488] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mainTab !== "movimentos" ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-[200px] flex-1">
              <label className="text-xs font-medium text-muted-foreground">
                Pesquisar
              </label>
              <input
                type="search"
                placeholder="Fornecedor ou número…"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                De
              </label>
              <input
                type="date"
                className="mt-1 block rounded-lg border px-3 py-2 text-sm"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Até
              </label>
              <input
                type="date"
                className="mt-1 block rounded-lg border px-3 py-2 text-sm"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {mainTab !== "movimentos" ? (
            <div className="flex flex-wrap gap-1 border-b">
              {ENTRY_STATUS_TABS.map((tab) => {
                const count =
                  tab.value === ""
                    ? Object.values(statusCounts).reduce((a, b) => a + b, 0)
                    : (statusCounts[tab.value] ?? 0);
                const active = statusFilter === tab.value;
                return (
                  <button
                    key={tab.value || "all"}
                    type="button"
                    onClick={() => {
                      setPage(1);
                      setStatusFilter(tab.value);
                    }}
                    className={cn(
                      "relative px-3 py-2 text-sm font-medium",
                      active
                        ? "text-[#0d9488] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#0d9488]"
                        : "text-slate-600 hover:text-slate-900",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {tab.value ? (
                        <PurchaseReceiptStatusBadge
                          status={tab.value}
                          showDot
                          className="!bg-transparent !px-0 !py-0 !text-inherit"
                        />
                      ) : (
                        tab.label
                      )}
                      {count > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {String(count).padStart(2, "0")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}

      <DataState
        loading={loading}
        error={error}
        empty={
          !loading &&
          (mainTab === "movimentos"
            ? movements.length === 0
            : sessions.length === 0)
        }
        emptyMessage="Nenhum registro nesta aba."
      >
        {mainTab !== "movimentos" ? (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referência</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fornecedor / Ref.</TableHead>
                  <TableHead>Operador</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Tempo receb.</TableHead>
                  <TableHead>Tempo conf.</TableHead>
                  <TableHead>Armazenagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => openSession(s.id)}
                  >
                    <TableCell className="font-mono font-semibold">
                      {s.invoiceNumber ?? s.reference ?? s.tinyNotaId ?? s.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      {RECEIPT_KIND_LABEL[s.kind] ?? s.kind}
                    </TableCell>
                    <TableCell>{s.supplierName ?? s.reference ?? "—"}</TableCell>
                    <TableCell>{s.operatorName}</TableCell>
                    <TableCell>
                      <PurchaseReceiptStatusBadge status={s.status} />
                    </TableCell>
                    <TableCell>
                      {s.itemsChecked}/{s.itemCount}
                    </TableCell>
                    <TableCell>{formatDuration(s.receiptDurationMs)}</TableCell>
                    <TableCell>{formatDuration(s.conferenceDurationMs)}</TableCell>
                    <TableCell>
                      {s.putaway ? (
                        <div className="text-sm">
                          <p>{PUTAWAY_LABEL[s.putaway.status] ?? s.putaway.status}</p>
                          {s.putaway.operatorName ? (
                            <p className="text-muted-foreground">
                              {s.putaway.operatorName}
                            </p>
                          ) : null}
                        </div>
                      ) : s.status === "COMPLETED" && s.kind === "ENTRY" ? (
                        <span className="text-sm text-amber-700">Pendente</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Operador</TableHead>
                  <TableHead>NF / Sessão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(m.createdAt).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      {MOVEMENT_TYPE_LABEL[m.type] ?? m.type}
                    </TableCell>
                    <TableCell>{m.quantity}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.fromLocation?.barcode ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.toLocation?.barcode ?? "—"}
                    </TableCell>
                    <TableCell>{m.userName}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.purchaseReceiptSessionId ? (
                        <Link
                          href={`/recebimentos/${m.purchaseReceiptSessionId}?tab=movimentos`}
                          className="text-[#0d9488] hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {m.purchaseReceiptSessionId.slice(0, 8)}…
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {pagination && pagination.total > 0 ? (
          <Pagination pagination={pagination} onPageChange={setPage} />
        ) : null}
      </DataState>
    </div>
  );
}
