#!/usr/bin/env node
/**
 * Garante schema Prisma no Postgres antes de subir a API.
 * Use em homolog (Dokploy): banco vazio → db push (+ seed se WMS_AUTO_SEED=1 ou banco sem tenants).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(apiRoot, "package.json"));

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[ensure-db] aplicando schema (prisma db push)...");
run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"]);

const autoSeed =
  process.env.WMS_AUTO_SEED === "1" ||
  process.env.WMS_AUTO_SEED === "true";

let shouldSeed = autoSeed;

if (!shouldSeed) {
  try {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const tenants = await prisma.tenant.count();
    await prisma.$disconnect();
    if (tenants === 0) {
      console.log("[ensure-db] banco sem tenants — rodando seed automático");
      shouldSeed = true;
    }
  } catch (err) {
    console.warn(
      "[ensure-db] não foi possível checar tenants; seed só se WMS_AUTO_SEED=1",
      err instanceof Error ? err.message : err,
    );
  }
}

if (shouldSeed) {
  console.log("[ensure-db] populando dados demo (db:seed)...");
  run("pnpm", ["run", "db:seed"]);
}

console.log("[ensure-db] ok");
