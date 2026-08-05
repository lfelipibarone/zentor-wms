/**
 * Gera collection + environment Postman para demo de etiquetas Tiny (reunião suporte).
 *
 * Uso:
 *   pnpm export-postman-tiny-etiquetas
 *
 * Saída:
 *   docs/postman/Tiny-Etiquetas-Expedicao.postman_collection.json
 *   docs/postman/Tiny-Etiquetas-Expedicao.local.postman_environment.json  (tokens reais — não commitar)
 *   docs/postman/Tiny-Etiquetas-Expedicao.example.postman_environment.json
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TinyConnectionStatus } from "@prisma/client";
import { decrypt } from "../src/lib/encryption.js";
import { prisma } from "../src/lib/prisma.js";
import { refreshTinyAccessTokenLocked } from "../src/services/tiny-api-v3-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../../docs/postman");

const BASE_URL = "https://api.tiny.com.br/public-api/v3";
const TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

const TINY_HOST = ["api", "tiny", "com", "br"] as const;
const TINY_PATH_PREFIX = ["public-api", "v3"];

/** Pedidos de referência dos testes com o suporte Tiny. */
const REF = {
  pedidoMercado: 860301754,
  idNotaMercado: 860301759,
  idAgrupamentoMercado: 746503742,
  idExpedicaoMercado: 749882106,
  pedidoAmazon: 860342783,
  idNotaAmazon: 860342789,
  idAgrupamentoAmazon: 746503773,
  idExpedicaoAmazon: 749884319,
};

/** Variáveis padrão na collection — funcionam mesmo sem environment importado. */
function collectionVariables(dataInicial: string, dataFinal: string) {
  return [
    { key: "baseUrl", value: BASE_URL },
    { key: "tokenUrl", value: TOKEN_URL },
    { key: "accessToken", value: "" },
    { key: "refreshToken", value: "" },
    { key: "clientId", value: "" },
    { key: "clientSecret", value: "" },
    { key: "dataInicial", value: dataInicial },
    { key: "dataFinal", value: dataFinal },
    { key: "pedidoMercado", value: String(REF.pedidoMercado) },
    { key: "idNotaMercado", value: String(REF.idNotaMercado) },
    { key: "idAgrupamentoMercado", value: String(REF.idAgrupamentoMercado) },
    { key: "idExpedicaoMercado", value: String(REF.idExpedicaoMercado) },
    { key: "pedidoAmazon", value: String(REF.pedidoAmazon) },
    { key: "idNotaAmazon", value: String(REF.idNotaAmazon) },
    { key: "idAgrupamentoAmazon", value: String(REF.idAgrupamentoAmazon) },
    { key: "idExpedicaoAmazon", value: String(REF.idExpedicaoAmazon) },
    { key: "pedidoAvulso", value: String(REF.pedidoMercado) },
    // Valores opcionais para testar endpoints gerais.
    { key: "produtoId", value: "" },
    { key: "produtoSku", value: "2PUXTI" },
    { key: "produtoNome", value: "PUX" },
    { key: "produtoGtin", value: "" },
    { key: "wmsApiUrl", value: "http://localhost:3333" },
    { key: "wmsEmail", value: "operador@wms.local" },
    { key: "wmsPassword", value: "operador123" },
    { key: "wmsToken", value: "" },
    { key: "wmsOrderIdMercado", value: "" },
  ];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateWindow() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 60);
  return { dataInicial: isoDate(start), dataFinal: isoDate(end) };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

