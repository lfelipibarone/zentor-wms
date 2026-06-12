/**
 * Busca produtos na API Olist/Tiny v3 (GET /produtos + GET /produtos/{id})
 * e salva JSON para análise de campos.
 *
 * Uso:
 *   npx tsx scripts/fetch-tiny-products.ts
 *   npx tsx scripts/fetch-tiny-products.ts --limit 20
 *   npx tsx scripts/fetch-tiny-products.ts --tenant-id <cuid>
 *   npx tsx scripts/fetch-tiny-products.ts --output docs/tiny-produtos-sample.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getTinyApiClient, TinyApiError, TinyApiV3Client } from "../src/services/tiny-api-v3-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  const args = {
    limit: 10,
    tenantId: undefined as string | undefined,
    accessToken: process.env.TINY_ACCESS_TOKEN?.trim() || undefined,
    output: resolve(__dirname, "../../../docs/tiny-produtos-sample.json"),
    situacao: "A" as "A" | "I" | "E" | "",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit" && argv[i + 1]) args.limit = Math.max(1, Number(argv[++i]) || 10);
    else if (a === "--tenant-id" && argv[i + 1]) args.tenantId = argv[++i];
    else if (a === "--access-token" && argv[i + 1]) args.accessToken = argv[++i]?.trim();
    else if (a === "--output" && argv[i + 1]) args.output = resolve(argv[++i]);
    else if (a === "--situacao" && argv[i + 1]) {
      const s = argv[++i]?.toUpperCase();
      if (s === "A" || s === "I" || s === "E") args.situacao = s;
    }
  }
  return args;
}

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

type TinyAnexo = { url?: string | null; externo?: boolean | null };

function extractProductImages(detail: unknown) {
  const rec = asRecord(detail);
  if (!rec) {
    return {
      imageUrl: null as string | null,
      imageUrls: [] as string[],
      anexos: [] as TinyAnexo[],
    };
  }

  const anexos = asArray(rec.anexos)
    .map((raw) => asRecord(raw))
    .filter(Boolean)
    .map((a) => ({
      url: str(a!.url) ?? null,
      externo: typeof a!.externo === "boolean" ? a!.externo : null,
    }))
    .filter((a) => a.url);

  const imageUrls = anexos.map((a) => a.url!).filter(Boolean);

  return {
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    anexos,
  };
}

function buildProductImageSummary(
  details: Array<{ id: number | null; listItem: unknown; detail: unknown }>,
) {
  return details
    .filter((d) => d.detail)
    .map((d) => {
      const list = asRecord(d.listItem);
      const images = extractProductImages(d.detail);
      return {
        id: d.id,
        sku: str(list?.sku) ?? str(asRecord(d.detail)?.sku) ?? null,
        descricao: str(list?.descricao) ?? str(asRecord(d.detail)?.descricao) ?? null,
        ...images,
      };
    });
}

function collectFieldPaths(
  value: unknown,
  prefix = "",
  out = new Set<string>(),
): Set<string> {
  if (value === null || value === undefined) {
    if (prefix) out.add(prefix);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) out.add(`${prefix}[]`);
      return out;
    }
    collectFieldPaths(value[0], `${prefix}[]`, out);
    return out;
  }
  const rec = asRecord(value);
  if (!rec) {
    if (prefix) out.add(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(rec)) {
    const next = prefix ? `${prefix}.${k}` : k;
    collectFieldPaths(v, next, out);
  }
  return out;
}

async function resolveTenantId(
  explicit?: string,
  options?: { allowAnyConnection?: boolean },
): Promise<string> {
  if (explicit) return explicit;

  const connected = await prisma.tinyConnection.findFirst({
    where: {
      status: TinyConnectionStatus.CONNECTED,
      isActive: true,
      deletedAt: null,
      accessToken: { not: null },
    },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });

  if (connected) {
    console.log(
      `Tenant: ${connected.tenant.name} (${connected.tenant.slug}) — id=${connected.tenantId}`,
    );
    return connected.tenantId;
  }

  if (options?.allowAnyConnection) {
    const any = await prisma.tinyConnection.findFirst({
      where: { deletedAt: null, isActive: true },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: { updatedAt: "desc" },
    });
    if (any) {
      console.log(
        `Tenant (sem OAuth ativo): ${any.tenant.name} (${any.tenant.slug}) — id=${any.tenantId}`,
      );
      return any.tenantId;
    }
  }

  const all = await prisma.tinyConnection.findMany({
    where: { deletedAt: null, isActive: true },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const lines = all.map(
    (c) =>
      `  • ${c.tenant.name} (${c.tenant.slug}) — status=${c.status}, token=${c.accessToken ? "sim" : "não"}${c.lastError ? `, erro: ${c.lastError}` : ""}`,
  );

  throw new Error(
    [
      "Nenhuma conexão Tiny CONNECTED com token válido.",
      "",
      "Conexões encontradas:",
      ...(lines.length ? lines : ["  (nenhuma)"]),
      "",
      "Como resolver:",
      "  1. Abra Integrações → Tiny no painel e reconecte OAuth",
      "  2. Ou rode com token manual:",
      "     pnpm tiny:fetch-products --access-token SEU_TOKEN --limit 10",
      "  3. Ou informe o tenant após reconectar:",
      "     pnpm tiny:fetch-products --tenant-id cmpyd0fs10000uvq47gv8e9fz",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantId = await resolveTenantId(args.tenantId, {
    allowAnyConnection: Boolean(args.accessToken),
  });

  let client: TinyApiV3Client;
  if (args.accessToken) {
    console.log("Usando access token informado (--access-token / TINY_ACCESS_TOKEN).");
    client = new TinyApiV3Client(args.accessToken, "manual-token");
  } else {
    client = await getTinyApiClient(tenantId);
  }

  console.log(`Listando produtos (situacao=${args.situacao || "todas"}, limit=${args.limit})…`);

  const listBody = await client.request<{
    itens?: unknown[];
    paginacao?: { total?: number; limit?: number; offset?: number };
  }>("GET", "/produtos", {
    query: {
      limit: args.limit,
      offset: 0,
      ...(args.situacao ? { situacao: args.situacao } : {}),
    },
  });

  const listItems = asArray(listBody.itens);
  const pagination = listBody.paginacao ?? {};

  console.log(
    `Lista: ${listItems.length} item(ns) retornados (total API: ${pagination.total ?? "?"})`,
  );

  const details: Array<{
    id: number | null;
    listItem: unknown;
    detail: unknown;
    error?: string;
    imageUrl: string | null;
    imageUrls: string[];
  }> = [];

  for (const raw of listItems) {
    const row = asRecord(raw);
    const id = Number(row?.id);
    if (!Number.isFinite(id) || id <= 0) {
      details.push({
        id: null,
        listItem: raw,
        detail: null,
        error: "id inválido na listagem",
        imageUrl: null,
        imageUrls: [],
      });
      continue;
    }

    process.stdout.write(`  GET /produtos/${id}… `);
    try {
      const detail = await client.request<Record<string, unknown>>(
        "GET",
        `/produtos/${id}`,
      );
      const images = extractProductImages(detail);
      details.push({
        id,
        listItem: raw,
        detail,
        imageUrl: images.imageUrl,
        imageUrls: images.imageUrls,
      });
      console.log(images.imageUrl ? `ok (${images.imageUrls.length} img)` : "ok (sem imagem)");
    } catch (e) {
      const msg = e instanceof TinyApiError ? e.message : String(e);
      details.push({
        id,
        listItem: raw,
        detail: null,
        error: msg,
        imageUrl: null,
        imageUrls: [],
      });
      console.log(`erro: ${msg}`);
    }
  }

  const listFields = collectFieldPaths(listItems);
  const detailFields = collectFieldPaths(details.map((d) => d.detail).filter(Boolean));

  const wmsMappingHints = {
    sku: "Product.sku — vem de listagem/detalhe: sku",
    name: "Product.name — vem de descricao",
    barcode: "Product.barcode — candidatos: gtin, tributacao.gtinEmbalagem",
    unit: "Product.unit — vem de unidade",
    weight: "Product.weight — candidatos: dimensoes.pesoLiquido ou pesoBruto (kg)",
    imageUrl: "Product.imageUrl — detail.anexos[].url (primeira URL não vazia)",
    active: "Product.active — situacao A=ativo, I/E=inativo",
    supplierName: "Product.supplierName — fornecedores[].nome (primeiro)",
    erpStockQuantity: "Product.erpStockQuantity — estoque.quantidade (saldo ERP Tiny)",
    tinyId: "referência ERP — id",
    erpLocation: "estoque.localizacao (Tiny, não WMS Location)",
  };

  const productImages = buildProductImageSummary(details);

  const payload = {
    fetchedAt: new Date().toISOString(),
    tenantId,
    endpoints: {
      list: "GET /produtos",
      detail: "GET /produtos/{idProduto}",
    },
    imageSource: {
      field: "detail.anexos[].url",
      doc: "https://api-docs.erp.olist.com/api-reference/produtos/obter-produto",
      note: "A listagem GET /produtos não traz imagens; só o detalhe com anexos.",
    },
    productImages,
    productsWithImages: productImages.filter((p) => p.imageUrls.length > 0).length,
    productsWithoutImages: productImages.filter((p) => p.imageUrls.length === 0).length,
    query: {
      limit: args.limit,
      offset: 0,
      situacao: args.situacao || null,
    },
    pagination,
    fieldInventory: {
      listPaths: [...listFields].sort(),
      detailPaths: [...detailFields].sort(),
      detailOnlyPaths: [...detailFields].filter((p) => !listFields.has(p)).sort(),
    },
    wmsMappingHints,
    listItems,
    products: details,
  };

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, JSON.stringify(payload, null, 2), "utf8");

  console.log(`\nSalvo em: ${args.output}`);
  console.log(`Campos na listagem: ${listFields.size}`);
  console.log(`Campos no detalhe: ${detailFields.size}`);
  console.log(
    `Campos só no detalhe: ${payload.fieldInventory.detailOnlyPaths.length}`,
  );
  console.log(
    `Imagens: ${payload.productsWithImages} com URL, ${payload.productsWithoutImages} sem`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
