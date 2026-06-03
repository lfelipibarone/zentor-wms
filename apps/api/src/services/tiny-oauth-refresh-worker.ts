import { refreshTinyAccessToken } from "./tiny-api-v3-client.js";
import { listConnectionsForRefresh } from "./tiny-oauth.js";

const INTERVAL_MS = 30 * 60 * 1000;
const REFRESH_BEFORE_MS = 90 * 60 * 1000;
const STALE_REFRESH_MS = 3 * 60 * 60 * 1000;

export function startTinyOAuthRefreshWorker() {
  const enabled = process.env.START_OAUTH_REFRESH_WORKER !== "false";
  if (!enabled) {
    console.log("[tiny-oauth-worker] desabilitado (START_OAUTH_REFRESH_WORKER=false)");
    return;
  }

  const tick = async () => {
    try {
      const connections = await listConnectionsForRefresh();
      const now = Date.now();

      for (const conn of connections) {
        const expiresAt = conn.tokenExpiresAt?.getTime() ?? 0;
        const stale = now - conn.updatedAt.getTime() > STALE_REFRESH_MS;
        const expiringSoon = expiresAt > 0 && expiresAt < now + REFRESH_BEFORE_MS;

        if (!expiringSoon && !stale) continue;

        try {
          await refreshTinyAccessToken(conn.id);
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
  setInterval(tick, INTERVAL_MS);
  console.log("[tiny-oauth-worker] iniciado (intervalo 30 min)");
}
