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
import {
  closeWave,
  fetchWavePreview,
  fetchWaves,
  releaseWave,
  type WavePreview,
  type WaveRow,
} from "@/lib/api/waves";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  RELEASED: "Ativa",
  CLOSED: "Encerrada",
};

export default function OndasPage() {
  const [waves, setWaves] = useState<WaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<WavePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWaves();
      setWaves(data.waves);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar ondas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadPreview = async () => {
    setPreviewLoading(true);
    setMessage(null);
    try {
      const data = await fetchWavePreview();
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setMessage(e instanceof Error ? e.message : "Falha ao gerar prévia");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRelease = async () => {
    setReleasing(true);
    setMessage(null);
    try {
      const result = await releaseWave({ auto: true });
      setMessage(
        `Onda liberada: ${result.orderCount} pedidos → ${result.lineCount} passagens na gôndola (mesmo SKU agrupado).`,
      );
      setPreview(null);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao liberar onda");
    } finally {
      setReleasing(false);
    }
  };

  const handleClose = async (id: string) => {
    try {
      await closeWave(id);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao encerrar");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ondas de separação"
        description="Agrupa pedidos com o mesmo SKU na mesma gôndola. O operador aceita a onda no app antes de separar."
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={previewLoading}
          onClick={loadPreview}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium"
        >
          {previewLoading ? "Calculando…" : "Pré-visualizar onda"}
        </button>
        <button
          type="button"
          disabled={releasing || !preview || preview.orderCount === 0}
          onClick={handleRelease}
          className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {releasing ? "Liberando…" : "Confirmar e liberar onda"}
        </button>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium"
        >
          Atualizar
        </button>
      </div>

      {preview ? (
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Prévia da onda</h2>
          {preview.error ? (
            <p className="text-sm text-amber-700">{preview.error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {preview.orderCount} pedido(s) → {preview.gondolaPasses} passagem(ns)
              na gôndola (linhas por SKU/local)
            </p>
          )}
          {preview.lines.length > 0 ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-sm">
              {preview.lines.map((l, i) => (
                <li key={i} className="font-mono text-slate-700">
                  {l.productSku} · {l.locationLabel} · {l.quantityTotal} un. ·{" "}
                  {l.orderCount} pedido(s)
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      <DataState loading={loading} error={error} empty={waves.length === 0}>
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pedidos</TableHead>
                <TableHead>Linhas</TableHead>
                <TableHead>Liberada</TableHead>
                <TableHead>Aceita por</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {waves.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell>{STATUS_LABEL[w.status] ?? w.status}</TableCell>
                  <TableCell>{w.orderCount}</TableCell>
                  <TableCell>{w.lineCount}</TableCell>
                  <TableCell>
                    {w.releasedAt
                      ? new Date(w.releasedAt).toLocaleString("pt-BR")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {w.acceptedBy
                      ? `${w.acceptedBy}${w.acceptedAt ? ` · ${new Date(w.acceptedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}`
                      : w.status === "RELEASED"
                        ? "Aguardando aceite"
                        : "—"}
                  </TableCell>
                  <TableCell>
                    {w.status === "RELEASED" ? (
                      <button
                        type="button"
                        onClick={() => handleClose(w.id)}
                        className="text-sm font-semibold text-amber-700 underline"
                      >
                        Encerrar
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DataState>
    </div>
  );
}