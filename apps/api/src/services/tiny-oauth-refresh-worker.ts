import { refreshTinyAccessTokenLocked } from "./tiny-api-v3-client.js";
import { listConnectionsForRefresh } from "./tiny-oauth.js";
import { recoverStaleTinyBlockedConnections } from "./tiny-rate-limit.js";
import {
  OAUTH_REFRESH_WORKER_INTERVAL_MS,
  shouldRefreshTinyToken,
} from "./tiny-oauth-refresh.js";

export function startTinyOAuthRefreshWorker() {
  const enabled = process.env.START_OAUTH_REFRESH_WORKER !== "false";
  if (!enabled) {
    console.log("[tiny-oauth-worker] desabilitado (START_OAUTH_REFRESH_WORKER=false)");
    return;
  }

  const tick = async () => {
    try {
      const recovered = await recoverStaleTinyBlockedConnections();
      if (recovered > 0) {
        console.log(
          `[tiny-oauth-worker] ${recovered} conexão(ões) Tiny recuperada(s) de BLOCKED (rate limit)`,
        );
      }

      const connections = await listConnectionsForRefresh();
      const now = Date.now();

      for (const conn of connections) {
        const shouldRefresh = shouldRefreshTinyToken({
          now,
          tokenExpiresAt: conn.tokenExpiresAt?.getTime() ?? null,
          updatedAt: conn.updatedAt.getTime(),
        });

        if (!shouldRefresh) continue;

        try {
          await refreshTinyAccessTokenLocked(conn.id);
          console.log(`[tiny-oauth-worker] token renovado tenant=${conn.tenantId}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[tiny-oauth-worker] falha tenant=${conn.tenantId}: ${msg}`);
        }
      }
    } catch (e) {
      console.error("[tiny-oauth-worker] erro no ciclo:", e);
    }
  };

  void tick();
  setInterval(tick, OAUTH_REFRESH_WORKER_INTERVAL_MS);
  console.log(
    `[tiny-oauth-worker] iniciado (intervalo ${OAUTH_REFRESH_WORKER_INTERVAL_MS / 60_000} min)`,
  );
}
