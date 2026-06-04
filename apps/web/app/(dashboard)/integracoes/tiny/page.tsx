"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { apiFetch } from "@/lib/api/client";
import {
  syncTinySalesOrders,
  type SyncTinySalesOrdersResult,
} from "@/lib/api/operations";

interface IntegrationEvent {
  id: string;
  eventType: string;
  externalId: string | null;
  status: string;
  message: string | null;
  createdAt: string;
}

interface TinyConnectionMetadata {
  razaoSocial?: string;
  cnpj?: string;
  nome?: string;
}

interface TinyConnectionStatus {
  connected: boolean;
  status: string;
  uiStatus?: "NONE" | "VALID" | "PENDING" | "INVALID" | "BLOCKED";
  companyName?: string | null;
  metadata?: TinyConnectionMetadata | null;
  hasCredentials?: boolean;
  oauthClientId?: string | null;
  redirectUri?: string;
  expectedRedirectUri?: string;
  redirectUriMismatch?: boolean;
  lastError?: string | null;
  tokenExpiresAt?: string | null;
  lastValidatedAt?: string | null;
  isActive?: boolean;
  isDraft?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  VALID: "Conectado",
  PENDING: "Pendente",
  INVALID: "Erro",
  BLOCKED: "Bloqueado (rate limit)",
  NONE: "Não configurado",
};

