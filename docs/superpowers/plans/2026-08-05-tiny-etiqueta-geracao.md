# Tiny etiqueta geração (packing) Implementation Plan

> **Adendo 2026-08-18:** antes de implementar, ler [[contexto-etiqueta-packing-tiny]]. Preferir `idsNotasFiscais`, incluir `POST .../concluir` quando GET etiquetas exigir, e ampliar janela de busca de agrupamentos até a data de hoje. O texto das tasks abaixo ainda reflete o spec original (só `idsPedidos`, sem concluir) — **atualizar as tasks ao executar**.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao clicar “Buscar etiqueta” no packing, se o pedido Tiny não estiver em agrupamento de expedição, o WMS cria o agrupamento via `POST /expedicao` e em seguida obtém as URLs das etiquetas.

**Architecture:** Estender `tiny-expedicao-labels.ts` com `criarAgrupamentoExpedicao` (+ `concluirAgrupamentoExpedicao`). Em `fetchShippingLabelsForOrder`: busca ampliada → se miss, create (NF preferencial) → validar `expedicoes[]` → concluir se necessário → GET etiquetas. Endpoint e tela de packing permanecem os mesmos; resultado ganha `createdAgrupamento?` / `concludedAgrupamento?`.

**Tech Stack:** Fastify API, Tiny API v3 OAuth client, Prisma `Order.shippingLabel`, React packing page, Vitest/node tests no padrão `apps/api/src/services/tiny-*.test.ts`.

**Spec:** [docs/superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design.md](../specs/2026-08-05-tiny-etiqueta-geracao-design.md) (+ adendo 18/08)  
**Contexto:** [docs/contexto-etiqueta-packing-tiny.md](../../contexto-etiqueta-packing-tiny.md)

## Global Constraints

- Encaixe **somente** no fluxo “Buscar etiqueta” (opção A do spec) — não no `completePacking`.
- Preferir `idsNotasFiscais` quando o pedido Tiny tiver NF; fallback `idsPedidos` se sem NF.
- **Concluir** agrupamento quando GET etiquetas retornar “ainda não foi concluído”.
- Não mudar status do pedido WMS por causa da etiqueta.
- Não editar o arquivo de plano Cursor anexado pelo usuário; docs novos em `docs/superpowers/` / `docs/contexto-*.md`.

---

### Task 1: Wrapper `POST /expedicao`

**Files:**
- Modify: `apps/api/src/services/tiny-expedicao-labels.ts`
- Test: `apps/api/src/services/tiny-shipping-labels.test.ts` (criado na Task 2; nesta task só a função create)

**Interfaces:**
- Consumes: `TinyApiV3Client.request`
- Produces:
  ```ts
  export async function criarAgrupamentoExpedicao(
    client: TinyApiV3Client,
    body: { idsPedidos?: number[]; idsNotasFiscais?: number[] },
  ): Promise<{ id: number }>
  ```

- [ ] **Step 1: Add `criarAgrupamentoExpedicao`**

Append to `tiny-expedicao-labels.ts` (após os GET helpers existentes):

```ts
/** POST /expedicao — criar agrupamento (idsPedidos e/ou idsNotasFiscais) */
export async function criarAgrupamentoExpedicao(
  client: TinyApiV3Client,
  body: { idsPedidos?: number[]; idsNotasFiscais?: number[] },
): Promise<{ id: number }> {
  const resposta = await client.request("POST", "/expedicao", { body });
  const record =
    resposta && typeof resposta === "object" && !Array.isArray(resposta)
      ? (resposta as Record<string, unknown>)
      : null;
  const id = Number(record?.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new TinyApiError(
      "Tiny não retornou id do agrupamento de expedição",
      502,
      resposta,
    );
  }
  return { id };
}
```

Ensure `TinyApiError` is already imported from `./tiny-api-v3-client.js` (add import if missing).

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/services/tiny-expedicao-labels.ts
git commit -m "feat(tiny): add POST /expedicao wrapper for shipping groups"
```

---

### Task 2: Orquestrar create-on-miss em `fetchShippingLabelsForOrder`

**Files:**
- Modify: `apps/api/src/services/tiny-shipping-labels.ts`
- Create: `apps/api/src/services/tiny-shipping-labels.test.ts`
- Modify: `apps/api/src/services/order-packing.ts` (somente se re-exportar novos símbolos — manter re-export de `fetchShippingLabelsForOrder`)

**Interfaces:**
- Consumes: `criarAgrupamentoExpedicao`, `buildPedidoExpedicaoIndex`, `findPedidoNoIndice`, `buscarEtiquetasExpedicao`, `obterAgrupamentoExpedicao`
- Produces: `ShippingLabelResult` com `createdAgrupamento?: boolean` e status `CREATE_EXPEDICAO_ERROR`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/services/tiny-shipping-labels.test.ts`. Mirror mocking style from `tiny-integration.test.ts` / `tiny-oauth.test.ts` (mock prisma + client).

