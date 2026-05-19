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

interface TinyConnectionStatus {
  connected: boolean;
  status: string;
  companyName?: string | null;
  hasCredentials?: boolean;
  redirectUri?: string;
  lastError?: string | null;
  tokenExpiresAt?: string | null;
}

export default function TinyIntegracaoPage() {
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [connection, setConnection] = useState<TinyConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");

  const apiBase =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333")
      : "";

  const webhookUrl =
    typeof window !== "undefined"
      ? `${apiBase}/integrations/tiny/webhook`
      : "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evData, conn] = await Promise.all([
        apiFetch<{ events: IntegrationEvent[] }>(
          "/api/integrations/tiny/events",
        ),
        apiFetch<TinyConnectionStatus>("/api/integrations/tiny/connection"),
      ]);
      setEvents(evData.events);
      setConnection(conn);
      if (conn.redirectUri) setRedirectUri(conn.redirectUri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "tiny-oauth-callback") return;
      setConnecting(false);
      if (event.data.success) {
        load();
      } else {
        setError(event.data.error ?? "Falha na autenticação Tiny");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  const saveCredentials = async () => {
    setSaving(true);
    setError(null);
    try {
      const conn = await apiFetch<TinyConnectionStatus>(
        "/api/integrations/tiny/credentials",
        {
          method: "PUT",
          body: JSON.stringify({
            clientId,
            clientSecret,
            redirectUri: redirectUri || undefined,
          }),
        },
      );
      setConnection(conn);
      setClientSecret("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar credenciais");
    } finally {
      setSaving(false);
    }
  };

  const connectOAuth = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { authUrl } = await apiFetch<{ authUrl: string }>(
        "/api/integrations/tiny/oauth/authorize",
        { method: "POST" },
      );
      const w = 600;
      const h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      window.open(
        authUrl,
        "tiny-oauth",
        `width=${w},height=${h},left=${left},top=${top}`,
      );
    } catch (e) {
      setConnecting(false);
      setError(e instanceof Error ? e.message : "Erro ao iniciar OAuth");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integração Tiny ERP"
        description="OAuth v3 para recebimento de NF de compra no mobile e webhook de vendas."
      />

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Conexão OAuth (API v3)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Crie um aplicativo em Configurações → Aplicativos no Tiny e use o
          redirect URI abaixo. Permissões: notas fiscais (entrada) e, se
          disponível, conferência de compra.
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-[#0d9488]" />
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p>
                Status:{" "}
                <span className="font-medium">
                  {connection?.connected
                    ? `Conectado${connection.companyName ? ` — ${connection.companyName}` : ""}`
                    : connection?.status ?? "Não configurado"}
                </span>
              </p>
              {connection?.lastError ? (
                <p className="mt-1 text-red-600">{connection.lastError}</p>
              ) : null}
            </div>

            <label className="mt-4 block text-sm font-medium">Redirect URI</label>
            <p className="mt-1 break-all rounded-lg bg-slate-50 p-2 font-mono text-xs">
              {redirectUri || `${apiBase}/integrations/tiny/oauth/callback`}
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Client ID</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Do aplicativo Tiny"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Client Secret</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={
                    connection?.hasCredentials
                      ? "Deixe vazio para manter o atual"
                      : "Secret do aplicativo"
                  }
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-sm font-medium">
                Redirect URI (opcional)
              </label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono"
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                placeholder={`${apiBase}/integrations/tiny/oauth/callback`}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  saving || !clientId || (!clientSecret && !connection?.hasCredentials)
                }
                onClick={saveCredentials}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar credenciais"}
              </button>
              <button
                type="button"
                disabled={connecting || !connection?.hasCredentials}
                onClick={connectOAuth}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {connecting ? "Aguardando Tiny…" : "Conectar com Tiny"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Webhook (vendas)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure no Tiny (Configurações → Webhooks → notificações de vendas) a
          URL abaixo. Token em Admin → Configurações (
          <code className="text-xs">tiny.webhook.secret</code>).
        </p>
        <p className="mt-3 break-all rounded-lg bg-slate-50 p-3 font-mono text-sm">
          {webhookUrl}
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

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {loading ? null : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-auto text-sm">
            {events.map((ev) => (
              <li key={ev.id} className="rounded-lg border px-3 py-2">
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
