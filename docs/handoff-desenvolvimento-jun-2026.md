# Handoff de desenvolvimento — Zentor WMS (jun/2026)

Documento de continuidade **histórico** (sessão encerrada em **12/jun/2026**). Resume o que foi feito naquela época, bloqueios de Mercado Envios e scripts.

> **Atualização ago/2026:** para etiquetas de transporte / packing / MEU PUXADOR / NF 171579, use o documento mestre  
> [[contexto-etiqueta-packing-tiny|Contexto etiqueta packing Tiny]]  
> (ZPL validado no lote `746538070`; WMS ainda só GET no botão “Buscar etiqueta”).

> Lista operacional resumida (notas soltas): [[Tarefas|Tarefas.md]]

---

## Visão geral do projeto

O **Zentor WMS** é um monorepo **pnpm** com:

| Pacote | Stack | Função |
|--------|-------|--------|
| `apps/api` | Fastify + Prisma + PostgreSQL | Backend, integrações Tiny/Olist, ondas, estoque |
| `apps/web` | Next.js (App Router) | Painel administrativo |
| `apps/mobile` | Expo | Separação, putaway, reabastecimento |
| `packages/shared` | TypeScript | Permissões, enums, tipos compartilhados |

Documentação existente (Obsidian/wikilinks): [[README|Centro de Documentação]].

**Setup local:** [[setup-desenvolvimento|Guia de Setup]]  
**Usuários de teste:** [[usuarios-teste|Credenciais e Testes]]

---

## Contexto do que estávamos trabalhando

O foco recente foi a **integração Olist ERP (Tiny) API v3** e melhorias operacionais no WMS:

1. **Conectar conta OAuth** e estabilizar tokens (ver [[integracao-tiny-oauth]] e [[tiny-conexao-conta-ajustes]]).
2. **Sincronizar pedidos de venda** (webhook + pull + job diário) — ver [[integracao-tiny-pedidos]].
3. **Sincronizar catálogo de produtos** do Tiny para a tabela `products`.
4. **Recebimento por NF de entrada** (DANFE) — ver [[fluxo-recebimento-putaway]].
5. **Layout físico do galpão** (barracão → setor → corredor/fileira/estante/prateleira/coluna).
6. **Investigar etiquetas de expedição** (transporte saída empresa → cliente) — **principal bloqueio não resolvido**.

Grande parte das alterações **ainda não está commitada** no Git (ver `git status` na raiz). Há também **scripts SQL manuais** em `apps/api/prisma/` que podem não ter sido aplicados no banco de todos os ambientes.

---

## O que já está implementado

### Integração Tiny — OAuth e infraestrutura

- [x] Fluxo OAuth v3 com criptografia de tokens (`ENCRYPTION_KEY`).
- [x] Worker de refresh proativo de tokens.
- [x] Rate limit / retry HTTP 429 no `TinyApiV3Client`.
- [x] Permissão dedicada `olist.configure` (expedidor pode configurar integração).
- [x] Correções de CORS, body vazio Fastify 5, redirect URI, popup OAuth.
- [x] Conexões Tiny por usuário (`userId`, `isDefault`) — schema + SQL de migração manual.

**Arquivos principais:** `apps/api/src/services/tiny-oauth*.ts`, `apps/api/src/routes/tiny.ts`, `apps/web/app/(dashboard)/integracoes/tiny/page.tsx`.

### Integração Tiny — Pedidos de venda

- [x] Webhook `POST /integrations/tiny/webhook`.
- [x] Sync pull `GET /pedidos` + detalhe `GET /pedidos/{id}`.
- [x] Job agendado (~07:00 America/Sao_Paulo).
- [x] Situações importadas: 0, 1, 3, 4, 7; cancelado (2) remove PENDING.
- [x] Prioridade Tiny + enrich por marketplace/deadline.
- [x] UI em `/integracoes/tiny` com sync manual, eventos e warnings (`listedFromTiny`, erros de SKU).
- [x] Itens sem produto cadastrado guardam `erpSku` / `erpDescription` (migration SQL pendiente).

**Arquivos:** `tiny-integration.ts`, `sync-sales-orders-from-tiny.ts`, `tiny-order-sync-scheduler.ts`.

### Integração Tiny — Produtos