Minimal cases (adapt imports/mocks to project patterns):

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// After wiring mocks for prisma.order.findFirst / update and getTinyApiClient:
describe("fetchShippingLabelsForOrder create-on-miss", () => {
  it("calls POST /expedicao when pedido not in index then returns OK urls", async () => {
    // index empty first; after create, match exists with urls
    // assert client.request called with ("POST", "/expedicao", { body: { idsPedidos: [123] } })
    // assert result.status === "OK" && result.createdAgrupamento === true && result.urls.length > 0
  });

  it("does not POST when pedido already in expedicao", async () => {
    // match present; assert no POST /expedicao
    // result.createdAgrupamento falsy
  });

  it("returns CREATE_EXPEDICAO_ERROR when POST fails", async () => {
    // index empty; POST throws TinyApiError with mensagem
    // result.status === "CREATE_EXPEDICAO_ERROR"
  });
});
```

Fill in real mocks so tests compile and fail until Task 2 implementation exists.

- [ ] **Step 2: Run tests — expect fail**

```bash
cd apps/api && pnpm exec vitest run src/services/tiny-shipping-labels.test.ts
```

Expected: FAIL (create path not implemented / status missing).

- [ ] **Step 3: Extend types and orchestration**

In `tiny-shipping-labels.ts`:

1. Import `criarAgrupamentoExpedicao` (and `obterAgrupamentoExpedicao` if used to resolve match after create).
2. Extend:

```ts
export type ShippingLabelStatus =
  | "OK"
  | "NOT_TINY_ORDER"
  | "NOT_IN_EXPEDICAO"
  | "CREATE_EXPEDICAO_ERROR"
  | "MARKETPLACE_ERROR"
  | "NO_URLS"
  | "API_ERROR";

export type ShippingLabelResult = {
  status: ShippingLabelStatus;
  urls: string[];
  message?: string;
  expedicao?: { idAgrupamento: number; idExpedicao: number };
  formaEnvioNome?: string | null;
  cached: boolean;
  createdAgrupamento?: boolean;
};
```

3. Replace the early `if (!match) { return NOT_IN_EXPEDICAO }` block with:

```ts
let createdAgrupamento = false;
if (!match) {
  try {
    const { id: idAgrupamento } = await criarAgrupamentoExpedicao(client, {
      idsPedidos: [pedidoId],
    });
    createdAgrupamento = true;
    // Prefer: rebuild index OR load agrupamento and find pedido
    const index = await buildPedidoExpedicaoIndex(client);
    match = findPedidoNoIndice(index, pedidoId);
    if (!match) {
      // Fallback: detail of created group
      const detalhe = await obterAgrupamentoExpedicao(client, idAgrupamento);
      // parse expedicoes for venda.id === pedidoId using same helpers as index builder
      match = /* resolve from detalhe */ null;
    }
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Falha ao criar agrupamento de expedição no Tiny";
    return {
      status: "CREATE_EXPEDICAO_ERROR",
      urls: [],
      message,
      cached: false,
    };
  }
}

if (!match) {
  return {
    status: "NOT_IN_EXPEDICAO",
    urls: [],
    message:
      "Não foi possível localizar o pedido na expedição Tiny após tentar agrupar.",
    cached: false,
    createdAgrupamento,
  };
}
```

4. On successful URL persist, include `createdAgrupamento` in the returned `OK` object.

5. If Tiny returns error that pedido already in group, catch and rebuild index (treat as non-fatal) before failing.

Implement `resolveMatchFromAgrupamento(detalhe, pedidoId)` inline or as a small helper next to `findPedidoNoIndice` if parsing is duplicated.

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/api && pnpm exec vitest run src/services/tiny-shipping-labels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/tiny-shipping-labels.ts apps/api/src/services/tiny-shipping-labels.test.ts apps/api/src/services/tiny-expedicao-labels.ts
git commit -m "feat(packing): create Tiny expedicao group when fetching labels"
```

---

### Task 3: UI messages on packing detail

**Files:**
- Modify: `apps/web/app/(dashboard)/packing/[orderId]/page.tsx`

**Interfaces:**
- Consumes: JSON `ShippingLabelResult` from existing `POST .../shipping-labels` (fields `status`, `message`, `urls`, `createdAgrupamento`)

- [ ] **Step 1: Surface create success/error**

Where `handleFetchShippingLabel` sets `labelMessage` / `labelUrls`, after parsing the response:

- If `status === "OK"` and `createdAgrupamento`: set message to `Pedido agrupado na expedição Tiny. Etiqueta pronta.` (or keep API `message` if present).
- If `status === "CREATE_EXPEDICAO_ERROR"`: show `message` in amber/red (same pattern as current non-OK messages).
- Change button label from `"Buscar etiqueta"` to `"Buscar / gerar etiqueta"`.

Do not change complete-packing behavior.

- [ ] **Step 2: Manual smoke (dev)**

With Tiny connected and a `PENDING`/`PICKED_AWAITING_CONFERENCE` order `TINY-*` known outside expedição:

1. Open `/packing/[orderId]`
2. Click Buscar etiqueta
3. Expect URL link or marketplace error (not “não está em agrupamento” when create succeeds)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/packing/[orderId]/page.tsx"
git commit -m "feat(packing): show Tiny expedicao create result on label fetch"
```

---

### Task 4: Docs sync

**Files:**
- Modify: `docs/etiquetas-expedicao-tiny.md` (seção “Opção 2 — Via API” / próximo passo)
- Modify: `docs/README.md` (link para o spec sob Integrações)
- Spec already at `docs/superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design.md`

- [ ] **Step 1: Update etiquetas doc**

Replace “ainda não integrado” / “Próximo passo: automatizar POST” with: integrado no “Buscar etiqueta” do packing; link to the design spec.

- [ ] **Step 2: Link from README**

Under Integrações, add:

`* [[superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design|Design: geração de etiqueta Tiny no packing]]`

- [ ] **Step 3: Commit**

```bash
git add docs/etiquetas-expedicao-tiny.md docs/README.md docs/superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design.md docs/superpowers/plans/2026-08-05-tiny-etiqueta-geracao.md
git commit -m "docs: map packing screens and Tiny label generation design"
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Inventário tela a tela documentado | Spec file + Task 4 |
| Opção A (Buscar etiqueta) | Tasks 2–3 |
| `POST /expedicao` com `idsPedidos` | Task 1–2 |
| Flag / mensagem create | Tasks 2–3 |
| Sem completePacking / sem UI expedição | Global constraints |
| Testes create-on-miss / skip | Task 2 |
