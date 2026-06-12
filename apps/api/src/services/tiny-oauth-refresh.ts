/**
 * Política de renovação OAuth Tiny/Olist (API v3).
 * @see https://api-docs.erp.olist.com/documentacao/comecando/autenticacao
 * - access_token: ~4 horas
 * - refresh_token: ~24 horas (renovar antes para manter sessão)
 */

/** Renovar access token quando faltar menos que isso para expirar. */
export const ACCESS_REFRESH_BEFORE_MS = 30 * 60 * 1000;

/** Renovar proativamente se a conexão não foi atualizada há tanto tempo (access ~4h). */
export const STALE_ACCESS_REFRESH_MS = 3 * 60 * 60 * 1000;

/** Renovar refresh token antes de completar 24h desde a última renovação/conexão. */
export const REFRESH_TOKEN_SLIDE_MS = 20 * 60 * 60 * 1000;

/** Intervalo do worker em background. */
export const OAUTH_REFRESH_WORKER_INTERVAL_MS = 10 * 60 * 1000;

export function shouldRefreshTinyToken(params: {
  now: number;
  tokenExpiresAt: number | null;
  updatedAt: number;
}): boolean {
  const { now, tokenExpiresAt, updatedAt } = params;
  const sinceUpdate = now - updatedAt;

  const accessExpired =
    tokenExpiresAt !== null && tokenExpiresAt <= now;

  const accessExpiringSoon =
    tokenExpiresAt !== null &&
    tokenExpiresAt < now + ACCESS_REFRESH_BEFORE_MS;

  const missingExpiryStale =
    tokenExpiresAt === null && sinceUpdate >= STALE_ACCESS_REFRESH_MS;

  const keepRefreshTokenAlive = sinceUpdate >= REFRESH_TOKEN_SLIDE_MS;

  return (
    accessExpired ||
    accessExpiringSoon ||
    missingExpiryStale ||
    keepRefreshTokenAlive
  );
}
