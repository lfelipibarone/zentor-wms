import { decrypt, encrypt } from "../lib/encryption.js";
import { prisma } from "../lib/prisma.js";
import { TinyConnectionStatus } from "@prisma/client";

const BASE_URL = "https://api.tiny.com.br/public-api/v3";
const TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
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
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error_description?: string;
        error?: string;
      };
      await prisma.tinyConnection.update({
        where: { id: this.connectionId },
        data: {
          status: TinyConnectionStatus.ERROR,
          lastError: err.error_description ?? err.error ?? "Refresh falhou",
        },
      });
      throw new TinyApiError(
        "Token Tiny expirado. Reconecte em Integrações → Tiny.",
        401,
        "TOKEN_EXPIRED",
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
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
    const run = async (retry: boolean): Promise<T> => {
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
      });

      if (res.status === 401 && !retry) {
        await this.refreshAccessToken();
        return run(true);
      }

      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        const rec = asRecord(data);
        const msg =
          str(rec?.mensagem) ??
          str(asRecord(rec?.error)?.message) ??
          `Erro Tiny HTTP ${res.status}`;
        throw new TinyApiError(msg, res.status);
      }

      return data as T;
    };

    return run(false);
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

  /**
   * Tenta mover a nota para "pronto para conferir" na extensão Conferência de Compra.
   * Endpoints não documentados publicamente — falha silenciosa é tratada pelo caller.
   */
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

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
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
  if (!conn?.accessToken || conn.status !== TinyConnectionStatus.CONNECTED) {
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
    const client = new TinyApiV3Client(token, conn.id);
    const fresh = await refreshTinyAccessToken(conn.id);
    return new TinyApiV3Client(fresh, conn.id);
  }

  return new TinyApiV3Client(token, conn.id);
}