const STATUS_COLORS: Record<string, string> = {
  VALID: "bg-emerald-100 text-emerald-800",
  PENDING: "bg-amber-100 text-amber-800",
  INVALID: "bg-red-100 text-red-800",
  BLOCKED: "bg-orange-100 text-orange-800",
  NONE: "bg-slate-100 text-slate-700",
};

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export default function TinyIntegracaoPage() {
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [connection, setConnection] = useState<TinyConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [cancellingDraft, setCancellingDraft] = useState(false);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [syncOrdersResult, setSyncOrdersResult] =
    useState<SyncTinySalesOrdersResult | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const apiBase =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333")
      : "";

  const callbackUri =
    connection?.redirectUri ??
    connection?.expectedRedirectUri ??
    `${apiBase}/integrations/tiny/oauth/callback`;

  const webhookUrl =
    typeof window !== "undefined"
      ? `${apiBase}/integrations/tiny/webhook`
      : "";

  const uiStatus = connection?.uiStatus ?? "NONE";

  const canSaveCredentials =
    Boolean(clientId.trim()) &&
    (Boolean(clientSecret.trim()) || Boolean(connection?.hasCredentials));

  /** Habilita conectar quando há credenciais no formulário ou já salvas no servidor. */
  const canConnectOAuth = canSaveCredentials;

  const credentialsDirty =
    Boolean(clientSecret.trim()) ||
    (Boolean(clientId.trim()) &&
      clientId.trim() !== (connection?.oauthClientId ?? ""));

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
      if (conn.oauthClientId) setClientId(conn.oauthClientId);
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
      const type = event.data?.type;
      if (type !== "tiny-oauth-callback" && type !== "erp-oauth-callback") return;
      setConnecting(false);
      if (event.data.success) {
        setSuccessMessage("Conta Olist conectada com sucesso.");
        load();
      } else {
        setError(event.data.error ?? "Falha na autenticação Olist");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  const saveCredentials = async (): Promise<TinyConnectionStatus> => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const conn = await apiFetch<TinyConnectionStatus>(
        "/api/integrations/tiny/credentials",
        {
          method: "PUT",
          body: JSON.stringify({
            clientId,
            clientSecret: clientSecret || undefined,
          }),
        },
      );
      setConnection(conn);
      if (clientSecret) setClientSecret("");
      setSuccessMessage("Credenciais salvas.");
      return conn;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar credenciais");
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const connectOAuth = async () => {
    setConnecting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (!connection?.hasCredentials || credentialsDirty) {
        if (!clientSecret.trim() && !connection?.hasCredentials) {
          setError("Informe o Client Secret antes de conectar.");
          setConnecting(false);
          return;
        }
        await saveCredentials();
      }

      const { authUrl } = await apiFetch<{ authUrl: string }>(
        "/api/integrations/tiny/oauth/authorize",
        { method: "POST", body: "{}" },
      );
      if (!authUrl.includes("accounts.tiny.com.br")) {
        throw new Error("URL de autenticação Olist inválida. Tente salvar as credenciais novamente.");
      }
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

  const testConnection = async () => {
    setTesting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await apiFetch<{
        ok: boolean;
        companyName?: string;
        message?: string;
      }>("/api/integrations/tiny/test-connection", { method: "POST", body: "{}" });
      if (result.ok) {
        setSuccessMessage(
          result.companyName
            ? `Conexão OK — ${result.companyName}`
            : "Conexão com API v3 OK.",
        );
        await load();
      } else {
        setError(result.message ?? "Falha ao testar conexão");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao testar conexão");
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await apiFetch("/api/integrations/tiny/disconnect", { method: "POST", body: "{}" });
      setSuccessMessage("Conta desvinculada. Tokens removidos.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao desvincular");
    } finally {
      setDisconnecting(false);
    }
  };

  const syncOrders = async () => {
    setSyncingOrders(true);
    setError(null);
    setSuccessMessage(null);
    setSyncOrdersResult(null);
    try {
      const result = await syncTinySalesOrders({ days: 30 });
      setSyncOrdersResult(result);
      if (!result.tinyConnected) {
        setError(result.warning ?? "Tiny ERP não conectado.");
        return;
      }
      if (result.warning) {
        setError(result.warning);
      }
      const parts = [
        `${result.listedFromTiny ?? 0} listado(s) no Tiny`,
        `${result.created} criado(s)`,
        `${result.updated} atualizado(s)`,
        `${result.skipped} ignorado(s)`,
      ];
      if (result.ordersRemoved > 0 || result.wavesRemoved > 0) {
        parts.push(
          `${result.ordersRemoved} pedido(s) removido(s)`,
          `${result.wavesRemoved} onda(s) removida(s)`,
        );
      }
      if (result.demoRemoved > 0) {
        parts.push(`${result.demoRemoved} demo removido(s)`);
      }
      if (result.cancelledRemoved > 0) {
        parts.push(`${result.cancelledRemoved} cancelado(s) removido(s)`);
      }
      setSuccessMessage(`Pedidos sincronizados: ${parts.join(", ")}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao sincronizar pedidos");
    } finally {
      setSyncingOrders(false);
    }
  };

  const cancelDraft = async () => {
    setCancellingDraft(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await apiFetch("/api/integrations/tiny/draft", { method: "DELETE" });
      setSuccessMessage("Rascunho cancelado.");
      setClientId("");
      setClientSecret("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao cancelar rascunho");
    } finally {
      setCancellingDraft(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integração Olist ERP (Tiny)"
        description="OAuth API v3 — conexão segura, refresh automático e teste de conexão."
      />

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Conexão OAuth (API v3)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Crie um aplicativo em Configurações → Aplicativos no Olist/Tiny. O
          redirect URI abaixo deve ser <strong>idêntico</strong> ao registrado no
          painel (http/https, porta e path).
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-[#0d9488]" />
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[uiStatus] ?? STATUS_COLORS.NONE}`}
              >
                {STATUS_LABELS[uiStatus] ?? uiStatus}
              </span>
              {connection?.companyName ? (
                <span className="text-sm font-medium">{connection.companyName}</span>
              ) : null}
            </div>

            {connection?.metadata?.cnpj ? (
              <p className="mt-2 text-sm text-muted-foreground">
                CNPJ: {connection.metadata.cnpj}
              </p>
            ) : null}

            <div className="mt-3 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
              <p>Token expira: {formatDateTime(connection?.tokenExpiresAt)}</p>
              <p>Última validação: {formatDateTime(connection?.lastValidatedAt)}</p>
            </div>

            {connection?.lastError ? (
              <p className="mt-2 text-sm text-red-600">{connection.lastError}</p>
            ) : null}
            {successMessage ? (
              <p className="mt-2 text-sm text-emerald-700">{successMessage}</p>
            ) : null}

            <label className="mt-4 block text-sm font-medium">
              Redirect URI (cadastre no aplicativo Olist)
            </label>
            <p className="mt-1 break-all rounded-lg bg-slate-50 p-2 font-mono text-xs">
              {callbackUri}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              No painel Olist → Configurações → Aplicativos, o redirect URI deve ser{" "}
              <strong>idêntico</strong> ao endereço acima (incluindo http, porta e path).
              O popup abre primeiro o login em{" "}
              <span className="font-mono">accounts.tiny.com.br</span> e só depois retorna
              aqui para capturar o token.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Client ID</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Do aplicativo Olist"
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

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || !canSaveCredentials}
                onClick={() => {
                  void saveCredentials().catch(() => undefined);
                }}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar credenciais"}
              </button>
              <button
                type="button"
                disabled={connecting || saving || !canConnectOAuth}
                onClick={connectOAuth}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {connecting ? "Aguardando Olist…" : "Conectar com Olist"}
              </button>
              {connection?.connected ? (
                <button
                  type="button"
                  disabled={testing}
                  onClick={testConnection}
                  className="rounded-lg border border-[#0d9488] px-4 py-2 text-sm font-medium text-[#0d9488] disabled:opacity-50"
                >
                  {testing ? "Testando…" : "Testar conexão"}
                </button>
              ) : null}
              {connection?.connected || connection?.status === "ERROR" ? (
                <button
                  type="button"
                  disabled={disconnecting}
                  onClick={disconnect}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                >
                  {disconnecting ? "Desvinculando…" : "Desvincular"}
                </button>
              ) : null}
              {connection?.isDraft ? (
                <button
                  type="button"
                  disabled={cancellingDraft}
                  onClick={cancelDraft}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  {cancellingDraft ? "Cancelando…" : "Cancelar rascunho"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Pedidos de venda</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A sincronização é automática: roda todos os dias às 7h e o webhook
          atualiza novos pedidos em tempo real. Os SKUs precisam existir no
          cadastro de produtos.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          O botão abaixo fica apenas como fallback administrativo.
        </p>
        {connection?.connected ? (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              disabled={syncingOrders}
              onClick={syncOrders}
              className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {syncingOrders ? "Sincronizando…" : "Reexecutar sync manual"}
            </button>
            {syncOrdersResult && syncOrdersResult.errors.length > 0 ? (
              <div className="max-h-40 overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  {syncOrdersResult.errors.length} pedido(s) com erro:
                </p>
                <ul className="mt-1 list-inside list-disc text-amber-800">
                  {syncOrdersResult.errors.slice(0, 10).map((err) => (
                    <li key={err.erpOrderId}>
                      {err.erpOrderId}: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Conecte o OAuth acima para habilitar a sincronização.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Webhook (vendas)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure no Olist (Configurações → Webhooks → notificações de vendas) a
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
