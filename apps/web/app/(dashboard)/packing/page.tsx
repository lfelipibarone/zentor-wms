"use client";

import { useCallback, useEffect, useState } from "react";
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
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  confirmPackingItem,
  fetchPackingQueue,
  fetchPackingSession,
  fetchWavePackingLine,
  fetchWavePackingLines,
  searchPackingOrder,
  type PackingOrder,
} from "@/lib/api/operations";

type MainTab = "orders" | "waves";

export default function PackingPage() {
  const [mainTab, setMainTab] = useState<MainTab>("orders");
  const [queue, setQueue] = useState<PackingOrder[]>([]);
  const [activeOrder, setActiveOrder] = useState<PackingOrder | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [waveLines, setWaveLines] = useState<
    Awaited<ReturnType<typeof fetchWavePackingLines>>["lines"]
  >([]);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [waveLine, setWaveLine] = useState<
    Awaited<ReturnType<typeof fetchWavePackingLine>>["line"] | null
  >(null);
  const [basketBarcode, setBasketBarcode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPackingQueue();
      setQueue(data.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar fila");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWaves = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWavePackingLines();
      setWaveLines(data.lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar ondas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab === "orders") loadQueue();
    else loadWaves();
  }, [mainTab, loadQueue, loadWaves]);

  const openOrder = async (orderId: string) => {
    setMessage(null);
    try {
      await apiFetch(`/api/packing/orders/${orderId}/start`, {
        method: "POST",
        body: "{}",
      });
      const session = await fetchPackingSession(orderId);
      setActiveOrder(session);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao abrir pedido");
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      const { order } = await searchPackingOrder(searchQ);
      await openOrder(order.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Pedido não encontrado");
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder || !scanCode.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiFetch<PackingOrder>(
        `/api/packing/orders/${activeOrder.id}/scan`,
        {
          method: "POST",
          body: JSON.stringify({
            barcode: scanCode.trim(),
            quantity: Number(scanQty) || 1,
          }),
        },
      );
      setActiveOrder(updated);
      setScanCode("");
      setScanQty("1");
      setMessage("Item registrado");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro no bip");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmLine = async (itemId: string, max: number) => {
    if (!activeOrder) return;
    const qty = Math.min(
      max,
      Math.max(1, Math.floor(Number(lineQty[itemId] ?? max))),
    );
    setSaving(true);
    setMessage(null);
    try {
      const updated = await confirmPackingItem(activeOrder.id, itemId, qty);
      setActiveOrder(updated);
      setLineQty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setMessage(`${qty} un. conferida(s)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao confirmar");
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!activeOrder) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/packing/orders/${activeOrder.id}/complete`, {
        method: "POST",
        body: "{}",
      });
      setActiveOrder(null);
      setMessage("Packing concluído — pedido pronto para expedir");
      await loadQueue();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao finalizar");
    } finally {
      setSaving(false);
    }
  };

  const openWaveLine = async (lineId: string) => {
    setMessage(null);
    try {
      const data = await fetchWavePackingLine(lineId);
      setActiveLineId(lineId);
      setWaveLine(data.line);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao abrir linha");
    }
  };

  const confirmWaveAlloc = async (
    allocationId: string,
    quantity: number,
    basket?: string,
  ) => {
    if (!activeLineId) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/packing/waves/lines/${activeLineId}/sort`, {
        method: "POST",
        body: JSON.stringify({
          allocationId,
          quantity,
          basketBarcode: basket?.trim() || undefined,
        }),
      });
      const data = await fetchWavePackingLine(activeLineId);
      setWaveLine(data.line);
      if (data.line.sortStatus === "SORTED") {
        setMessage("Linha de onda concluída");
        setActiveLineId(null);
        setWaveLine(null);
        await loadWaves();
      } else {
        setMessage("Alocação registrada");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro no packing de onda");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packing"
        description="Conferência de pedidos separados e packing de ondas no computador."
      />

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "orders" as const, label: "Pedidos" },
            { key: "waves" as const, label: "Ondas" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setMainTab(t.key);
              setActiveOrder(null);
              setActiveLineId(null);
              setWaveLine(null);
            }}
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

      {message ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
      ) : null}

      {mainTab === "orders" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                placeholder="Pedido ou código da cesta"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
              >
                Abrir
              </button>
            </form>

            <DataState
              loading={loading && !activeOrder}
              error={error}
              empty={!loading && queue.length === 0}
              emptyMessage="Nenhum pedido aguardando packing."
            >
              <div className="space-y-2">
                {queue.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => openOrder(o.id)}
                    className={cn(
                      "w-full rounded-xl border bg-white p-4 text-left shadow-sm hover:border-[#0d9488]",
                      activeOrder?.id === o.id && "border-[#0d9488] ring-1 ring-[#0d9488]",
                    )}
                  >
                    <p className="font-mono font-bold">{o.erpOrderId}</p>
                    <p className="text-sm text-muted-foreground">
                      Cesta {o.basket?.code ?? "—"} · {o.items.length} itens
                    </p>
                  </button>
                ))}
              </div>
            </DataState>
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            {!activeOrder ? (
              <p className="text-muted-foreground text-sm">
                Selecione um pedido na fila ou busque pelo número/cesta.
              </p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-xl font-bold">
                      {activeOrder.erpOrderId}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Cesta {activeOrder.basket?.code ?? "—"}
                    </p>
                  </div>
                  {activeOrder.allPacked ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleComplete}
                      className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
                    >
                      Finalizar packing
                    </button>
                  ) : null}
                </div>

                <p className="mb-2 text-xs text-muted-foreground">
                  Informe a quantidade por linha e confirme, ou use o bip opcional abaixo.
                </p>

                <Table className="mb-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Separado</TableHead>
                      <TableHead>Conferido</TableHead>
                      <TableHead>Qtd</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeOrder.items.map((item) => (
                      <TableRow
                        key={item.id}
                        className={
                          item.remaining === 0 ? "bg-emerald-50" : undefined
                        }
                      >
                        <TableCell className="font-mono">{item.product.sku}</TableCell>
                        <TableCell>{item.product.name}</TableCell>
                        <TableCell>{item.quantityPicked}</TableCell>
                        <TableCell>
                          {item.quantityPacked}/{item.quantityPicked}
                        </TableCell>
                        <TableCell>
                          {item.remaining > 0 ? (
                            <input
                              type="number"
                              min={1}
                              max={item.remaining}
                              className="w-16 rounded border px-2 py-1 text-sm"
                              value={lineQty[item.id] ?? String(item.remaining)}
                              onChange={(e) =>
                                setLineQty((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {item.remaining > 0 ? (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() =>
                                handleConfirmLine(item.id, item.remaining)
                              }
                              className="rounded-lg bg-[#0d9488] px-2 py-1 text-xs font-semibold text-white"
                            >
                              Confirmar
                            </button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <form onSubmit={handleScan} className="flex flex-wrap gap-2 border-t pt-4">
                  <input
                    className="min-w-[140px] flex-1 rounded-lg border px-3 py-2 text-sm font-mono"
                    placeholder="Bip opcional (SKU)"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                  />
                  <input
                    type="number"
                    min={1}
                    className="w-20 rounded-lg border px-2 py-2 text-sm"
                    value={scanQty}
                    onChange={(e) => setScanQty(e.target.value)}
                    title="Quantidade no bip"
                  />
                  <button
                    type="submit"
                    disabled={saving || !scanCode.trim()}
                    className="rounded-lg border px-4 py-2 text-sm font-medium"
                  >
                    Bipar
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <DataState
            loading={loading && !waveLine}
            error={error}
            empty={!loading && waveLines.length === 0}
            emptyMessage="Nenhuma linha de onda aguardando packing."
          >
            <div className="space-y-2">
              {waveLines.map((line) => (
                <button
                  key={line.id}
                  type="button"
                  onClick={() => openWaveLine(line.id)}
                  className={cn(
                    "w-full rounded-xl border bg-white p-4 text-left shadow-sm hover:border-[#0d9488]",
                    activeLineId === line.id && "border-[#0d9488]",
                  )}
                >
                  <p className="font-semibold">{line.waveName}</p>
                  <p className="font-mono text-sm">{line.sku}</p>
                  <p className="text-sm text-muted-foreground">
                    {line.quantityPicked}/{line.quantityTotal} un. · {line.sortStatus}
                  </p>
                </button>
              ))}
            </div>
          </DataState>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            {!waveLine ? (
              <p className="text-sm text-muted-foreground">
                Selecione uma linha de onda para distribuir nas cestas.
              </p>
            ) : (
              <>
                <p className="mb-2 font-semibold">{waveLine.waveName}</p>
                <p className="mb-4 font-mono text-sm">
                  {waveLine.product.sku} · {waveLine.quantityPicked} un. coletadas
                </p>
                <div className="mb-4">
                  <label className="text-xs text-muted-foreground">Cesta (bip opcional)</label>
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono"
                    value={basketBarcode}
                    onChange={(e) => setBasketBarcode(e.target.value)}
                    placeholder="Código da cesta"
                  />
                </div>
                <div className="space-y-3">
                  {waveLine.allocations.map((alloc) => (
                    <div key={alloc.id} className="rounded-lg border p-3">
                      <p className="font-mono font-bold">{alloc.order.erpOrderId}</p>
                      <p className="text-sm">
                        {alloc.quantitySorted}/{alloc.quantity} un.
                        {alloc.order.basketCode
                          ? ` · cesta ${alloc.order.basketCode}`
                          : ""}
                      </p>
                      {alloc.remaining > 0 ? (
                        <button
                          type="button"
                          disabled={saving}
                          className="mt-2 rounded-lg bg-[#0d9488] px-3 py-1.5 text-sm font-medium text-white"
                          onClick={() =>
                            confirmWaveAlloc(
                              alloc.id,
                              alloc.remaining,
                              basketBarcode || alloc.order.basketCode || undefined,
                            )
                          }
                        >
                          Confirmar {alloc.remaining} un.
                        </button>
                      ) : (
                        <p className="mt-2 text-sm text-emerald-700">OK</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
