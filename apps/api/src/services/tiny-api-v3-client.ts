import { decrypt, encrypt } from "../lib/encryption.js";
import { prisma } from "../lib/prisma.js";
import { TinyConnectionStatus } from "@prisma/client";
import { formatOAuthErrorMessage } from "./tiny-oauth-errors.js";

const BASE_URL = "https://api.tiny.com.br/public-api/v3";
const TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const REQUEST_TIMEOUT_MS = 30_000;
const MIN_REQUEST_INTERVAL_MS = 1_200;
const MAX_429_RETRIES = 3;

export class TinyApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
  ) {
    super(message);
    this.name = "TinyApiError";
  }
}

const lastRequestAtByConnection = new Map<string, number>();

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleConnection(connectionId: string) {
  const last = lastRequestAtByConnection.get(connectionId) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestAtByConnection.set(connectionId, Date.now());
}

function parseRateLimitReset(headers: Headers): number {
  const reset = Number(headers.get("X-RateLimit-Reset") ?? 0);
  return Number.isFinite(reset) && reset > 0 ? reset * 1000 : 60_000;
}

export class TinyApiV3Client {
  private accessToken: string;
  private connectionId: string;

  constructor(accessToken: string, connectionId: string) {
    this.accessToken = accessToken;
    this.connectionId = connectionId;
  }

  async refreshAccessToken(): Promise<string> {
    const conn = await prisma.tinyConnection.findUnique({
      where: { id: this.connectionId },
    });
    if (
      !conn?.refreshToken ||
      !conn.oauthClientId ||
      !conn.oauthClientSecret
    ) {
      throw new TinyApiError(
        "Credenciais OAuth incompletas. Reconecte o Tiny nas integrações.",
        401,
        "OAUTH_INCOMPLETE",
      );
    }

    const refreshToken = decrypt(conn.refreshToken);
    const clientSecret = decrypt(conn.oauthClientSecret);

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: conn.oauthClientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error_description?: string;
        error?: string;
      };
      const message = formatOAuthErrorMessage(err);
      const isInvalidGrant = err.error?.toLowerCase() === "invalid_grant";
      await prisma.tinyConnection.update({
        where: { id: this.connectionId },
        data: {
          status: TinyConnectionStatus.ERROR,
          lastError: message,
          ...(isInvalidGrant
            ? {
                accessToken: null,
                refreshToken: null,
                oauthIdToken: null,
                tokenExpiresAt: null,
              }
            : {}),
        },
      });
      throw new TinyApiError(message, 401, isInvalidGrant ? "INVALID_GRANT" : "TOKEN_EXPIRED");
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new TinyApiError("Resposta OAuth sem access_token");
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await prisma.tinyConnection.update({
      where: { id: this.connectionId },
      data: {
        accessToken: encrypt(data.access_token),
        refreshToken: data.refresh_token
          ? encrypt(data.refresh_token)
          : conn.refreshToken,
        oauthIdToken: data.id_token ? encrypt(data.id_token) : conn.oauthIdToken,
        tokenExpiresAt: expiresAt,
        status: TinyConnectionStatus.CONNECTED,
        lastError: null,
      },
    });