async function fetchWmsToken(apiUrl: string): Promise<string> {
  const res = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "operador@wms.local",
      password: "operador123",
    }),
  });
  if (!res.ok) throw new Error(`WMS login HTTP ${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("WMS login sem token");
  return data.token;
}

function tinyHeaders() {
  return [
    { key: "Accept", value: "application/json" },
    { key: "Authorization", value: "Bearer {{accessToken}}" },
  ];
}

const COLLECTION_PRE_REQUEST = [
  "const url = pm.request.url.toString();",
  "if (url.includes('openid-connect/token') || url.includes('/auth/login')) return;",
  "const token = pm.environment.get('accessToken') || pm.collectionVariables.get('accessToken');",
  "if (!token || token === 'COLE_ACCESS_TOKEN_AQUI') {",
  "  throw new Error('accessToken vazio. Importe Tiny-Etiquetas-Expedicao.pronto.postman_collection.json');",
  "}",
  "pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + token });",
];

function getRequest(
  name: string,
  method: string,
  path: string,
  query?: { key: string; value: string }[],
  description?: string,
) {
  return {
    name,
    request: {
      method,
      header: tinyHeaders(),
      auth: { type: "noauth" },
      url: tinyUrl(path, query),
      description,
    },
  };
}

/** URL Tiny com protocol/host/path explícitos — Postman não quebra com query params. */
function tinyUrl(path: string, query?: { key: string; value: string }[]) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const segments = normalized.replace(/^\//, "").split("/");
  const pathParts = [...TINY_PATH_PREFIX, ...segments];
  const url: Record<string, unknown> = {
    raw: `${BASE_URL}${normalized}`,
    protocol: "https",
    host: [...TINY_HOST],
    path: pathParts,
  };
  if (query?.length) {
    url.query = query;
    const qs = query
      .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
      .join("&");
    url.raw = `${BASE_URL}${normalized}?${qs}`;
  }
  return url;
}

function oauthTokenUrl() {
  return {
    raw: TOKEN_URL,
    protocol: "https",
    host: ["accounts", "tiny", "com", "br"],
    path: ["realms", "tiny", "protocol", "openid-connect", "token"],
  };
}

function wmsUrl(path: string, query?: { key: string; value: string }[]) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url: Record<string, unknown> = {
    raw: `{{wmsApiUrl}}${normalized}`,
    protocol: "http",
    host: ["localhost"],
    port: "3333",
    path: normalized.replace(/^\//, "").split("/"),
  };
  if (query?.length) {
    url.query = query;
    const qs = query.map((q) => `${q.key}=${q.value}`).join("&");
    url.raw = `{{wmsApiUrl}}${normalized}?${qs}`;
  }
  return url;
}

function rawUrl(raw: string, query?: { key: string; value: string }[]) {
  const url: Record<string, unknown> = { raw };
  if (query?.length) url.query = query;
  return url;
}

function buildCollection(tokenOverrides?: Record<string, string>) {
  const { dataInicial, dataFinal } = dateWindow();
  const vars = collectionVariables(dataInicial, dataFinal).map((v) => ({
    ...v,
    value: tokenOverrides?.[v.key] ?? v.value,
  }));
  const listExpQuery = [
    { key: "orderBy", value: "desc" },
    { key: "dataInicial", value: "{{dataInicial}}" },
    { key: "dataFinal", value: "{{dataFinal}}" },
  ];

  const fluxoMercado = [
    getRequest(
      "1 — GET /expedicao (listar agrupamentos)",
      "GET",
      "/expedicao",
      listExpQuery,
      "Primeira rota do WMS: monta índice pedido → expedição.",
    ),
    getRequest(
      "2 — GET /expedicao/{idAgrupamento} (Mercado Envios)",
      "GET",
      "/expedicao/{{idAgrupamentoMercado}}",
      undefined,
      "Detalhe do agrupamento; pedido 860301754 em expedicoes[].",
    ),
    getRequest(
      "3 — GET /pedidos/{id}",
      "GET",
      "/pedidos/{{pedidoMercado}}",
      undefined,
      "Contexto do pedido (situação, NF, forma de envio).",
    ),
    getRequest(
      "4 — GET /notas/{id}/link (DANFE — não é etiqueta)",
      "GET",
      "/notas/{{idNotaMercado}}/link",
      undefined,
      "Link fiscal; separado da etiqueta de transporte.",
    ),
    getRequest(
      "5 — GET /expedicao/{idAgrupamento}/etiquetas",
      "GET",
      "/expedicao/{{idAgrupamentoMercado}}/etiquetas",
      undefined,
      "Etiqueta do lote — aqui retorna erro ML nos nossos testes.",
    ),
    getRequest(
      "6 — GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas",
      "GET",
      "/expedicao/{{idAgrupamentoMercado}}/expedicao/{{idExpedicaoMercado}}/etiquetas",
      undefined,
      "Etiqueta individual — mesmo erro nos nossos testes.",
    ),
  ];

  const fluxoAmazon = [
    getRequest("1 — GET /expedicao", "GET", "/expedicao", listExpQuery),
    getRequest(
      "2 — GET /expedicao/{idAgrupamento} (Amazon DBA)",
      "GET",
      "/expedicao/{{idAgrupamentoAmazon}}",
    ),
    getRequest("3 — GET /pedidos/{id}", "GET", "/pedidos/{{pedidoAmazon}}"),
    getRequest(
      "4 — GET /notas/{id}/link",
      "GET",
      "/notas/{{idNotaAmazon}}/link",
    ),
    getRequest(
      "5 — GET /expedicao/{idAgrupamento}/etiquetas",
      "GET",
      "/expedicao/{{idAgrupamentoAmazon}}/etiquetas",
    ),
    getRequest(
      "6 — GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas",
      "GET",
      "/expedicao/{{idAgrupamentoAmazon}}/expedicao/{{idExpedicaoAmazon}}/etiquetas",
    ),
  ];

  return {
    info: {
      _postman_id: tokenOverrides
        ? "zentor-tiny-etiquetas-pronto"
        : "zentor-tiny-etiquetas-expedicao",
      name: tokenOverrides
        ? "Zentor WMS — Tiny Etiquetas (PRONTO — token embutido)"
        : "Zentor WMS — Tiny Etiquetas Expedição (reunião)",
      description:
        "Fluxo idêntico ao WMS (tiny-expedicao-labels.ts). Rodar pasta Mercado ou Amazon na ordem. OAuth: refresh token antes se access expirou.",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: { type: "noauth" },
    event: [
      {
        listen: "prerequest",
        script: { type: "text/javascript", exec: COLLECTION_PRE_REQUEST },
      },
    ],
    variable: vars,
    item: [
      {
        name: "00 — OAuth",
        item: [
          {
            name: "Refresh access_token",
            event: [
              {
                listen: "test",
                script: {
                  exec: [
                    "if (pm.response.code === 200) {",
                    "  const j = pm.response.json();",
                    "  if (j.access_token) {",
                    "    pm.environment.set('accessToken', j.access_token);",
                    "    pm.collectionVariables.set('accessToken', j.access_token);",
                    "  }",
                    "  if (j.refresh_token) {",
                    "    pm.environment.set('refreshToken', j.refresh_token);",
                    "    pm.collectionVariables.set('refreshToken', j.refresh_token);",
                    "  }",
                    "}",
                  ],
                  type: "text/javascript",
                },
              },
            ],
            request: {
              method: "POST",
              header: [
                {
                  key: "Content-Type",
                  value: "application/x-www-form-urlencoded",
                },
              ],
              body: {
                mode: "urlencoded",
                urlencoded: [
                  { key: "grant_type", value: "refresh_token" },
                  { key: "client_id", value: "{{clientId}}" },
                  { key: "client_secret", value: "{{clientSecret}}" },
                  { key: "refresh_token", value: "{{refreshToken}}" },
                ],
              },
              auth: { type: "noauth" },
              url: oauthTokenUrl(),
              description:
                "Renova o Bearer antes da call se access_token expirou (~4h).",
            },
          },
        ],
      },
      {
        name: "01 — Info conta",
        item: [
          getRequest(
            "GET /info",
            "GET",
            "/info",
            undefined,
            "Confirma conta OAuth conectada (razão social, CNPJ).",
          ),
        ],
      },
      {
        name: "02 — Mercado Envios (860301754 — erro ML)",
        description:
          "Pedido na expedição; rotas 5–6 retornam erro marketplace nos nossos testes.",
        item: fluxoMercado,
      },
      {
        name: "03 — Amazon DBA (860342783 — erro Amazon)",
        item: fluxoAmazon,
      },
      {
        name: "04 — Pedido avulso",
        item: [
          getRequest(
            "GET /pedidos/{id} — trocar variável pedidoAvulso",
            "GET",
            "/pedidos/{{pedidoAvulso}}",
            undefined,
            "Use pedidoAvulso no environment para testar outro ID na call.",
          ),
        ],
      },
      {
        name: "06 — Produtos (Tiny v3)",
        description:
          "Filtros oficiais: codigo (SKU), nome (parcial), gtin, situacao. Kits = tipo K.",
        item: [
          getRequest(
            "1 — GET /produtos (lista)",
            "GET",
            "/produtos",
            [
              { key: "limit", value: "100" },
              { key: "offset", value: "0" },
            ],
            "Lista paginada. Kits costumam não aparecer nas primeiras páginas.",
          ),
          getRequest(
            "2 — GET /produtos?codigo=SKU",
            "GET",
            "/produtos",
            [
              { key: "codigo", value: "{{produtoSku}}" },
              { key: "limit", value: "100" },
              { key: "offset", value: "0" },
            ],
            "Filtra pelo código/SKU (`codigo`). Ajuste `produtoSku` na collection.",
          ),
          getRequest(
            "3 — GET /produtos?nome=",
            "GET",
            "/produtos",
            [
              { key: "nome", value: "{{produtoNome}}" },
              { key: "limit", value: "100" },
              { key: "offset", value: "0" },
            ],
            "Busca parcial ou completa por nome (`nome`).",
          ),
          getRequest(
            "4 — GET /produtos?gtin=",
            "GET",
            "/produtos",
            [
              { key: "gtin", value: "{{produtoGtin}}" },
              { key: "limit", value: "100" },
              { key: "offset", value: "0" },
            ],
            "Filtra por GTIN/EAN. Preencha `produtoGtin`.",
          ),
          getRequest(
            "5 — GET /produtos?situacao=A",
            "GET",
            "/produtos",
            [
              { key: "situacao", value: "A" },
              { key: "limit", value: "100" },
              { key: "offset", value: "0" },
            ],
            "A=Ativo, I=Inativo, E=Excluído.",
          ),
          getRequest(
            "6 — GET /produtos/{id}",
            "GET",
            "/produtos/{{produtoId}}",
            undefined,
            "Detalhe do produto. Preencha `produtoId` (ex.: após buscar por SKU).",
          ),
        ],
      },
      {
        name: "07 — Compras / Notas de entrada (Tiny v3)",
        item: [
          getRequest(
            "1 — GET /notas (tipo=E — entrada)",
            "GET",
            "/notas",
            [
              { key: "tipo", value: "E" },
              { key: "dataInicial", value: "{{dataInicial}}" },
              { key: "dataFinal", value: "{{dataFinal}}" },
              { key: "limit", value: "100" },
              { key: "offset", value: "0" },
              { key: "orderBy", value: "desc" },
            ],
            "Lista notas de entrada (compras).",
          ),
          getRequest(
            "2 — GET /notas/{id} (Mercado)",
            "GET",
            "/notas/{{idNotaMercado}}",
            undefined,
            "Busca detalhe da NF de entrada do caso Mercado da demo.",
          ),
          getRequest(
            "3 — GET /notas/{id} (Amazon)",
            "GET",
            "/notas/{{idNotaAmazon}}",
            undefined,
            "Busca detalhe da NF de entrada do caso Amazon da demo.",
          ),
        ],
      },
      {
        name: "08 — Pedidos (Tiny v3)",
        item: [
          getRequest(
            "1 — GET /pedidos (lista no período)",
            "GET",
            "/pedidos",
            [
              { key: "dataInicial", value: "{{dataInicial}}" },
              { key: "dataFinal", value: "{{dataFinal}}" },
              { key: "limit", value: "100" },
              { key: "offset", value: "0" },
              { key: "orderBy", value: "desc" },
            ],
            "Lista pedidos no período (ajuste filtros conforme necessário).",
          ),
        ],
      },
      {
        name: "09 — Conferência de compra (Tiny v3)",
        description:
          "Endpoints usados por `tryMarkReadyForConference()` no WMS (podem exigir permissões/configuração no Tiny).",
        item: [
          {
            name: "1 — POST /notas/{id}/receber-mercadorias",
            request: {
              method: "POST",
              header: tinyHeaders(),
              auth: { type: "noauth" },
              url: tinyUrl("/notas/{{idNotaMercado}}/receber-mercadorias"),
              description: "Receber mercadorias via rota de conferência (tentativa).",
            },
          },
          {
            name: "2 — POST /conferencia-compra/{id}/receber-mercadorias",
            request: {
              method: "POST",
              header: tinyHeaders(),
              auth: { type: "noauth" },
              url: tinyUrl("/conferencia-compra/{{idNotaMercado}}/receber-mercadorias"),
              description: "Receber mercadorias via conferência (tentativa).",
            },
          },
          {
            name: "3 — PUT /conferencia-compra/{id}/situacao",
            request: {
              method: "PUT",
              header: [
                ...tinyHeaders(),
                { key: "Content-Type", value: "application/json" },
              ],
              auth: { type: "noauth" },
              url: tinyUrl("/conferencia-compra/{{idNotaMercado}}/situacao"),
              description: "Atualiza situacao para `pronto_para_conferir` (tentativa).",
              body: {
                mode: "raw",
                raw: JSON.stringify({ situacao: "pronto_para_conferir" }),
              },
            },
          },
          {
            name: "4 — POST /conferencia-compra/notas/{id}/receber",
            request: {
              method: "POST",
              header: tinyHeaders(),
              auth: { type: "noauth" },
              url: tinyUrl("/conferencia-compra/notas/{{idNotaMercado}}/receber"),
              description: "Finaliza recebimento via conferência (tentativa).",
            },
          },
        ],
      },
      {
        name: "05 — WMS Zentor (opcional)",
        item: [
          {
            name: "POST /auth/login",
            event: [
              {
                listen: "test",
                script: {
                  exec: [
                    "const j = pm.response.json();",
                    "if (j.token) pm.environment.set('wmsToken', j.token);",
                  ],
                  type: "text/javascript",
                },
              },
            ],
            request: {
              method: "POST",
              header: [{ key: "Content-Type", value: "application/json" }],
              body: {
                mode: "raw",
                raw: JSON.stringify({
                  email: "{{wmsEmail}}",
                  password: "{{wmsPassword}}",
                }),
              },
              url: wmsUrl("/auth/login"),
            },
          },
          {
            name: "POST /api/packing/orders/{id}/shipping-labels?refresh=1",
            request: {
              method: "POST",
              header: [
                { key: "Authorization", value: "Bearer {{wmsToken}}" },
                { key: "Content-Type", value: "application/json" },
              ],
              url: wmsUrl("/api/packing/orders/{{wmsOrderIdMercado}}/shipping-labels", [
                { key: "refresh", value: "1" },
              ]),
              description:
                "Mesmo fluxo do WMS: monta índice expedição + busca etiquetas.",
            },
          },
        ],
      },
    ],
  };
}

type EnvValues = Record<string, string>;

function buildEnvironment(values: EnvValues, name: string) {
  return {
    id: "zentor-tiny-etiquetas-env",
    name,
    values: Object.entries(values).map(([key, value]) => ({
      key,
      value,
      type:
        key.toLowerCase().includes("token") ||
        key === "clientSecret" ||
        key === "wmsPassword"
          ? "secret"
          : "default",
      enabled: true,
    })),
    _postman_variable_scope: "environment",
  };
}

async function main() {
  const conn = await prisma.tinyConnection.findFirst({
    where: {
      status: TinyConnectionStatus.CONNECTED,
      isActive: true,
      deletedAt: null,
      accessToken: { not: null },
    },
    include: { tenant: { select: { name: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });

  if (!conn?.accessToken || !conn.oauthClientId || !conn.oauthClientSecret) {
    throw new Error("Tiny não conectado ou credenciais OAuth incompletas.");
  }

  let accessToken = decrypt(conn.accessToken);
  const refreshToken = conn.refreshToken ? decrypt(conn.refreshToken) : "";
  const clientSecret = decrypt(conn.oauthClientSecret);

  if (refreshToken) {
    console.log("Renovando access_token para o Postman…");
    try {
      accessToken = await refreshTinyAccessTokenLocked(conn.id);
    } catch (e) {
      console.warn(
        "Refresh falhou, usando token em cache:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const meta = asRecord(conn.metadata);
  const wmsApiUrl = (
    process.env.API_PUBLIC_URL ??
    process.env.API_URL ??
    "http://localhost:3333"
  ).replace(/\/$/, "");

  let wmsToken = "";
  try {
    wmsToken = await fetchWmsToken(wmsApiUrl);
  } catch (e) {
    console.warn("WMS login opcional falhou:", e instanceof Error ? e.message : e);
  }

  const wmsOrder = await prisma.order.findFirst({
    where: { erpOrderId: "TINY-860301754", tenantId: conn.tenantId },
    select: { id: true },
  });

  const { dataInicial, dataFinal } = dateWindow();
  const envValues: EnvValues = {
    baseUrl: BASE_URL,
    tokenUrl: TOKEN_URL,
    accessToken,
    refreshToken,
    clientId: conn.oauthClientId,
    clientSecret,
    tenantName: conn.tenant.name,
    companyName: conn.companyName ?? str(meta?.nome) ?? str(meta?.razaoSocial),
    companyCnpj: str(meta?.cnpj),
    connectionStatus: conn.status,
    tokenExpiresAt: conn.tokenExpiresAt?.toISOString() ?? "",
    oauthRedirectUri: conn.oauthRedirectUri ?? `${wmsApiUrl}/integrations/tiny/oauth/callback`,
    dataInicial,
    dataFinal,
    pedidoMercado: String(REF.pedidoMercado),
    idNotaMercado: String(REF.idNotaMercado),
    idAgrupamentoMercado: String(REF.idAgrupamentoMercado),
    idExpedicaoMercado: String(REF.idExpedicaoMercado),
    pedidoAmazon: String(REF.pedidoAmazon),
    idNotaAmazon: String(REF.idNotaAmazon),
    idAgrupamentoAmazon: String(REF.idAgrupamentoAmazon),
    idExpedicaoAmazon: String(REF.idExpedicaoAmazon),
    pedidoAvulso: String(REF.pedidoMercado),
    produtoId: "",
    produtoSku: "2PUXTI",
    produtoNome: "PUX",
    produtoGtin: "",
    wmsApiUrl,
    wmsEmail: "operador@wms.local",
    wmsPassword: "operador123",
    wmsToken,
    wmsOrderIdMercado: wmsOrder?.id ?? "",
    exportedAt: new Date().toISOString(),
  };

  const exampleValues: EnvValues = {
    ...envValues,
    accessToken: "COLE_ACCESS_TOKEN_AQUI",
    refreshToken: "COLE_REFRESH_TOKEN_AQUI",
    clientId: "COLE_CLIENT_ID_AQUI",
    clientSecret: "COLE_CLIENT_SECRET_AQUI",
  };

  mkdirSync(OUT_DIR, { recursive: true });

  const collectionPath = resolve(
    OUT_DIR,
    "Tiny-Etiquetas-Expedicao.postman_collection.json",
  );
  const prontoCollectionPath = resolve(
    OUT_DIR,
    "Tiny-Etiquetas-Expedicao.pronto.postman_collection.json",
  );
  const localEnvPath = resolve(
    OUT_DIR,
    "Tiny-Etiquetas-Expedicao.local.postman_environment.json",
  );
  const exampleEnvPath = resolve(
    OUT_DIR,
    "Tiny-Etiquetas-Expedicao.example.postman_environment.json",
  );
  const readmePath = resolve(OUT_DIR, "README.md");

  writeFileSync(collectionPath, JSON.stringify(buildCollection(), null, 2));
  writeFileSync(
    prontoCollectionPath,
    JSON.stringify(
      buildCollection({
        accessToken,
        refreshToken,
        clientId: conn.oauthClientId,
        clientSecret,
      }),
      null,
      2,
    ),
  );
  writeFileSync(
    localEnvPath,
    JSON.stringify(
      buildEnvironment(envValues, "Tiny Etiquetas — LOCAL (tokens reais)"),
      null,
      2,
    ),
  );
  writeFileSync(
    exampleEnvPath,
    JSON.stringify(
      buildEnvironment(exampleValues, "Tiny Etiquetas — exemplo"),
      null,
      2,
    ),
  );

  const readme = `# Postman — Tiny Etiquetas (reunião suporte)

## Importar (recomendado — sem 401)

**Opção A — mais fácil:** importe só este arquivo (token já embutido):

- \`Tiny-Etiquetas-Expedicao.pronto.postman_collection.json\`

Não precisa de environment. Abra **01 — Info conta** → **GET /info** → Send.

**Opção B:** collection + environment:

1. \`Tiny-Etiquetas-Expedicao.postman_collection.json\`
2. \`Tiny-Etiquetas-Expedicao.local.postman_environment.json\`
3. Ative o environment **LOCAL** no canto superior direito.

## Antes da reunião

\`\`\`powershell
cd apps/api
pnpm export-postman-tiny-etiquetas
\`\`\`

Isso renova o access token se estiver perto de expirar e regrava o environment.

Se der 401 durante a call: pasta **00 — OAuth** → **Refresh access_token**.

## Demo sugerida

1. **00 — OAuth** → Refresh (se 401)
2. **01 — Info conta** → GET /info (CNPJ: ver \`companyCnpj\` no environment)
3. **02 — Mercado Envios** — requests 1→6 em ordem
4. Mostrar que 1–4 OK e 5–6 retornam erro sem \`urls[]\`
5. **03 — Amazon DBA** — repetir
6. **06 — Produtos** — lista, filtro por SKU (\`codigo\`), nome, GTIN e detalhe por id
7. *(Opcional)* **05 — WMS** — mesmo fluxo via nossa API

## Conta

| Campo | Valor |
|-------|-------|
| Tenant | ${conn.tenant.name} |
| Empresa | ${envValues.companyName || "—"} |
| CNPJ | ${envValues.companyCnpj || "—"} |
| Client ID | ${conn.oauthClientId} |

## Arquivos com tokens

\`*.local.postman_environment.json\` contém secrets — **não commitar** (gitignore).

Gerado em: ${new Date().toISOString()}
Tenant: ${conn.tenant.name}
Token expira: ${conn.tokenExpiresAt?.toISOString() ?? "—"}
`;

  writeFileSync(readmePath, readme);

  console.log("Postman exportado:");
  console.log(`  Collection: ${collectionPath}`);
  console.log(`  Collection PRONTA (use esta): ${prontoCollectionPath}`);
  console.log(`  Environment (tokens): ${localEnvPath}`);
  console.log(`  Exemplo: ${exampleEnvPath}`);
  console.log(`  README: ${readmePath}`);
  console.log(`\nTenant: ${conn.tenant.name}`);
  console.log(`Company: ${envValues.companyName || "—"}`);
  console.log(`CNPJ: ${envValues.companyCnpj || "—"}`);
  console.log(`Token expira: ${conn.tokenExpiresAt?.toISOString() ?? "—"}`);
  console.log(`Access token: ${accessToken.slice(0, 12)}…${accessToken.slice(-8)}`);
  console.log(`WMS order TINY-860301754: ${wmsOrder?.id ?? "não encontrado"}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
