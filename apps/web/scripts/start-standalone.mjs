import { cpSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = join(webRoot, ".next", "standalone");
const serverJs = join(standaloneRoot, "apps", "web", "server.js");
const staticSrc = join(webRoot, ".next", "static");
const staticDest = join(standaloneRoot, "apps", "web", ".next", "static");
const publicSrc = join(webRoot, "public");
const publicDest = join(standaloneRoot, "apps", "web", "public");

if (!existsSync(serverJs)) {
  console.error(
    "Standalone server não encontrado. Rode o build antes (pnpm --filter @wms/web build).",
  );
  process.exit(1);
}

if (existsSync(staticSrc)) {
  mkdirSync(dirname(staticDest), { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true });
}

if (existsSync(publicSrc)) {
  mkdirSync(publicDest, { recursive: true });
  cpSync(publicSrc, publicDest, { recursive: true });
}

const port = process.env.PORT ?? "3000";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

const child = spawn(process.execPath, [serverJs], {
  cwd: standaloneRoot,
  env: { ...process.env, PORT: port, HOSTNAME: hostname },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
