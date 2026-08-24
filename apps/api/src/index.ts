import Fastify from "fastify";
import cors from "@fastify/cors";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { mobileRoutes } from "./routes/mobile.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { webRoutes } from "./routes/web.js";
import { notificationRoutes } from "./routes/notifications.js";
import { integrationRoutes } from "./routes/integrations.js";
import { tinyRoutes } from "./routes/tiny.js";
import { startWaveScheduler } from "./services/wave-scheduler.js";
import { startTinyOAuthRefreshWorker } from "./services/tiny-oauth-refresh-worker.js";
import { startTinyOrderSyncScheduler } from "./services/tiny-order-sync-scheduler.js";
import { recoverStaleTinyBlockedConnections } from "./services/tiny-rate-limit.js";

const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-tenant-slug", "Accept"],
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(adminRoutes);
  const { platformRoutes } = await import("./routes/platform.js");
  await app.register(platformRoutes);
  await app.register(mobileRoutes);
  await app.register(dashboardRoutes);
  await app.register(webRoutes);
  await app.register(notificationRoutes);
  await app.register(integrationRoutes);
  await app.register(tinyRoutes);

  void recoverStaleTinyBlockedConnections()
    .then((n) => {
      if (n > 0) console.log(`[api] ${n} conexão(ões) Tiny recuperada(s) de BLOCKED`);
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[api] falha ao recuperar conexões Tiny BLOCKED: ${msg}`);
    });
  startWaveScheduler();
  startTinyOAuthRefreshWorker();
  startTinyOrderSyncScheduler();

  await app.listen({ port: PORT, host: HOST });
  console.log(`@wms/api rodando em http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
