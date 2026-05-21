"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
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
import { fetchMovements, fetchPurchaseReceipts } from "@/lib/api/operations";
import { LOCATION_TYPE_LABEL, MOVEMENT_TYPE_LABEL, RECEIPT_KIND_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type MainTab = "nfs" | "devolucao" | "movimentos";

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

const STATUS_LABEL: Record<string, string> = {
  IN_CHECK: "Em conferência",
  IN_PROGRESS: "Em conferência",
  COMPLETED: "Conferida",
  CANCELLED: "Cancelada",
  READY_TO_CHECK: "Aguardando",
};

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

  const [sessions, setSessions] = useState<
    Awaited<ReturnType<typeof fetchPurchaseReceipts>>["sessions"]
  >([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [movements, setMovements] = useState<
    Awaited<ReturnType<typeof fetchMovements>>["movements"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const receiptKind = mainTab === "devolucao" ? "RETURN" : mainTab === "nfs" ? "ENTRY" : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mainTab === "movimentos") {
        const data = await fetchMovements(page);
        setMovements(data.movements);
        setPagination(data.pagination);
      } else {
        const data = await fetchPurchaseReceipts({
          page,
          status: statusFilter || undefined,
          kind: receiptKind,
        });
        setSessions(data.sessions);
        setPagination(data.pagination);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [mainTab, page, statusFilter, receiptKind]);

  useEffect(() => {
    setPage(1);
  }, [mainTab, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recebimentos"
        description="NF de entrada e devoluções no mobile; histórico completo de movimentações de estoque."
      />

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
        <div className="flex flex-wrap gap-2">
          {[
            { value: "", label: "Todos" },
            { value: "IN_CHECK", label: "Em conferência" },
            { value: "COMPLETED", label: "Conferidas" },
          ].map((opt) => (
            <button
              key={opt.value || "all"}
              type="button"
              onClick={() => {
                setPage(1);
                setStatusFilter(opt.value);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium",
                statusFilter === opt.value
                  ? "bg-slate-700 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
                  {mainTab === "nfs" ? <TableHead>Armazenagem</TableHead> : null}
                  {mainTab === "nfs" ? <TableHead>Tiny</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono font-semibold">
                      {s.invoiceNumber ?? s.reference ?? s.tinyNotaId ?? s.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      {RECEIPT_KIND_LABEL[s.kind] ?? s.kind}
                    </TableCell>
                    <TableCell>{s.supplierName ?? s.reference ?? "—"}</TableCell>
                    <TableCell>{s.operatorName}</TableCell>
                    <TableCell>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {s.itemsChecked}/{s.itemCount}
                    </TableCell>
                    <TableCell>{formatDuration(s.receiptDurationMs)}</TableCell>
                    <TableCell>{formatDuration(s.conferenceDurationMs)}</TableCell>
                    {mainTab === "nfs" ? (
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
                        ) : s.status === "COMPLETED" ? (
                          <span className="text-sm text-amber-700">Pendente</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    ) : null}
                    {mainTab === "nfs" ? (
                      <TableCell className="text-xs text-muted-foreground">
                        {s.tinySyncStatus ?? "—"}
                      </TableCell>
                    ) : null}
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
                  <TableHead>SKU</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Tipo orig.</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Tipo dest.</TableHead>
                  <TableHead>Operador</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>NF / Sessão</TableHead>
                  <TableHead>Putaway</TableHead>
                  <TableHead>Onda</TableHead>
                  <TableHead>Carga</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Transporte</TableHead>
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
                    <TableCell className="font-mono">{m.product.sku}</TableCell>
                    <TableCell>{m.quantity}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.fromLocation?.barcode ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {m.fromLocation?.type
                        ? LOCATION_TYPE_LABEL[m.fromLocation.type] ?? m.fromLocation.type
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.toLocation?.barcode ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {m.toLocation?.type
                        ? LOCATION_TYPE_LABEL[m.toLocation.type] ?? m.toLocation.type
                        : "—"}
                    </TableCell>
                    <TableCell>{m.userName}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.reference ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate text-xs">
                      {m.notes ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.orderErpId ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.purchaseReceiptSessionId
                        ? m.purchaseReceiptSessionId.slice(0, 8)
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.putawaySessionId ? m.putawaySessionId.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.pickWaveLineId ? m.pickWaveLineId.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.cargoTransferId ? m.cargoTransferId.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell>
                      {m.durationSeconds != null ? `${m.durationSeconds}s` : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {m.cargoTransfer ? (
                        <span>
                          {m.cargoTransfer.withdrawnByName}
                          {m.cargoTransfer.depositedByName
                            ? ` → ${m.cargoTransfer.depositedByName}`
                            : ""}
                          <span className="block text-muted-foreground">
                            {m.cargoTransfer.status}
                          </span>
                        </span>
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