- [x] Sync `GET /produtos` + detalhe `GET /produtos/{id}`.
- [x] Upsert em `products`: SKU, nome, GTIN/barcode, unidade, peso, imagem, **fornecedor** (`supplierName`), **estoque ERP** (`erpStockQuantity`).
- [x] Expansão de **variações** (`variacoes[]`) em múltiplos produtos WMS.
- [x] Checkpoint/resumo de sync interrompido (`tiny-sync-checkpoint.ts`).
- [x] Botões na UI: **Sincronizar produtos** e **Recomeçar do zero**.
- [x] Testes unitários em `tiny-product-sync.test.ts`.

**Arquivos:** `sync-products-from-tiny.ts`, `tiny-product-sync.ts`, rota `POST /api/integrations/tiny/sync-products`.

**Campos da API documentados em:** `docs/tiny-produtos-api-fields.json`.

### Recebimento (NF de entrada — notas de entrada)

- [x] Busca NF por chave DANFE (`GET /notas?tipo=E`).
- [x] Conferência cega + putaway (fluxo documentado).
- [x] Tela `/recebimentos` no web + fluxo mobile.

**Importante:** isto é **nota fiscal de entrada**, não ordem de compra (ver seção pendente).

### Cadastros — localizações (gôndolas)

- [x] Colunas de layout na tabela: SKU, Localização (barcode), Barracão, Setor, Estante, Prateleira, Coluna, Corredor, Fileira.
- [x] Coluna **Estoque** no formato `capacidade/quantidadeAtual` (ex.: `100/8`).
- [x] Filtro por **SKU** (texto).
- [x] Filtro por tipo: Pulmão / Estoque de giro.
- [x] Formulário e importação XLSX com campos de layout (`location-layout-fields.tsx`).
- [x] Resolução de hierarquia no backend (`warehouse-layout.ts`).

**Tela:** `/cadastros` → aba Gôndolas / Localizações.

### Gestão de barracão (layout do galpão)

- [x] Modelo Prisma hierárquico com `pickOrder` em cada nível.
- [x] API CRUD em `apps/api/src/routes/warehouse.ts`.
- [x] Tela `/gestao-barracao` com editor de árvore, busca e modal unificado **Novo** (barracão, setor, corredor, fileira, estante, prateleira, coluna).
- [x] Árvore ordenada por `pickOrder` + `code` (`warehouse-tree.ts`).

### Usuários e permissões (básico)

- [x] RBAC com papéis `PICKER`, `REPLENISHER`, `EXPEDITER`, `ADMIN` — ver [[arquitetura-e-seguranca]].
- [x] Tela `/admin/usuarios`: criar/editar usuário, papel e **permissoes granulares** checkbox.

### Scripts de diagnóstico Tiny (API)

| Comando | Arquivo | Saída |
|---------|---------|-------|
| `pnpm --filter @wms/api teste-rotas` | `scripts/teste-rotas-tiny.ts` | `docs/tiny-teste-rotas.json` |
| `pnpm --filter @wms/api teste-pedido TINY-{id}` | `scripts/teste-pedido-tiny.ts` | `docs/tiny-pedido-{id}.json` |
| `pnpm tsx scripts/teste-etiquetas-pedido.ts {id}` | `scripts/teste-etiquetas-pedido.ts` | `docs/tiny-etiquetas-{id}.json` |
| `pnpm tsx scripts/teste-etiquetas-lote.ts TINY-...` | `scripts/teste-etiquetas-lote.ts` | `docs/tiny-etiquetas-lote.json` |
| `pnpm --filter @wms/api tiny:fetch-products` | `scripts/fetch-tiny-products.ts` | amostras de produtos |

**Pré-requisito:** OAuth conectado em `/integracoes/tiny`.

---

## O que NÃO está pronto (prioridade para o próximo dev)

### 🔴 1. Etiquetas de expedição (transporte) — BLOQUEIO PRINCIPAL

**Objetivo:** obter etiqueta ZPL/PDF de envio (empresa → cliente) para packing/expedição no WMS.

**O que tentamos:**

- Rotas corretas na API v3 (documentação Olist):
  - `GET /expedicao` — listar agrupamentos
  - `GET /expedicao/{idAgrupamento}` — detalhe com `expedicoes[]`
  - `GET /expedicao/{idAgrupamento}/etiquetas` → `{ urls: string[] }`
  - `GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas` → `{ urls: string[] }`
