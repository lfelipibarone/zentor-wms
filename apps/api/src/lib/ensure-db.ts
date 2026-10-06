import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./prisma.js";
import { ensureDefaultUsers } from "../services/ensure-default-users.js";
import { ensureAllTenantsRolePermissions } from "../services/role-permissions.js";
import { migrateLegacyPulmaoStock } from "../services/pulmao-inventory.js";

/** apps/api — funciona a partir de dist/lib ou src/lib */
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const schemaPath = join(apiRoot, "prisma", "schema.prisma");
const requireFromApi = createRequire(join(apiRoot, "package.json"));

function resolvePackageCli(pkg: string): string {
  const pkgJsonPath = requireFromApi.resolve(`${pkg}/package.json`);
  const pkgJson = requireFromApi(pkgJsonPath) as {
    bin?: string | Record<string, string>;
  };
  const binField = pkgJson.bin;
  const binRel =
    typeof binField === "string"
      ? binField
      : (binField?.[pkg] ?? Object.values(binField ?? {})[0]);
  if (!binRel) {
    throw new Error(`Pacote ${pkg} sem bin`);
  }
  return join(dirname(pkgJsonPath), binRel);
}

function runCli(pkg: string, args: string[]) {
  const entry = resolvePackageCli(pkg);
  execFileSync(process.execPath, [entry, ...args], {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit",
  });
}

function runCliCaptured(pkg: string, args: string[]): { ok: boolean; output: string } {
  const entry = resolvePackageCli(pkg);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: apiRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  return { ok: result.status === 0, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

/** Aviso do Prisma que não apaga dados: no máximo falha se houver duplicata. */
const SAFE_PUSH_WARNING =
  /^A unique constraint covering the columns `\[[^\]]+\]` on the table `[^`]+` will be added\./;

function pushWarnings(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("•"))
    .map((l) => l.slice(1).trim());
}

/** `db push`; se os únicos avisos forem de unique novo, reaplica com --accept-data-loss. */
function pushSchema(): void {
  const args = ["db", "push", "--skip-generate", "--schema", schemaPath];
  const first = runCliCaptured("prisma", args);
  if (first.ok) return;

  const warnings = pushWarnings(first.output);
  const needsAccept = first.output.includes("--accept-data-loss");
  if (needsAccept && warnings.length > 0 && warnings.every((w) => SAFE_PUSH_WARNING.test(w))) {
    console.log(
      `[ensure-db] ${warnings.length} aviso(s) só de unique novo (não apagam dados) — reaplicando com --accept-data-loss`,
    );
    const second = runCliCaptured("prisma", [...args, "--accept-data-loss"]);
    if (second.ok) return;
    throw new Error("[ensure-db] db push falhou ao criar unique novo — verifique valores duplicados na tabela indicada acima");
  }

  const unsafe = warnings.filter((w) => !SAFE_PUSH_WARNING.test(w));
  throw new Error(
    unsafe.length > 0
      ? `[ensure-db] db push bloqueado por mudança destrutiva no schema:\n- ${unsafe.join("\n- ")}`
      : "[ensure-db] db push falhou — veja a saída do Prisma acima",
  );
}

/**
 * Aplica schema Prisma (+ seed se banco vazio) antes de aceitar tráfego.
 * Roda dentro do `node .../index.js` — independente de Docker/Nixpacks CMD.
 * Desligar: WMS_SKIP_DB_ENSURE=1
 */
export async function ensureDatabaseReady(): Promise<void> {
  if (
    process.env.WMS_SKIP_DB_ENSURE === "1" ||
    process.env.WMS_SKIP_DB_ENSURE === "true"
  ) {
    console.log("[ensure-db] pulado (WMS_SKIP_DB_ENSURE)");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[ensure-db] DATABASE_URL ausente — pulando");
    return;
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(schemaPath)) {
    throw new Error(
      `[ensure-db] schema não encontrado em ${schemaPath} (cwd apiRoot=${apiRoot})`,
    );
  }

  console.log("[ensure-db] aplicando schema (prisma db push)...");
  pushSchema();

  const forceFullSeed =
    process.env.WMS_FORCE_FULL_SEED === "1" ||
    process.env.WMS_FORCE_FULL_SEED === "true";

  let tenantCount = 0;
  try {
    tenantCount = await prisma.tenant.count();
  } catch (err) {
    console.warn(
      "[ensure-db] falha ao contar tenants após push:",
      err instanceof Error ? err.message : err,
    );
  }

  console.log("[ensure-db] garantindo usuários padrão (super-admin, adm da conta, operador, separador)...");
  try {
    const defaultUsers = await ensureDefaultUsers(prisma);
    console.log(
      `[ensure-db] usuários prontos: platform=${defaultUsers.platformAdminEmail}, tenantAdmin=${defaultUsers.tenantAdminEmail}, operador=${defaultUsers.operadorEmail}, separador=${defaultUsers.pickerEmail}`,
    );
  } catch (err) {
    console.warn(
      "[ensure-db] falha ao garantir usuários padrão:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    await ensureAllTenantsRolePermissions(prisma);
    console.log("[ensure-db] matrizes de cargo por tenant prontas");
  } catch (err) {
    console.warn(
      "[ensure-db] falha ao garantir matrizes de cargo:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const pulmao = await migrateLegacyPulmaoStock(prisma);
    if (pulmao.released > 0) {
      console.log(
        `[ensure-db] pulmões no formato multi-SKU: ${pulmao.released} liberados, ${pulmao.migrated} saldos copiados`,
      );
    }
  } catch (err) {
    console.warn(
      "[ensure-db] falha ao migrar saldos de pulmão:",
      err instanceof Error ? err.message : err,
    );
  }

  if (tenantCount === 0 || forceFullSeed) {
    console.log(
      forceFullSeed
        ? "[ensure-db] WMS_FORCE_FULL_SEED=1 — rodando seed completo..."
        : "[ensure-db] banco sem tenants — rodando seed completo...",
    );
    runCli("tsx", ["prisma/seed.ts"]);
  }

  console.log("[ensure-db] ok");
}
