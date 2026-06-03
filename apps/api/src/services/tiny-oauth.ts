import * as crypto from "crypto";
import { Prisma, TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { decrypt, encrypt } from "../lib/encryption.js";
import { getTinyApiClient, TinyApiError } from "./tiny-api-v3-client.js";
import { formatOAuthErrorMessage } from "./tiny-oauth-errors.js";

const AUTHORIZE_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
const TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const INFO_URL = "https://api.tiny.com.br/public-api/v3/info";

export type TinyUiStatus = "NONE" | "VALID" | "PENDING" | "INVALID" | "BLOCKED";

export interface TinyConnectionMetadata {
  razaoSocial?: string;
  cnpj?: string;
  nome?: string;
  raw?: Record<string, unknown>;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET não configurado");
  }
  return secret;
}

function backendUrl(): string {
  return (process.env.API_PUBLIC_URL ?? process.env.API_URL ?? "http://localhost:3333").replace(
    /\/$/,
    "",
  );
}

function webUrl(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function defaultOAuthRedirectUri(): string {
  return `${backendUrl()}/integrations/tiny/oauth/callback`;
}

/** Callback OAuth deve ser sempre o endpoint do backend WMS. */
export function resolveOAuthRedirectUri(override?: string | null): string {
  const expected = defaultOAuthRedirectUri();
  const custom = override?.trim();
  if (!custom) return expected;

  try {
    const url = new URL(custom);
    if (url.pathname.replace(/\/$/, "") !== "/integrations/tiny/oauth/callback") {
      return expected;
    }
    return `${url.origin}/integrations/tiny/oauth/callback`;
  } catch {
    return expected;
  }
}

export function mapTinyStatusToUi(
  status: TinyConnectionStatus | "NONE",
  isActive = true,
): TinyUiStatus {
  if (!isActive) return "INVALID";
  switch (status) {
    case TinyConnectionStatus.CONNECTED:
      return "VALID";
    case TinyConnectionStatus.PENDING:
      return "PENDING";
    case TinyConnectionStatus.BLOCKED:
      return "BLOCKED";
    case TinyConnectionStatus.ERROR:
      return "INVALID";
    default:
      return "NONE";
  }
}

function signOAuthPayload(payload: string): string {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("hex");
}

export function buildOAuthState(params: {
  userId: string;
  tenantId: string;
  connectionId: string;
}): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const core = `${nonce}:${params.userId}:${params.tenantId}:${params.connectionId}`;
  const hmac = signOAuthPayload(core);
  return `${core}:${hmac}`;
}

export function parseAndVerifyOAuthState(state: string): {
  userId: string;
  tenantId: string;
  connectionId: string;
} | null {
  const parts = state.split(":");
  if (parts.length !== 5) return null;

  const [nonce, userId, tenantId, connectionId, hmac] = parts;
  if (!nonce || !userId || !tenantId || !connectionId || !hmac) return null;

  const core = `${nonce}:${userId}:${tenantId}:${connectionId}`;
  const expected = signOAuthPayload(core);
  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(hmac, "hex"),
      Buffer.from(expected, "hex"),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  return { userId, tenantId, connectionId };
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function extractCompanyMetadata(
  infoJson: Record<string, unknown>,
): TinyConnectionMetadata {
  const empresa = asRecord(infoJson.empresa);
  return {
    nome:
      str(infoJson.nome) ??
      str(infoJson.razaoSocial) ??
      str(empresa?.nome),
    razaoSocial:
      str(infoJson.razaoSocial) ??
      str(empresa?.razaoSocial) ??
      str(empresa?.nome),
    cnpj:
      str(infoJson.cnpj) ??
      str(infoJson.cpfCnpj) ??
      str(empresa?.cnpj) ??
      str(empresa?.cpfCnpj),
    raw: infoJson,
  };
}

async function clearOAuthTokens(connectionId: string) {
  await prisma.tinyConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: null,
      refreshToken: null,
      oauthIdToken: null,
      tokenExpiresAt: null,
      lastValidatedAt: null,
    },
  });
}

export async function getOrCreateTinyConnection(tenantId: string) {
  let conn = await prisma.tinyConnection.findUnique({ where: { tenantId } });
  if (!conn) {
    conn = await prisma.tinyConnection.create({
      data: {
        tenantId,
        name: "Tiny ERP",
        apiVersion: "v3",
        status: TinyConnectionStatus.PENDING,
        isActive: true,
      },
    });
  }
  return conn;
}

export async function saveTinyOAuthCredentials(
  tenantId: string,
  params: {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
  },
) {
  const conn = await getOrCreateTinyConnection(tenantId);
  const redirectUri = resolveOAuthRedirectUri(params.redirectUri);
  return prisma.tinyConnection.update({
    where: { id: conn.id },
    data: {
      oauthClientId: params.clientId.trim(),
      oauthClientSecret: encrypt(params.clientSecret.trim()),
      oauthRedirectUri: redirectUri,
      status: TinyConnectionStatus.PENDING,
      lastError: null,
      isActive: true,
      deletedAt: null,
    },
  });
}