- **Não existe** `GET /pedidos/{id}/etiquetas` na API v3.
- Scripts varrem agrupamentos e cruzam pedido/NF com `expedicoes[].venda.id`, `notaFiscal.id`, etc.

**Resultado dos testes (conta real, jun/2026):**

| Artefato | Resultado |
|----------|-----------|
| `docs/tiny-etiquetas-lote.json` | 6 pedidos **Pronto Envio** (situação 7), forma **Mercado Envios** — **0 etiquetas** em todos |
| `docs/tiny-etiquetas-860184598.json` | 572 agrupamentos varridos — pedido **não encontrado** na expedição |
| `docs/tiny-pedido-860013208.json` | Pedido faturado/pronto envio, NF existe, **0 expedições** encontradas |

**Hipótese validada:** pedidos **Mercado Envios** podem estar “Pronto Envio” no Tiny **sem** entrar em agrupamento de expedição. Nesse caso a etiqueta fica no **marketplace** (Mercado Livre), não nas rotas `/expedicao/.../etiquetas`. Marcadores do pedido incluem `"MercadoEnvios Coleta"` e `"Etiqueta com data programada"`.

**Quando funciona:** em `docs/tiny-teste-rotas.json` há agrupamentos com URLs ZPL na S3 (`https://s3.amazonaws.com/tiny-tmp-us/erp/.../etiquetas/*.zpl`) — típico de expedições já agrupadas no Tiny (Correios/outros, não Mercado Envios).

**Próximos passos sugeridos:**

1. Confirmar com operação/cliente: pedido precisa ser **agrupado na expedição Tiny** antes da API devolver etiqueta?
2. Para Mercado Envios: investigar API do **Mercado Livre** (não Tiny) ou fluxo manual no ERP.
3. Implementar serviço WMS `fetchShippingLabels(orderId)` que:
   - Busca pedido WMS → `TINY-{id}`
   - Localiza agrupamento/expedição (lógica já esboçada nos scripts)
   - Baixa URLs e associa ao pedido/packing
4. Tratar fallback: exibir motivo claro na UI packing (“pedido não está em agrupamento de expedição”).
5. Não confundir com link da **DANFE** (`erp.tiny.com.br/doc.view?...`) — documento fiscal ≠ etiqueta de transporte.

Referência de mapeamento: `docs/tiny-logistica-sample.json` (`wmsMappingHints`).

---

### 🟠 2. Logística — formas de envio e token

**Notas originais:** “LOGÍSTICA > UNICO REQUEST > QNT INTEGRAR O TOKEN”.

**Estado:**

- Rotas exploradas e amostradas:
  - `GET /formas-envio`
  - `GET /formas-envio/{idFormaEnvio}`
- Respostas em `docs/tiny-teste-rotas.json` e pedidos individuais (ex.: forma `744061814` = Mercado Envios).
- **Não integrado** no WMS: não há persistência de `ShippingMethod`, nem uso no packing, nem vínculo automático pedido → forma de envio → expedição.

**Próximo passo:** modelar entidade WMS (ou campos em `Order`) para `idFormaEnvio`, nome, gateway logístico; usar no fluxo de busca de etiqueta.

---

### 🟠 3. Sync de produtos — excluir Kit no request

**Nota original:** “Produto x Variação - Excluir Kit no request.”

**Estado:**

- Sync lista **todos** os produtos via `GET /produtos` **sem filtrar** `tipo`.
- Na API Tiny, `tipo`: `K` = Kit, `S` = Simples, `V` = Com variações, etc. (`docs/tiny-produtos-api-fields.json`).
- Variações já são expandidas no detalhe; **kits ainda entram** na listagem e podem gerar SKUs indesejados ou duplicados.

**Próximo passo:**

- Filtrar na listagem ou no parser: pular `tipo === "K"` (e avaliar `tipoVariacao === "P"` pai de variação se necessário).
- Opcional: query `GET /produtos` se a API suportar filtro por tipo (confirmar na doc Olist).

**Arquivo:** `apps/api/src/services/sync-products-from-tiny.ts` (loop principal ~linha 343).

