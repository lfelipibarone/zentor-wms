"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { apiFetch } from "@/lib/api/client";
import {
  fetchTinySyncStatus,
  syncTinyProducts,
  syncTinySalesOrders,
  type SyncTinyProductsResult,
  type SyncTinySalesOrdersResult,
  type TinySyncJobStatus,
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
  name?: string;
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
  isDefault?: boolean;
  isDraft?: boolean;
  connectionId?: string;
  connections?: TinyConnectionStatus[];
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

const EVENT_STATUS_COLORS: Record<string, string> = {
  SUCCESS: "bg-emerald-100 text-emerald-800",
  ERROR: "bg-red-100 text-red-800",
  INFO: "bg-sky-100 text-sky-800",
};

const OAUTH_EVENT_LABELS: Record<string, string> = {
  OAUTH_CALLBACK_STARTED: "OAuth iniciado",
  OAUTH_STATE_INVALID: "State inválido",
  OAUTH_CONNECTION_NOT_FOUND: "Conexão não encontrada",
  OAUTH_CREDENTIALS_MISSING: "Credenciais ausentes",
  OAUTH_TOKEN_EXCHANGE_FAILED: "Falha na troca de token",
  OAUTH_TOKEN_MISSING: "Token não retornado",
  OAUTH_API_VALIDATION_FAILED: "API negou acesso (403)",
  OAUTH_CONNECTED: "Conectado",
};

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

function SyncProgressCard({
  title,
  job,
  syncing,
}: {
  title: string;
  job: TinySyncJobStatus | null;
  syncing: boolean;
}) {
  if (!job) return null;

  const active = syncing || job.running;
  const pct = job.progressPercent ?? 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-slate-900">{title}</p>
        {active ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {syncing ? "Sincronizando…" : job.resumable ? "Pausado — retomável" : "Interrompido"}
          </span>
        ) : job.lastSyncAt ? (
          <span className="text-xs text-muted-foreground">
            Concluído em {formatDateTime(job.lastSyncAt)}
          </span>
        ) : null}
      </div>

      {active ? (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-[#0d9488] transition-all duration-500"
              style={{ width: `${Math.max(pct, job.offset ? 2 : 0)}%` }}
            />
          </div>
          <p className="mt-2 text-muted-foreground">{job.progressLabel}</p>
          {job.pauseReason === "rate_limit" ? (
            <p className="mt-1 text-xs text-amber-800">
              Pausado por rate limit da API Olist. O scheduler retoma automaticamente
              ou clique em sincronizar novamente.
            </p>
          ) : job.resumable && !syncing ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Progresso salvo em {formatDateTime(job.updatedAt)}. Clique em
              sincronizar para retomar de onde parou.
            </p>
          ) : null}
          {job.stats ? (
            <p className="mt-1 text-xs text-slate-600">
              Até agora: {job.stats.created ?? 0} criado(s), {job.stats.updated ?? 0}{" "}
              atualizado(s), {job.stats.skipped ?? 0} ignorado(s)
              {(job.stats.skippedExisting ?? 0) > 0
                ? `, ${job.stats.skippedExisting} já no WMS`
                : ""}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">{job.progressLabel}</p>
      )}
    </div>
  );
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
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncOrdersResult, setSyncOrdersResult] =
    useState<SyncTinySalesOrdersResult | null>(null);
  const [syncProductsResult, setSyncProductsResult] =
    useState<SyncTinyProductsResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<{
    products: TinySyncJobStatus;
    orders: TinySyncJobStatus;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    null,
  );
  const [addingAccount, setAddingAccount] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

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

  const loadSyncStatus = useCallback(async () => {
    try {
      const status = await fetchTinySyncStatus(activeConnectionId ?? undefined);
      setSyncStatus(status);
    } catch {
      /* status opcional — não bloqueia a página */
    }
  }, [activeConnectionId]);

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
      const nextActive =
        conn.connectionId ??
        conn.connections?.find((item) => item.isDefault)?.connectionId ??
        conn.connections?.[0]?.connectionId ??
        null;
      setActiveConnectionId(nextActive);
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
    if (loading || !connection?.connected) return;
    void loadSyncStatus();
  }, [loading, connection?.connected, activeConnectionId, loadSyncStatus]);

  useEffect(() => {
    if (!connection?.connected) return;
    const shouldPoll =
      syncingOrders ||
      syncingProducts ||
      syncStatus?.products.running ||
      syncStatus?.orders.running;
    if (!shouldPoll) return;

    const id = window.setInterval(() => {
      void loadSyncStatus();
    }, 4000);
    return () => window.clearInterval(id);
  }, [
    connection?.connected,
    syncingOrders,
    syncingProducts,
    syncStatus?.products.running,
    syncStatus?.orders.running,
    loadSyncStatus,
  ]);

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
        load();
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
            connectionId: activeConnectionId ?? undefined,
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
        {
          method: "POST",
          body: JSON.stringify({
            connectionId: activeConnectionId ?? undefined,
          }),
        },
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
      }>("/api/integrations/tiny/test-connection", {
        method: "POST",
        body: JSON.stringify({
          connectionId: activeConnectionId ?? undefined,
        }),
      });
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
      await apiFetch("/api/integrations/tiny/disconnect", {
        method: "POST",
        body: JSON.stringify({
          connectionId: activeConnectionId ?? undefined,
        }),
      });
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
      const result = await syncTinySalesOrders({
        days: 30,
        connectionId: activeConnectionId ?? undefined,
      });
      setSyncOrdersResult(result);
      if (!result.tinyConnected) {
        setError(result.warning ?? "Tiny ERP não conectado.");
        return;
      }
      if (result.rateLimited) {
        setError(
          result.warning ??
            "Rate limit Olist: sync pausada. Retomará automaticamente ou clique novamente.",
        );
      } else if (result.warning) {
        setError(result.warning);
      }
      if (!result.rateLimited) {
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
      }
      await loadSyncStatus();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao sincronizar pedidos");
    } finally {
      setSyncingOrders(false);
    }
  };

  const syncProducts = async (opts?: {
    forceRestart?: boolean;
    refreshExisting?: boolean;
  }) => {
    setSyncingProducts(true);
    setError(null);
    setSuccessMessage(null);
    setSyncProductsResult(null);
    try {
      const result = await syncTinyProducts({
        connectionId: activeConnectionId ?? undefined,
        forceRestart: opts?.forceRestart,
        refreshExisting: opts?.refreshExisting,
      });
      setSyncProductsResult(result);
      if (!result.tinyConnected) {
        setError(result.warning ?? "Tiny ERP não conectado.");
        return;
      }
      if (result.rateLimited) {
        setError(
          result.warning ??
            "Rate limit Olist: sync pausada. Clique em Sincronizar novamente para retomar.",
        );
      } else if (result.warning) {
        setError(result.warning);
      }
      if (!result.rateLimited) {
        const parts = [
          result.resumed
            ? `retomado do offset ${result.fromOffset}`
            : "concluído",
          `${result.listedFromTiny} listado(s) no Tiny`,
          `${result.created} criado(s)`,
          `${result.updated} atualizado(s)`,
          `${result.skipped} ignorado(s)`,
        ];
        if ((result.skippedExisting ?? 0) > 0) {
          parts.push(`${result.skippedExisting} já no WMS (sem nova consulta)`);
        }
        setSuccessMessage(`Sync de produtos ${parts.join(", ")}.`);
      }
      await loadSyncStatus();
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Se o servidor reiniciou, clique em Sincronizar novamente para retomar de onde parou.`
          : "Erro ao sincronizar produtos",
      );
    } finally {
      setSyncingProducts(false);
    }
  };

  const addAccount = async () => {
    setAddingAccount(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const conn = await apiFetch<TinyConnectionStatus>(
        "/api/integrations/tiny/connections",
        { method: "POST", body: "{}" },
      );
      setActiveConnectionId(conn.connectionId ?? null);
      setConnection(conn);
      if (conn.oauthClientId) setClientId(conn.oauthClientId);
      setClientSecret("");
      setSuccessMessage("Nova conta criada. Salve as credenciais e conecte com Olist.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao adicionar conta");
    } finally {
      setAddingAccount(false);
    }
  };

  const makeDefault = async (connectionId: string) => {
    setSettingDefault(true);
    setError(null);
    try {
      const conn = await apiFetch<TinyConnectionStatus>(
        "/api/integrations/tiny/connections/default",
        {
          method: "POST",
          body: JSON.stringify({ connectionId }),
        },
      );
      setConnection(conn);
      setActiveConnectionId(connectionId);
      setSuccessMessage("Conta padrão atualizada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao definir conta padrão");
    } finally {
      setSettingDefault(false);
    }
  };

  const selectConnection = async (connectionId: string) => {
    setActiveConnectionId(connectionId);
    setError(null);
    try {
      const conn = await apiFetch<TinyConnectionStatus>(
        `/api/integrations/tiny/connection?connectionId=${encodeURIComponent(connectionId)}`,
      );
      setConnection(conn);
      if (conn.oauthClientId) setClientId(conn.oauthClientId);
      setClientSecret("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar conta");
    }
  };

  const cancelDraft = async () => {
    setCancellingDraft(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const query = activeConnectionId
        ? `?connectionId=${encodeURIComponent(activeConnectionId)}`
        : "";
      await apiFetch(`/api/integrations/tiny/draft${query}`, {
        method: "DELETE",
      });
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
          Cada usuário conecta suas próprias contas Tiny/Olist. Você pode ter
          mais de uma conta vinculada — escolha a conta ativa abaixo ou adicione
          outra.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Crie um aplicativo em Configurações → Aplicativos no Olist/Tiny. O
          redirect URI abaixo deve ser <strong>idêntico</strong> ao registrado no
          painel (http/https, porta e path).
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          No popup de autorização, use um <strong>usuário administrador</strong>{" "}
          da conta Tiny e aceite as permissões do aplicativo (Dados da empresa,
          Pedidos, Produtos, Notas).
        </p>
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          O WMS renova tokens automaticamente (access ~4h, refresh ~24h). Se a
          API ficar parada por mais de um dia ou a{" "}
          <code className="text-[11px]">ENCRYPTION_KEY</code> mudar, clique em{" "}
          <strong>Conectar com Olist</strong> novamente.
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-[#0d9488]" />
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Suas contas Tiny</p>
                <button
                  type="button"
                  disabled={addingAccount}
                  onClick={addAccount}
                  className="rounded-lg border border-[#0d9488] px-3 py-1.5 text-sm font-medium text-[#0d9488] disabled:opacity-50"
                >
                  {addingAccount ? "Criando…" : "Adicionar conta"}
                </button>
              </div>
              {(connection?.connections?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma conta ainda. Salve as credenciais e conecte, ou clique em
                  Adicionar conta.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {connection?.connections?.map((item) => {
                    const itemStatus = item.uiStatus ?? "NONE";
                    const selected = item.connectionId === activeConnectionId;
                    const label =
                      item.companyName ??
                      item.name ??
                      item.connectionId?.slice(0, 8) ??
                      "Conta";
                    return (
                      <button
                        key={item.connectionId}
                        type="button"
                        onClick={() => {
                          if (item.connectionId) {
                            void selectConnection(item.connectionId);
                          }
                        }}
                        className={`rounded-lg border px-3 py-2 text-left text-sm ${
                          selected
                            ? "border-[#0d9488] bg-teal-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[itemStatus] ?? STATUS_COLORS.NONE}`}
                          >
                            {STATUS_LABELS[itemStatus] ?? itemStatus}
                          </span>
                          {item.isDefault ? (
                            <span className="text-[11px] font-medium text-[#0d9488]">
                              Padrão
                            </span>
                          ) : item.connected && item.connectionId ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                void makeDefault(item.connectionId!);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void makeDefault(item.connectionId!);
                                }
                              }}
                              className="text-[11px] text-slate-500 underline"
                            >
                              {settingDefault ? "Salvando…" : "Tornar padrão"}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 font-medium">{label}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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
            <SyncProgressCard
              title="Progresso — pedidos"
              job={syncStatus?.orders ?? null}
              syncing={syncingOrders}
            />
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
        <h2 className="text-sm font-semibold">Produtos</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Importa o catálogo do Tiny para a tabela{" "}
          <code className="text-xs">products</code> do WMS (SKU, nome, GTIN,
          unidade, peso e imagem). Pedidos de venda dependem desses SKUs
          cadastrados.
        </p>
        {connection?.connected ? (
          <div className="mt-4 space-y-3">
            <SyncProgressCard
              title="Progresso — produtos"
              job={syncStatus?.products ?? null}
              syncing={syncingProducts}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={syncingProducts}
                onClick={() => syncProducts()}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {syncingProducts ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Sincronizando…
                  </span>
                ) : (
                  "Sincronizar produtos"
                )}
              </button>
              <button
                type="button"
                disabled={syncingProducts}
                onClick={() => syncProducts({ forceRestart: true })}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                Recomeçar do zero
              </button>
            </div>
            {syncingProducts ? (
              <p className="text-sm text-muted-foreground">
                Importação em andamento. O progresso é salvo a cada página; se o
                servidor reiniciar, o scheduler retoma automaticamente em até 30s.
                SKUs já no WMS são ignorados (sem nova chamada à API Tiny).
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Retoma automaticamente após queda ou rate limit (scheduler a cada
                30s). Use «Recomeçar do zero» apenas para forçar reimportação
                completa.
              </p>
            )}
            {syncProductsResult && syncProductsResult.errors.length > 0 ? (
              <div className="max-h-40 overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  {syncProductsResult.errors.length} produto(s) com erro:
                </p>
                <ul className="mt-1 list-inside list-disc text-amber-800">
                  {syncProductsResult.errors.slice(0, 10).map((err) => (
                    <li key={`${err.sku}-${err.message}`}>
                      {err.sku}: {err.message}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${EVENT_STATUS_COLORS[ev.status] ?? "bg-slate-100 text-slate-700"}`}
                    >
                      {ev.status}
                    </span>
                    <span className="font-medium">
                      {OAUTH_EVENT_LABELS[ev.eventType] ?? ev.eventType}
                    </span>
                  </div>
                  <span className="text-muted-foreground">
                    {new Date(ev.createdAt).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{ev.message ?? "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