export async function startTinyOAuth(
  tenantId: string,
  userId: string,
): Promise<{
  authUrl: string;
  state: string;
  connectionId: string;
}> {
  const conn = await getOrCreateTinyConnection(tenantId);
  if (!conn.oauthClientId || !conn.oauthClientSecret) {
    throw new Error(
      "Configure Client ID, Client Secret e Redirect URI antes de conectar.",
    );
  }

  const redirectUri = resolveOAuthRedirectUri(conn.oauthRedirectUri);
  if (redirectUri !== conn.oauthRedirectUri) {
    await prisma.tinyConnection.update({
      where: { id: conn.id },
      data: { oauthRedirectUri: redirectUri },
    });
  }

  const state = buildOAuthState({
    userId,
    tenantId,
    connectionId: conn.id,
  });

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", conn.oauthClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "login");

  return { authUrl: authUrl.toString(), state, connectionId: conn.id };
}

async function smokeTestWithAccessToken(accessToken: string): Promise<{
  ok: boolean;
  metadata?: TinyConnectionMetadata;
  message?: string;
}> {
  try {
    const res = await fetch(INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        message: `Validação API v3 falhou (HTTP ${res.status})`,
      };
    }
    const infoJson = (await res.json()) as Record<string, unknown>;
    return { ok: true, metadata: extractCompanyMetadata(infoJson) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha ao validar token na API v3",
    };
  }
}

export async function handleTinyOAuthCallback(params: {
  code: string;
  state: string;
}): Promise<{ success: boolean; message: string; connectionId?: string }> {
  const parsed = parseAndVerifyOAuthState(params.state);
  if (!parsed) {
    return { success: false, message: "State OAuth inválido ou adulterado" };
  }

  const { connectionId, tenantId } = parsed;
  const conn = await prisma.tinyConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.tenantId !== tenantId) {
    return { success: false, message: "Conexão OAuth não encontrada" };
  }
  if (!conn.oauthClientId || !conn.oauthClientSecret) {
    return { success: false, message: "Credenciais OAuth não encontradas" };
  }

  const redirectUri = resolveOAuthRedirectUri(conn.oauthRedirectUri);
  const clientSecret = decrypt(conn.oauthClientSecret);

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri,
      client_id: conn.oauthClientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!tokenRes.ok) {
    const err = (await tokenRes.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const message = formatOAuthErrorMessage(err);
    await prisma.tinyConnection.update({
      where: { id: connectionId },
      data: {
        status: TinyConnectionStatus.ERROR,
        lastError: message,
      },
    });
    return { success: false, message, connectionId };
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  if (!tokenData.access_token) {
    await clearOAuthTokens(connectionId);
    await prisma.tinyConnection.update({
      where: { id: connectionId },
      data: {
        status: TinyConnectionStatus.ERROR,
        lastError: "access_token não retornado pelo Olist",
      },
    });
    return { success: false, message: "access_token não retornado pelo Olist", connectionId };
  }

  const smoke = await smokeTestWithAccessToken(tokenData.access_token);
  if (!smoke.ok) {
    await clearOAuthTokens(connectionId);
    await prisma.tinyConnection.update({
      where: { id: connectionId },
      data: {
        status: TinyConnectionStatus.PENDING,
        lastError: smoke.message ?? "Token inválido na API v3",
      },
    });
    return {
      success: false,
      message: smoke.message ?? "Token inválido na API v3",
      connectionId,
    };
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;
  const metadata = smoke.metadata;
  const companyName = metadata?.razaoSocial ?? metadata?.nome ?? null;
  const now = new Date();

  await prisma.tinyConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: encrypt(tokenData.access_token),
      refreshToken: tokenData.refresh_token
        ? encrypt(tokenData.refresh_token)
        : conn.refreshToken,
      oauthIdToken: tokenData.id_token ? encrypt(tokenData.id_token) : null,
      tokenExpiresAt: expiresAt,
      status: TinyConnectionStatus.CONNECTED,
      companyName,
      metadata: metadata as unknown as Prisma.InputJsonValue,
      lastValidatedAt: now,
      lastError: null,
      isActive: true,
      deletedAt: null,
    },
  });

  return {
    success: true,
    message: companyName
      ? `Conectado: ${companyName}`
      : "Olist ERP conectado com sucesso",
    connectionId,
  };
}