---

### 🟠 4. Ordem de compra — não puxar

**Decisão de negócio:** **não** integrar ordem de compra como documento separado.

- Campo `numeroOrdemCompra` em `GET /pedidos/{id}` na prática traz ID do **marketplace** (ex.: `2000013159521047` Mercado Livre), não OC de compra.
- Recebimento no WMS usa **NF de entrada** (`tipo=E`), alinhado à tela ERP:  
  https://erp.tiny.com.br/notas_entrada#list

**Não implementar** sync de ordem de compra salvo nova definição de produto.

---

### 🟠 5. Tela Cadastros — aba Produtos e colunas pendentes

**Notas originais:**

| Item | Estado |
|------|--------|
| Coluna **Produtos** / cadastro novo | **Não feito** — `/cadastros` só tem Gôndolas e Cestas; produtos só via sync Tiny ou seed |
| **SKU** — selecionar da lista sincronizada | **Não feito** — formulário de localização não tem autocomplete de produtos |
| **Fornecedor** + botão Add | **Parcial** — `supplierName` sincroniza do Tiny; **sem coluna/UI** para editar ou adicionar fornecedor manual |
| **Estoq > Qnt** (estoque ERP) | **Parcial** — `erpStockQuantity` no banco; **não exibido** na tela cadastros |
| **Tamanho** (capacidade) + **Qnt atual** unificado `100/8` | **Feito na tabela de localizações**; falta na futura aba Produtos |
| Renomear **Barcode → Localização** | **Feito** (coluna “Localização” mostra `barcode`) |
| Filtros: Setor, Prateleira, Barracão, Estante, Coluna | **Parcial** — colunas existem; **só filtro SKU** implementado; faltam filtros por hierarquia |

**Próximo passo:** criar aba **Produtos** em `/cadastros` listando `products` com colunas SKU, nome, fornecedor, estoque ERP, estoque WMS (soma locations), barcode; formulário com picker de SKU sincronizado.

---

### 🟠 6. Coleta de itens (picking)

**Notas originais:** “COLETA DE ITENS -” (sem detalhe).

**Estado:**

- Picking mobile e ondas existem ([[logica-ondas]]).
- Ordenação de rota usa **corredor/fileira** (`location-route.ts`, `order-proximity.ts`) — **não usa** `pickOrder` do layout hierárquico novo.
- Layout do barracão cadastrado **ainda não direciona** decisão de coleta automaticamente.

**Próximo passo:** conectar `pickOrder` (barracão → coluna) à ordenação em `sortLocationsByRoute` ou novo algoritmo; refletir ordem definida em `/gestao-barracao`.

---

### 🟠 7. Gestão de barracão — ordem das posições

**Notas originais:** cadastrar posições; ordem define melhor rota de coleta; posições vão para Cadastros depois.

**Estado:**

- Cadastro hierárquico **funciona** (criar nós).
- Campo `pickOrder` existe no schema e na API (`PATCH` aceita `pickOrder`).
- **Sem UI** para reordenar (drag-and-drop ou inputs numéricos).
- Vínculo localização ↔ layout **parcial** (form de nova localização já referencia IDs de layout).

**Próximo passo:**

1. UI de reorder em `/gestao-barracao`.
2. Propagar ordem para picking (item 6).
3. Garantir que posições criadas apareçam como opções em Cadastros → Nova localização.

---

### 🟡 8. Sistema de cadastro de funcionário

**Notas originais:** Permissões, Cargos.

**Estado:**

- Já existe `/admin/usuarios` com **papéis** (`UserRole`) e **permissões** checkbox.
- **Não existe** conceito separado de “Cargo” (job title customizável) além do enum de roles.
- **Não existe** cadastro estendido de funcionário (CPF, turno, setor operacional, etc.).

**Próximo passo:** alinhar com produto se “Cargo” = role existente ou nova entidade; expandir modelo `User` se necessário.

---

### 🟡 9. Expedição / packing — integração end-to-end

**Rotas mapeadas, não integradas na UI `/packing`:**

```
GET /expedicao
GET /expedicao/{idAgrupamento}
GET /expedicao/{idAgrupamento}/etiquetas
GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas
```