    this.accessToken = data.access_token;
    return data.access_token;
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options?: { query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T> {
    const run = async (
      retry401: boolean,
      retry429Count: number,
    ): Promise<T> => {
      await throttleConnection(this.connectionId);

      const url = new URL(
        path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`,
      );
      if (options?.query) {
        for (const [k, v] of Object.entries(options.query)) {
          if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
        }
      }

      const res = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(options?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.status === 401 && !retry401) {
        await this.refreshAccessToken();
        return run(true, retry429Count);
      }

      if (res.status === 429 && retry429Count < MAX_429_RETRIES) {
        const waitMs = parseRateLimitReset(res.headers);
        await sleep(waitMs);
        return run(retry401, retry429Count + 1);
      }

      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        if (res.status === 429) {
          await prisma.tinyConnection.update({
            where: { id: this.connectionId },
            data: {
              status: TinyConnectionStatus.BLOCKED,
              lastError: "Rate limit Olist ERP excedido. Aguarde e tente novamente.",
            },
          });
        }
        const rec = asRecord(data);
        const msg =
          str(rec?.mensagem) ??
          str(asRecord(rec?.error)?.message) ??
          `Erro Tiny HTTP ${res.status}`;
        throw new TinyApiError(msg, res.status, res.status === 429 ? "RATE_LIMIT" : undefined);
      }

      return data as T;
    };

    return run(false, 0);
  }

  async getInfo() {
    return this.request<Record<string, unknown>>("GET", "/info");
  }

  async listEntryInvoices(params: {
    dataInicial?: string;
    dataFinal?: string;
    limit?: number;
    offset?: number;
  }) {
    const body = await this.request<{
      itens?: unknown[];
      paginacao?: { total?: number; limit?: number; offset?: number };
    }>("GET", "/notas", {
      query: {
        tipo: "E",
        dataInicial: params.dataInicial,
        dataFinal: params.dataFinal,
        limit: params.limit ?? 100,
        offset: params.offset ?? 0,
        orderBy: "desc",
      },
    });
    return {
      items: asArray(body.itens),
      pagination: body.paginacao ?? {},
    };
  }

  async getInvoice(id: number | string) {
    return this.request<Record<string, unknown>>("GET", `/notas/${id}`);
  }

  async listPedidos(params: {
    dataInicial?: string;
    dataFinal?: string;
    origemPedido?: number;
    situacao?: number;
    limit?: number;
    offset?: number;
  }) {
    const body = await this.request<{
      itens?: unknown[];
      paginacao?: { total?: number; limit?: number; offset?: number };
    }>("GET", "/pedidos", {
      query: {
        dataInicial: params.dataInicial,
        dataFinal: params.dataFinal,
        origemPedido: params.origemPedido ?? 0,
        situacao: params.situacao,
        limit: params.limit ?? 100,
        offset: params.offset ?? 0,
        orderBy: "desc",
      },
    });
    return {
      items: asArray(body.itens),
      pagination: body.paginacao ?? {},
    };
  }

  async getPedido(id: number | string) {
    return this.request<Record<string, unknown>>("GET", `/pedidos/${id}`);
  }

  async tryMarkReadyForConference(notaId: number | string): Promise<{
    ok: boolean;
    endpoint?: string;
    message?: string;
  }> {
    const attempts: Array<{ method: "POST" | "PUT"; path: string; body?: unknown }> = [
      { method: "POST", path: `/notas/${notaId}/receber-mercadorias` },
      { method: "POST", path: `/conferencia-compra/${notaId}/receber-mercadorias` },
      { method: "PUT", path: `/conferencia-compra/${notaId}/situacao`, body: { situacao: "pronto_para_conferir" } },
      { method: "POST", path: `/conferencia-compra/notas/${notaId}/receber` },
    ];

    for (const attempt of attempts) {
      try {
        await this.request(attempt.method, attempt.path, { body: attempt.body });
        return { ok: true, endpoint: attempt.path };
      } catch (e) {
        if (e instanceof TinyApiError && e.statusCode === 404) continue;
      }
    }

    return {
      ok: false,
      message:
        "API pública não expõe conferência de compra; status atualizado apenas no WMS.",
    };
  }
}

export async function refreshTinyAccessToken(connectionId: string): Promise<string> {
  const conn = await prisma.tinyConnection.findUnique({ where: { id: connectionId } });
  if (!conn?.accessToken) {
    throw new TinyApiError("Conexão Tiny sem token.");
  }
  const client = new TinyApiV3Client(decrypt(conn.accessToken), connectionId);
  return client.refreshAccessToken();
}

export async function getTinyApiClient(tenantId: string): Promise<TinyApiV3Client> {
  const conn = await prisma.tinyConnection.findUnique({
    where: { tenantId },
  });
  if (
    !conn?.accessToken ||
    conn.status !== TinyConnectionStatus.CONNECTED ||
    !conn.isActive ||
    conn.deletedAt
  ) {
    throw new TinyApiError(
      "Tiny ERP não conectado. Configure OAuth em Integrações → Tiny.",
      503,
      "NOT_CONNECTED",
    );
  }

  let token: string;
  try {
    token = decrypt(conn.accessToken);
  } catch {
    throw new TinyApiError("Falha ao ler token Tiny (ENCRYPTION_KEY).", 500);
  }

  const expiresSoon =
    conn.tokenExpiresAt &&
    conn.tokenExpiresAt.getTime() < Date.now() + 60_000;

  if (expiresSoon && conn.refreshToken) {
    const fresh = await refreshTinyAccessToken(conn.id);
    return new TinyApiV3Client(fresh, conn.id);
  }

  return new TinyApiV3Client(token, conn.id);
}
