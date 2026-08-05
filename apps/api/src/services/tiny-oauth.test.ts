import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  buildOAuthState,
  parseAndVerifyOAuthState,
  mapTinyStatusToUi,
  extractCompanyMetadata,
  resolveOAuthRedirectUri,
  defaultOAuthRedirectUri,
} from "./tiny-oauth.js";
import {
  formatOAuthErrorMessage,
  formatOAuthCallbackQueryError,
  formatTinyApiForbiddenMessage,
  formatTinyApiValidationMessage,
} from "./tiny-oauth-errors.js";
import {
  decodeJwtPayload,
  extractAuthorizedUserFromIdToken,
} from "./tiny-oauth-log.js";
import {
  ACCESS_REFRESH_BEFORE_MS,
  REFRESH_TOKEN_SLIDE_MS,
  shouldRefreshTinyToken,
} from "./tiny-oauth-refresh.js";
import { TinyConnectionStatus } from "@prisma/client";

describe("tiny-oauth", () => {
  const prevSecret = process.env.AUTH_SECRET;

  before(() => {
    process.env.AUTH_SECRET = "test-auth-secret-for-oauth-hmac";
  });

  after(() => {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
  });

  it("gera e valida state OAuth com HMAC", () => {
    const state = buildOAuthState({
      userId: "user-1",
      tenantId: "tenant-1",
      connectionId: "conn-1",
    });
    const parsed = parseAndVerifyOAuthState(state);
    assert.ok(parsed);
    assert.equal(parsed.userId, "user-1");
    assert.equal(parsed.tenantId, "tenant-1");
    assert.equal(parsed.connectionId, "conn-1");
  });

  it("rejeita state adulterado", () => {
    const state = buildOAuthState({
      userId: "user-1",
      tenantId: "tenant-1",
      connectionId: "conn-1",
    });
    const tampered = state.replace("conn-1", "conn-2");
    assert.equal(parseAndVerifyOAuthState(tampered), null);
  });

  it("rejeita state malformado", () => {
    assert.equal(parseAndVerifyOAuthState("a:b:c"), null);
  });

  it("mapeia status para UI", () => {
    assert.equal(mapTinyStatusToUi(TinyConnectionStatus.CONNECTED), "VALID");
    assert.equal(mapTinyStatusToUi(TinyConnectionStatus.PENDING), "PENDING");
    assert.equal(mapTinyStatusToUi(TinyConnectionStatus.ERROR), "INVALID");
    assert.equal(mapTinyStatusToUi(TinyConnectionStatus.BLOCKED), "VALID");
    assert.equal(mapTinyStatusToUi(TinyConnectionStatus.CONNECTED, false), "INVALID");
  });

  it("extrai metadata da resposta /info", () => {
    const meta = extractCompanyMetadata({
      razaoSocial: "Loja Demo LTDA",
      cnpj: "12.345.678/0001-99",
    });
    assert.equal(meta.razaoSocial, "Loja Demo LTDA");
    assert.equal(meta.cnpj, "12.345.678/0001-99");
  });

  it("corrige redirect URI inválido para callback do backend", () => {
    const prev = process.env.API_PUBLIC_URL;
    process.env.API_PUBLIC_URL = "http://localhost:3333";
    try {
      assert.equal(
        resolveOAuthRedirectUri("https://app.visoratech.com.br"),
        "http://localhost:3333/integrations/tiny/oauth/callback",
      );
      assert.equal(
        resolveOAuthRedirectUri(
          "http://localhost:3333/integrations/tiny/oauth/callback",
        ),
        "http://localhost:3333/integrations/tiny/oauth/callback",
      );
      assert.equal(defaultOAuthRedirectUri(), resolveOAuthRedirectUri(null));
    } finally {
      if (prev === undefined) delete process.env.API_PUBLIC_URL;
      else process.env.API_PUBLIC_URL = prev;
    }
  });
});

describe("tiny-oauth-errors", () => {
  it("formata invalid_grant", () => {
    const msg = formatOAuthErrorMessage({ error: "invalid_grant" });
    assert.match(msg, /Conecte novamente/i);
  });

  it("formata redirect_uri", () => {
    const msg = formatOAuthErrorMessage({
      error: "invalid_request",
      error_description: "redirect_uri mismatch",
    });
    assert.match(msg, /Redirect URI/i);
  });

  it("formata HTTP 403 da API v3 com orientação de permissões", () => {
    const msg = formatTinyApiValidationMessage(403, {
      mensagem: "Permissão negada",
    });
    assert.match(msg, /HTTP 403/i);
    assert.match(msg, /administrador/i);
    assert.match(msg, /Permissão negada/);
  });

  it("formata 403 sem corpo da API", () => {
    const msg = formatTinyApiForbiddenMessage();
    assert.match(msg, /Acesso negado pela API Olist/i);
    assert.match(msg, /Configurações → Aplicativos/i);
  });

  it("formata access_denied no callback", () => {
    const msg = formatOAuthCallbackQueryError("access_denied");
    assert.match(msg, /administrador/i);
  });
});

describe("tiny-oauth-log", () => {
  it("extrai e-mail do id_token para auditoria", () => {
    const payload = Buffer.from(
      JSON.stringify({ email: "admin@loja.test", sub: "abc" }),
    ).toString("base64url");
    const token = `hdr.${payload}.sig`;
    assert.equal(extractAuthorizedUserFromIdToken(token), "admin@loja.test");
    assert.equal(decodeJwtPayload(token)?.email, "admin@loja.test");
  });
});

describe("tiny-oauth-refresh policy", () => {
  it("renova access token antes de expirar", () => {
    const now = Date.now();
    assert.equal(
      shouldRefreshTinyToken({
        now,
        tokenExpiresAt: now + ACCESS_REFRESH_BEFORE_MS - 60_000,
        updatedAt: now - 60_000,
      }),
      true,
    );
  });

  it("renova refresh token antes de completar 24h", () => {
    const now = Date.now();
    assert.equal(
      shouldRefreshTinyToken({
        now,
        tokenExpiresAt: now + 2 * 60 * 60 * 1000,
        updatedAt: now - REFRESH_TOKEN_SLIDE_MS - 1,
      }),
      true,
    );
  });

  it("não renova token recém emitido", () => {
    const now = Date.now();
    assert.equal(
      shouldRefreshTinyToken({
        now,
        tokenExpiresAt: now + 4 * 60 * 60 * 1000,
        updatedAt: now - 30 * 60 * 1000,
      }),
      false,
    );
  });
});
