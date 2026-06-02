"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
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
import {
  addOrdersToWave,
  closeWave,
  fetchWaveDetail,
  removeOrderFromWave,
  type WaveDetail,
} from "@/lib/api/waves";
import {
  fetchPendingOrdersForWave,
  type OrderRow,
} from "@/lib/api/operations";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  RELEASED: "Ativa",
  CLOSED: "Encerrada",
};

const LINE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PICKED: "Separado",
  SORTED: "Conferido",
};

export default function WaveDetailPage() {
  const params = useParams();
  const router = useRouter();
  const waveId = typeof params.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<WaveDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<OrderRow[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());

  const loadDetail = useCallback(async () => {
    if (!waveId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWaveDetail(waveId);
      setDetail(data);
    } catch (e) {
      setDetail(null);
      const msg = e instanceof Error ? e.message : "Erro ao carregar onda";
      if (msg.includes("404") || /não encontrad/i.test(msg)) {
        router.replace("/ondas");
        return;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [waveId, router]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const loadAvailable = useCallback(async () => {
    setAvailableLoading(true);
    try {
      const data = await fetchPendingOrdersForWave({
        pageSize: 200,
        notInWave: true,
      });
      setAvailableOrders(data.orders);
    } catch (e) {
      setWarning(
        e instanceof Error ? e.message : "Erro ao carregar pedidos disponíveis",
      );
    } finally {
      setAvailableLoading(false);
    }
  }, []);

  useEffect(() => {
    if (addOpen) loadAvailable();
  }, [addOpen, loadAvailable]);

  const filteredAvailable = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return availableOrders;
    return availableOrders.filter((o) => {
      const erp = (o.erpOrderId ?? "").toLowerCase();
      const cust = (o.customerName ?? "").toLowerCase();
      const mkt = (o.marketplace ?? "").toLowerCase();
      return erp.includes(q) || cust.includes(q) || mkt.includes(q);
    });
  }, [availableOrders, addSearch]);

  const canEdit = detail?.status === "RELEASED";

  const handleRemove = async (orderId: string, erpOrderId: string) => {
    if (
      !window.confirm(
        `Remover o pedido ${erpOrderId} desta onda? Ele voltará a ficar disponível para outra onda.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setWarning(null);
    try {
      await removeOrderFromWave(waveId, orderId);
      setMessage(`Pedido ${erpOrderId} removido da onda.`);
      await loadDetail();
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setSaving(false);
    }
  };

  const handleAddSelected = async () => {
    if (addSelected.size === 0) return;
    setSaving(true);
    setMessage(null);
    setWarning(null);
    try {
      const result = await addOrdersToWave(waveId, Array.from(addSelected));
      setMessage(`${result.added} pedido(s) adicionados à onda.`);
      setAddSelected(new Set());
      setAddOpen(false);
      await loadDetail();
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Falha ao adicionar");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    if (!window.confirm("Encerrar esta onda?")) return;
    setSaving(true);
    setWarning(null);
    try {
      await closeWave(waveId);
      setMessage("Onda encerrada.");
      await loadDetail();
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Falha ao encerrar");
    } finally {
      setSaving(false);
    }
  };

  if (!waveId) {
    return (
      <p className="p-8 text-sm text-muted-foreground">Onda inválida.</p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail?.name ?? "Onda"}
        description={
          detail
            ? `Status: ${STATUS_LABEL[detail.status] ?? detail.status}`
            : "Carregando…"
        }
      >
        <div className="flex flex-wrap gap-2">
          <Link
            href="/ondas"
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Voltar
          </Link>
          {canEdit ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleClose()}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              Encerrar onda
            </button>
          ) : null}
        </div>
      </PageHeader>

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {warning ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {warning}
        </p>
      ) : null}

      <DataState loading={loading} error={error} empty={!detail}>
        {detail ? (
          <div className="space-y-6">
            <section className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">
                  Pedidos da onda ({detail.orders.length})
                </h2>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setAddOpen((v) => !v)}
                    className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium"
                  >
                    {addOpen ? "Fechar adição" : "+ Adicionar pedidos"}
                  </button>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido ERP</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Marketplace</TableHead>
                      <TableHead>Status</TableHead>
                      {canEdit ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.orders.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canEdit ? 5 : 4}
                          className="text-center text-sm text-muted-foreground"
                        >
                          Nenhum pedido nesta onda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      detail.orders.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-medium">
                            {o.erpOrderId}
                          </TableCell>
                          <TableCell>{o.customerName ?? "—"}</TableCell>
                          <TableCell>
                            <MarketplaceBadge value={o.marketplace} />
                          </TableCell>
                          <TableCell>{o.status}</TableCell>
                          {canEdit ? (
                            <TableCell className="text-right">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  void handleRemove(o.id, o.erpOrderId)
                                }
                                className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                              >
                                Remover
                              </button>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>

            {addOpen && canEdit ? (
              <section className="rounded-xl border border-dashed bg-slate-50 p-4">
                <h3 className="text-sm font-semibold">Pedidos disponíveis</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Apenas pedidos pendentes que não estão em nenhuma onda.
                </p>
                <input
                  type="search"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  placeholder="Buscar pedido, cliente ou marketplace"
                  className="mt-3 w-full max-w-md rounded-lg border bg-white px-3 py-2 text-sm"
                />
                <DataState
                  loading={availableLoading}
                  error={null}
                  empty={filteredAvailable.length === 0}
                >
                  <div className="mt-3 max-h-64 overflow-auto rounded-lg border bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>Pedido</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Marketplace</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAvailable.map((o) => (
                          <TableRow key={o.id}>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={addSelected.has(o.id)}
                                onChange={() => {
                                  setAddSelected((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(o.id)) next.delete(o.id);
                                    else next.add(o.id);
                                    return next;
                                  });
                                }}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              {o.erpOrderId}
                            </TableCell>
                            <TableCell>{o.customerName ?? "—"}</TableCell>
                            <TableCell>
                            <MarketplaceBadge value={o.marketplace} />
                          </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </DataState>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={saving || addSelected.size === 0}
                    onClick={() => void handleAddSelected()}
                    className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {saving
                      ? "Salvando…"
                      : `Adicionar ${addSelected.size} selecionado(s)`}
                  </button>
                </div>
              </section>
            ) : null}

            <section className="rounded-xl border bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold">
                Linhas da onda ({detail.lines.length})
              </h2>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Local</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-sm">
                          {l.sku}
                        </TableCell>
                        <TableCell>{l.productName}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {l.locationBarcode}
                        </TableCell>
                        <TableCell className="text-right">
                          {l.quantityPicked}/{l.quantityTotal}
                        </TableCell>
                        <TableCell>
                          {LINE_STATUS_LABEL[l.sortStatus] ?? l.sortStatus}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>
        ) : null}
      </DataState>

      {error && !loading ? (
        <button
          type="button"
          onClick={() => router.push("/ondas")}
          className="text-sm font-medium text-[#0d9488] underline"
        >
          Voltar para ondas
        </button>
      ) : null}
    </div>
  );
}
