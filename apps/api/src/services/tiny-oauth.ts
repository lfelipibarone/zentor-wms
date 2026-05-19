import * as crypto from "crypto";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { decrypt, encrypt } from "../lib/encryption.js";

const AUTHORIZE_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
const TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

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

export async function getOrCreateTinyConnection(tenantId: string) {
  let conn = await prisma.tinyConnection.findUnique({ where: { tenantId } });
  if (!conn) {
    conn = await prisma.tinyConnection.create({
      data: { tenantId, name: "Tiny ERP", status: TinyConnectionStatus.PENDING },
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
  return prisma.tinyConnection.update({
    where: { id: conn.id },
    data: {
      oauthClientId: params.clientId.trim(),
      oauthClientSecret: encrypt(params.clientSecret.trim()),
      oauthRedirectUri: (params.redirectUri?.trim() || defaultOAuthRedirectUri()),
      status: TinyConnectionStatus.PENDING,
      lastError: null,
    },
  });
}

export async function startTinyOAuth(
  tenantId: string,
  userId: string,
): Promise<{
  authUrl: string;
  connectionId: string;
}> {
  const conn = await getOrCreateTinyConnection(tenantId);
  if (!conn.oauthClientId || !conn.oauthClientSecret || !conn.oauthRedirectUri) {
    throw new Error(
      "Configure Client ID, Client Secret e Redirect URI antes de conectar.",
    );
  }

  const csrf = crypto.randomBytes(16).toString("hex");
  const state = `${csrf}:${userId}:${conn.id}`;

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", conn.oauthClientId);
  authUrl.searchParams.set("redirect_uri", conn.oauthRedirectUri);
  authUrl.searchParams.set("scope", "openid");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  return { authUrl: authUrl.toString(), connectionId: conn.id };
}

export async function handleTinyOAuthCallback(params: {
  code: string;
  state: string;
}): Promise<{ success: boolean; message: string; connectionId?: string }> {
  const parts = params.state.split(":");
  if (parts.length < 3) {
    return { success: false, message: "State OAuth inválido" };
  }

  const connectionId = parts[2];
  const conn = await prisma.tinyConnection.findUnique({ where: { id: connectionId } });
  if (!conn?.oauthClientId || !conn.oauthClientSecret || !conn.oauthRedirectUri) {
    return { success: false, message: "Credenciais OAuth não encontradas" };
  }

  const clientSecret = decrypt(conn.oauthClientSecret);

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: conn.oauthRedirectUri,
      client_id: conn.oauthClientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const err = (await tokenRes.json().catch(() => ({}))) as {
      error_description?: string;
    };
    await prisma.tinyConnection.update({
      where: { id: connectionId },
      data: {
        status: TinyConnectionStatus.ERROR,
        lastError: err.error_description ?? "Falha ao obter token",
      },
    });
    return {
      success: false,
      message: err.error_description ?? "Erro ao trocar código por token",
    };
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenData.access_token) {
    return { success: false, message: "access_token não retornado pelo Tiny" };
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  let companyName: string | undefined;
  try {
    const info = await fetch("https://api.tiny.com.br/public-api/v3/info", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (info.ok) {
      const infoJson = (await info.json()) as Record<string, unknown>;
      companyName =
        str(infoJson.nome) ??
        str(infoJson.razaoSocial) ??
        str(asRecord(infoJson.empresa)?.nome);
    }
  } catch {
    /* opcional */
  }

  await prisma.tinyConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: encrypt(tokenData.access_token),
      refreshToken: tokenData.refresh_token
        ? encrypt(tokenData.refresh_token)
        : conn.refreshToken,
      tokenExpiresAt: expiresAt,
      status: TinyConnectionStatus.CONNECTED,
      companyName: companyName ?? null,
      lastError: null,
    },
  });

  return {
    success: true,
    message: companyName
      ? `Conectado: ${companyName}`
      : "Tiny ERP conectado com sucesso",
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
  const origin = JSON.stringify(webUrl());
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Tiny OAuth</title></head>
<body>
<script>
  const data = ${payload};
  const target = ${origin};
  if (window.opener) {
    window.opener.postMessage(data, target);
    setTimeout(() => window.close(), 400);
  } else {
    window.location.href = target + '/integracoes/tiny?oauth=' + (data.success ? 'ok' : 'error');
  }
</script>
<p>${result.success ? "Conectado. Fechando…" : "Erro. Fechando…"}</p>
</body></html>`;
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

export async function getTinyConnectionStatus(tenantId: string) {
  const conn = await prisma.tinyConnection.findUnique({
    where: { tenantId },
  });
  if (!conn) {
    return {
      connected: false,
      status: "NONE" as const,
      redirectUri: defaultOAuthRedirectUri(),
    };
  }
  return {
    connected: conn.status === TinyConnectionStatus.CONNECTED,
    status: conn.status,
    companyName: conn.companyName,
    hasCredentials: Boolean(conn.oauthClientId && conn.oauthClientSecret),
    redirectUri: conn.oauthRedirectUri ?? defaultOAuthRedirectUri(),
    lastError: conn.lastError,
    tokenExpiresAt: conn.tokenExpiresAt?.toISOString() ?? null,
  };
}