**Próximo passo:** após resolver bloqueio de etiquetas (item 1), expor download/impressão na fila de packing e registrar evento de integração.

---

## Migrações SQL manuais (verificar se aplicadas)

Arquivos **fora** do fluxo Prisma migrate automático:

| Arquivo | Conteúdo |
|---------|----------|
| `apps/api/prisma/migrate-tiny-user-accounts.sql` | `tiny_connections.userId`, `isDefault`, FK por usuário |
| `apps/api/prisma/migrate-order-item-erp-sku.sql` | `order_items.productId` nullable, colunas `erpSku`, `erpDescription` |

**Ação:** rodar no Postgres de cada ambiente (dev/staging/prod) se as colunas ainda não existirem; depois `pnpm --filter @wms/api db:generate`.

Também validar se `schema.prisma` local está alinhado (`supplierName`, `erpStockQuantity` em `Product`, tabelas `warehouse_*`).

---

## Mapa de arquivos importantes (alterações recentes)

```
apps/api/src/
  routes/tiny.ts              # OAuth, sync orders/products
  routes/warehouse.ts         # CRUD layout galpão
  services/
    tiny-integration.ts       # Pedidos webhook/API
    sync-sales-orders-from-tiny.ts
    sync-products-from-tiny.ts
    tiny-product-sync.ts
    tiny-sync-checkpoint.ts
    warehouse-layout.ts
    warehouse-tree.ts
  scripts/
    teste-rotas-tiny.ts
    teste-pedido-tiny.ts
    teste-etiquetas-pedido.ts
    teste-etiquetas-lote.ts

apps/web/
  app/(dashboard)/integracoes/tiny/page.tsx
  app/(dashboard)/cadastros/page.tsx
  app/(dashboard)/gestao-barracao/page.tsx
  components/warehouse/warehouse-layout-editor.tsx
  components/cadastros/location-layout-fields.tsx
  lib/api/warehouse.ts

docs/
  integracao-tiny-pedidos.md    # Referência pedidos (completa)
  tiny-teste-rotas.json         # Amostras API logística
  tiny-etiquetas-*.json         # Diagnóstico etiquetas
  tiny-pedido-*.json            # Pedidos individuais analisados
```

---

## Testes automatizados

```bash
pnpm --filter @wms/api test
```

Inclui: `tiny-integration`, `tiny-sales-order-sync`, `tiny-product-sync`, `tiny-sync-checkpoint`, `tiny-oauth`, `tiny-order-priority`.

---

## Checklist rápido para assumir o projeto

1. [ ] Clonar, `pnpm install`, Docker Postgres, `.env` — [[setup-desenvolvimento]].
2. [ ] Aplicar migrations Prisma + SQLs manuais se necessário.
3. [ ] `pnpm dev` — API `:3333`, Web `:3000`.
4. [ ] Login com usuário de [[usuarios-teste]].
5. [ ] Conectar OAuth em `/integracoes/tiny`.
6. [ ] Rodar sync produtos + sync pedidos; validar SKUs.
7. [ ] Ler `docs/tiny-etiquetas-lote.json` e reproduzir com `teste-etiquetas-lote.ts`.
8. [ ] Priorizar: **etiquetas** → **filtro kit no sync** → **aba Produtos cadastros** → **pickOrder na coleta**.

---

## Referências externas

- [Autenticação OAuth Olist/Tiny](https://api-docs.erp.olist.com/documentacao/comecando/autenticacao)
- [Listar agrupamentos de expedição](https://api-docs.erp.olist.com/api-reference/expedição/listar-agrupamentos-de-expedição)
- [Etiquetas de agrupamento](https://api-docs.erp.olist.com/api-reference/expedição/obter-etiquetas-de-um-agrupamento-de-expedição)
- [Notas de entrada ERP (UI)](https://erp.tiny.com.br/notas_entrada#list)
- [Webhooks Olist](https://api-docs.erp.olist.com/documentacao/webhooks/webhooks)

---

## Contato / histórico

Este handoff consolida trabalho de integração Tiny, layout de galpão e diagnóstico de etiquetas realizado até **12/jun/2026**. Para detalhes linha a linha de pedidos OAuth, ver commits locais não publicados e documentos linkados acima.

**Lista de tarefas soltas (formato original):** [[Tarefas]]
