import { logIntegrationEvent } from "./tiny-integration.js";

export const TINY_OAUTH_REQUIRED_APP_PERMISSIONS = [
  "Dados da empresa",
  "Pedidos de venda",
  "Produtos",
  "Notas fiscais",
] as const;

export type TinyOAuthAuditStep =
  | "OAUTH_CALLBACK_STARTED"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_CONNECTION_NOT_FOUND"
  | "OAUTH_CREDENTIALS_MISSING"
  | "OAUTH_TOKEN_EXCHANGE_FAILED"
  | "OAUTH_TOKEN_MISSING"
  | "OAUTH_API_VALIDATION_FAILED"
  | "OAUTH_CONNECTED";

export interface TinyOAuthAuditPayload {
  step: TinyOAuthAuditStep;
  tenantId?: string;
  connectionId?: string;
  userId?: string;
  httpStatus?: number;
  endpoint?: string;
  oauthError?: string;
  apiMessage?: string;
  authorizedUser?: string;
  clientIdSuffix?: string;
}

type StructuredLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
};

function clientIdSuffix(clientId?: string | null): string | undefined {
  if (!clientId) return undefined;
  return clientId.length <= 8 ? clientId : clientId.slice(-8);
}

/** Decodifica payload JWT (sem validar assinatura) — só para auditoria. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function extractAuthorizedUserFromIdToken(
  idToken?: string | null,
): string | undefined {
  if (!idToken) return undefined;
  const payload = decodeJwtPayload(idToken);
  if (!payload) return undefined;
  const email = payload.email ?? payload.preferred_username;
  const name = payload.name;
  if (typeof email === "string" && email.trim()) return email.trim();
  if (typeof name === "string" && name.trim()) return name.trim();
  const sub = payload.sub;
  if (typeof sub === "string" && sub.trim()) return `sub:${sub.trim()}`;
  return undefined;
}

function auditStatus(step: TinyOAuthAuditStep): string {
  if (step === "OAUTH_CONNECTED") return "SUCCESS";
  if (step === "OAUTH_CALLBACK_STARTED") return "INFO";
  return "ERROR";
}

function auditMessage(step: TinyOAuthAuditStep, payload: TinyOAuthAuditPayload): string {
  switch (step) {
    case "OAUTH_STATE_INVALID":
      return "State OAuth inválido ou adulterado";
    case "OAUTH_CONNECTION_NOT_FOUND":
      return "Conexão OAuth não encontrada para o tenant";
    case "OAUTH_CREDENTIALS_MISSING":
      return "Client ID ou Client Secret ausentes no WMS";
    case "OAUTH_TOKEN_EXCHANGE_FAILED":
      return payload.oauthError
        ? `Troca de token falhou: ${payload.oauthError}`
        : `Troca de token falhou (HTTP ${payload.httpStatus ?? "?"})`;
    case "OAUTH_TOKEN_MISSING":
      return "Olist não retornou access_token";
    case "OAUTH_API_VALIDATION_FAILED":
      if (payload.httpStatus === 403) {
        const who = payload.authorizedUser
          ? ` Usuário autorizado: ${payload.authorizedUser}.`
          : "";
        return `API Olist retornou 403 em ${payload.endpoint ?? "GET /info"}.${who} Use administrador Tiny e permissões do aplicativo.`;
      }
      return payload.apiMessage
        ? `Validação API falhou (HTTP ${payload.httpStatus ?? "?"}): ${payload.apiMessage}`
        : `Validação API falhou (HTTP ${payload.httpStatus ?? "?"})`;
    case "OAUTH_CONNECTED":
      return payload.authorizedUser
        ? `Conectado — usuário Olist: ${payload.authorizedUser}`
        : "Conexão OAuth concluída";
    case "OAUTH_CALLBACK_STARTED":
      return "Callback OAuth recebido — trocando code por token";
    default:
      return step;
  }
}

export async function logTinyOAuthAudit(
  params: TinyOAuthAuditPayload & {
    tenantId: string;
    connectionId?: string;
    logger?: StructuredLogger;
  },
): Promise<void> {
  const status = auditStatus(params.step);
  const message = auditMessage(params.step, params);
  const payload = {
    step: params.step,
    httpStatus: params.httpStatus,
    endpoint: params.endpoint,
    oauthError: params.oauthError,
    apiMessage: params.apiMessage,
    authorizedUser: params.authorizedUser,
    clientIdSuffix: params.clientIdSuffix,
    userId: params.userId,
    requiredAppPermissions: TINY_OAUTH_REQUIRED_APP_PERMISSIONS,
  };

  params.logger?.[status === "ERROR" ? "warn" : "info"](
    {
      tinyOAuth: payload,
      tenantId: params.tenantId,
      connectionId: params.connectionId,
    },
    `[tiny-oauth] ${message}`,
  );

  await logIntegrationEvent({
    tenantId: params.tenantId,
    source: "TINY",
    eventType: params.step,
    externalId: params.connectionId,
    status,
    message,
    payload,
  });
}

export { clientIdSuffix };
