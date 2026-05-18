"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { apiFetch } from "@/lib/api/client";

interface IntegrationEvent {
  id: string;
  eventType: string;
  externalId: string | null;
  status: string;
  message: string | null;
  createdAt: string;
}

export default function TinyIntegracaoPage() {
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const webhookUrl =
    typeof window !== "undefined"
      ? `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333"}/integrations/tiny/webhook`
      : "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ events: IntegrationEvent[] }>(
        "/api/integrations/tiny/events",
      );
      setEvents(data.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integração Tiny ERP"
        description="Receba pedidos via webhook e enriqueça prioridade por marketplace no WMS."
      />

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Webhook</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure no Tiny (Configurações → Webhooks → notificações de vendas) a
          URL abaixo. Defina o token em Admin → Configurações (
          <code className="text-xs">tiny.webhook.secret</code>) e envie no header{" "}
          <code className="text-xs">x-tiny-token</code>.
        </p>
        <p className="mt-3 break-all rounded-lg bg-slate-50 p-3 font-mono text-sm">
          {webhookUrl}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          A prioridade do pedido é calculada no WMS com base na coleta do
          marketplace (não vem direto do Tiny).
        </p>
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Últimos eventos</h2>
          <button
            type="button"
            onClick={load}
            className="text-sm font-medium text-[#0d9488] underline"
          >
            Atualizar
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[#0d9488]" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-auto text-sm">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="rounded-lg border px-3 py-2"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{ev.status}</span>
                  <span className="text-muted-foreground">
                    {new Date(ev.createdAt).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {ev.externalId ?? "—"} · {ev.message ?? ev.eventType}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