export function oauthCallbackHtml(result: {
  success: boolean;
  message: string;
}): string {
  const payload = JSON.stringify({
    type: "tiny-oauth-callback",
    success: result.success,
    error: result.success ? null : result.message,
  });
  const erpAlias = JSON.stringify({
    type: "erp-oauth-callback",
    success: result.success,
    error: result.success ? null : result.message,
  });
  const origin = JSON.stringify(webUrl());
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Tiny OAuth</title></head>
<body>
<script>
  const data = ${payload};
  const erpData = ${erpAlias};
  const target = ${origin};
  if (window.opener) {
    window.opener.postMessage(data, target);
    window.opener.postMessage(erpData, target);
    setTimeout(() => window.close(), 400);
  } else {
    window.location.href = target + '/integracoes/tiny?oauth=' + (data.success ? 'ok' : 'error');
  }
</script>
<p>${result.success ? "Conectado. Fechando…" : "Erro. Fechando…"}</p>
</body></html>`;
}

export function oauthCallbackJson(result: {
  success: boolean;
  message: string;
  connectionId?: string;
}) {
  return {
    type: "tiny-oauth-callback",
    success: result.success,
    error: result.success ? null : result.message,
    message: result.message,
    connectionId: result.connectionId ?? null,
  };
}

export async function getTinyConnectionStatus(tenantId: string) {
  const conn = await prisma.tinyConnection.findUnique({
    where: { tenantId },
  });
  if (!conn || conn.deletedAt) {
    return {
      connected: false,
      status: "NONE" as const,
      uiStatus: "NONE" as TinyUiStatus,
      redirectUri: defaultOAuthRedirectUri(),
    };
  }

  const metadata = conn.metadata as TinyConnectionMetadata | null;

  const redirectUri = resolveOAuthRedirectUri(conn.oauthRedirectUri);

  return {
    connected:
      conn.isActive &&
      conn.status === TinyConnectionStatus.CONNECTED &&
      Boolean(conn.accessToken),
    status: conn.status,
    uiStatus: mapTinyStatusToUi(conn.status, conn.isActive),
    companyName: conn.companyName,
    metadata,
    hasCredentials: Boolean(conn.oauthClientId && conn.oauthClientSecret),
    oauthClientId: conn.oauthClientId,
    redirectUri,
    expectedRedirectUri: defaultOAuthRedirectUri(),
    redirectUriMismatch:
      Boolean(conn.oauthRedirectUri) &&
      conn.oauthRedirectUri !== redirectUri,
    lastError: conn.lastError,
    tokenExpiresAt: conn.tokenExpiresAt?.toISOString() ?? null,
    lastValidatedAt: conn.lastValidatedAt?.toISOString() ?? null,
    isActive: conn.isActive,
    connectionId: conn.id,
    isDraft:
      conn.status === TinyConnectionStatus.PENDING && !conn.accessToken,
  };
}

export async function testTinyConnection(tenantId: string): Promise<{
  ok: boolean;
  companyName?: string | null;
  metadata?: TinyConnectionMetadata | null;
  tokenExpiresAt?: string | null;
  message?: string;
}> {
  try {
    const client = await getTinyApiClient(tenantId);
    const info = await client.getInfo();
    const metadata = extractCompanyMetadata(info);
    const companyName = metadata.razaoSocial ?? metadata.nome ?? null;
    const now = new Date();

    const conn = await prisma.tinyConnection.findUnique({ where: { tenantId } });
    if (conn) {
      await prisma.tinyConnection.update({
        where: { id: conn.id },
        data: {
          companyName,
          metadata: metadata as unknown as Prisma.InputJsonValue,
          lastValidatedAt: now,
          lastError: null,
          status: TinyConnectionStatus.CONNECTED,
        },
      });
    }

    const updated = await prisma.tinyConnection.findUnique({ where: { tenantId } });
    return {
      ok: true,
      companyName,
      metadata,
      tokenExpiresAt: updated?.tokenExpiresAt?.toISOString() ?? null,
    };
  } catch (e) {
    const message =
      e instanceof TinyApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Falha ao testar conexão";

    const conn = await prisma.tinyConnection.findUnique({ where: { tenantId } });
    if (conn) {
      const status =
        e instanceof TinyApiError && e.statusCode === 429
          ? TinyConnectionStatus.BLOCKED
          : TinyConnectionStatus.ERROR;
      await prisma.tinyConnection.update({
        where: { id: conn.id },
        data: { lastError: message, status },
      });
    }

    return { ok: false, message };
  }
}

export async function disconnectTinyConnection(tenantId: string) {
  const conn = await prisma.tinyConnection.findUnique({ where: { tenantId } });
  if (!conn) {
    return { ok: true };
  }

  await prisma.tinyConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: null,
      refreshToken: null,
      oauthIdToken: null,
      tokenExpiresAt: null,
      lastValidatedAt: null,
      status: TinyConnectionStatus.PENDING,
      lastError: null,
      isActive: false,
    },
  });

  return { ok: true };
}

export async function cancelTinyDraft(tenantId: string) {
  const conn = await prisma.tinyConnection.findUnique({ where: { tenantId } });
  if (!conn) {
    return { ok: true };
  }

  if (conn.accessToken) {
    throw new Error("Não é possível cancelar: conexão já possui token OAuth");
  }

  await prisma.tinyConnection.update({
    where: { id: conn.id },
    data: {
      oauthClientId: null,
      oauthClientSecret: null,
      oauthRedirectUri: null,
      status: TinyConnectionStatus.PENDING,
      lastError: null,
      isActive: true,
    },
  });

  return { ok: true };
}

export async function listConnectionsForRefresh() {
  return prisma.tinyConnection.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      status: TinyConnectionStatus.CONNECTED,
      accessToken: { not: null },
      refreshToken: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      tokenExpiresAt: true,
      updatedAt: true,
    },
  });
}
