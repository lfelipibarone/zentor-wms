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
import {
  fetchMovements,
  fetchPurchaseReceipts,
  fetchStockLocations,
} from "@/lib/api/operations";
import { MOVEMENT_TYPE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type MainTab = "nfs" | "pulmao" | "movimentos";

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
  IN_PROGRESS: "Em conferência",
  COMPLETED: "Conferida",
  CANCELLED: "Cancelada",
};

const PUTAWAY_LABEL: Record<string, string> = {
  PENDING: "Aguardando",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
};

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "nfs", label: "Notas fiscais" },
  { key: "pulmao", label: "Saldos no pulmão" },
  { key: "movimentos", label: "Movimentações" },
];

export default function RecebimentosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const mainTab: MainTab =
    tabParam === "pulmao" || tabParam === "movimentos" ? tabParam : "nfs";

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
  const [locations, setLocations] = useState<
    Awaited<ReturnType<typeof fetchStockLocations>>["locations"]
  >([]);
  const [movements, setMovements] = useState<
    Awaited<ReturnType<typeof fetchMovements>>["movements"]
  >([]);
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mainTab === "nfs") {
        const data = await fetchPurchaseReceipts({
          page,
          status: statusFilter || undefined,
        });
        setSessions(data.sessions);
        setPagination(data.pagination);
      } else if (mainTab === "pulmao") {
        const data = await fetchStockLocations(
          undefined,
          lowOnly,
          page,
          undefined,
          "PULMAO",
        );
        setLocations(data.locations);
        setPagination(data.pagination);
      } else {
        const data = await fetchMovements(page, undefined, "PULMAO");
        setMovements(data.movements);
        setPagination(data.pagination);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [mainTab, page, statusFilter, lowOnly]);

  useEffect(() => {
    setPage(1);
  }, [mainTab, statusFilter, lowOnly]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recebimentos"
        description="Entrada de mercadoria: conferência de NF no mobile, armazenagem no pulmão e movimentações vinculadas."
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

      {mainTab === "nfs" ? (
        <div className="flex flex-wrap gap-2">
          {[
            { value: "", label: "Todos" },
            { value: "IN_PROGRESS", label: "Em conferência" },
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

      {mainTab === "pulmao" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
          />
          Somente abaixo do mínimo
        </label>
      ) : null}

      <DataState
        loading={loading}
        error={error}
        empty={
          !loading &&
          (mainTab === "nfs"
            ? sessions.length === 0
            : mainTab === "pulmao"
              ? locations.length === 0
              : movements.length === 0)
        }
        emptyMessage="Nenhum registro nesta aba."
      >
        {mainTab === "nfs" ? (
          <div className="rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NF</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Operador</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Tempo receb.</TableHead>
                  <TableHead>Tempo conf.</TableHead>
                  <TableHead>Armazenagem</TableHead>
                  <TableHead>Tiny</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono font-semibold">
                      {s.invoiceNumber ?? s.tinyNotaId}
                    </TableCell>
                    <TableCell>{s.supplierName ?? "—"}</TableCell>
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
                    <TableCell className="text-xs text-muted-foreground">
                      {s.tinySyncStatus ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {mainTab === "pulmao" ? (
          <div className="rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Local</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Mínimo</TableHead>
                  <TableHead>Alerta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((l) => {
                  const alert = l.currentQuantity <= l.minThreshold;
                  return (
                    <TableRow key={l.id} className={alert ? "bg-amber-50" : ""}>
                      <TableCell className="font-mono">{l.barcode}</TableCell>
                      <TableCell>
                        {l.product?.sku ?? "—"}
                        {l.product?.name ? (
                          <span className="block text-xs text-muted-foreground">
                            {l.product.name}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {l.currentQuantity} / {l.capacity}
                      </TableCell>
                      <TableCell>{l.minThreshold}</TableCell>
                      <TableCell>{alert ? "Repor" : "OK"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {mainTab === "movimentos" ? (
          <div className="rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Ref. NF</TableHead>
                  <TableHead>Operador</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      {new Date(m.createdAt).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      {MOVEMENT_TYPE_LABEL[m.type] ?? m.type}
                    </TableCell>
                    <TableCell className="font-mono">{m.product.sku}</TableCell>
                    <TableCell>{m.quantity}</TableCell>
                    <TableCell>{m.fromLocation?.barcode ?? "—"}</TableCell>
                    <TableCell>{m.toLocation?.barcode ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.reference ?? "—"}
                    </TableCell>
                    <TableCell>{m.user.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {pagination && pagination.total > 0 ? (
          <Pagination pagination={pagination} onPageChange={setPage} />
        ) : null}
      </DataState>
    </div>
  );
}
