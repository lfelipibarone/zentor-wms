# Contexto: etiqueta Tiny — pedido 214617 / NF 005554

**Atualizado em:** 2026-08-11  
**Status:** bloqueado em OAuth Tiny (`ERROR` / credenciais inválidas). Fluxo de API e script de prova já preparados; falta reconectar e rodar.

Relacionado: [[etiquetas-expedicao-tiny]], [[tiny-fluxo-etiqueta-214617]], [[superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design]], [[integracao-tiny-oauth]].

---

## Objetivo

1. Provar o fluxo completo na Tiny: **criar expedição → obter URLs de etiqueta → concluir agrupamento**.
2. Documentar cada etapa e retorno (JSON).
3. Depois integrar nas rotas WMS (botão “Buscar / imprimir etiqueta” no packing) e persistir dados para a tela.

---

## Pedido alvo (mapeamento correto)

| Campo | Valor |
|-------|--------|
| Número na tela Tiny | **214617** |
| NF na tela | **005554** |
| `erpOrderId` no WMS | **`TINY-861203611`** |
| `idPedido` API | `861203611` |
| `idNotaFiscal` API | `861203622` |
| Forma envio | Correios (`743997871`) |
| Cliente | Rafael Garcia |
| Situação pedido | Faturada (`1`) |

### Pedido confuso (NÃO usar neste fluxo)

| Campo | Valor |
|-------|--------|
| `erpOrderId` | `TINY-860803335` |
| Número na tela | **211641** (não 214617) |
| NF | **002707** |
| Marcadores | “1ª venda”, “Devolvido” |
| Mesmo cliente/SKU | sim — por isso gerou confusão |

Ambos existem no WMS em `PAUSED_ISSUE`.

---

## Fluxo Tiny (o que gera etiqueta)

**Não existe** `GET /pedidos/{id}/etiquetas`.

| # | Etapa | Rota | Para quê |
|---|--------|------|----------|
| 1 | Resolver número | `GET /pedidos?numero=214617` | achar `idPedido` |
| 2 | Pedido | `GET /pedidos/861203611` | NF, forma envio |
| 3 | Nota | `GET /notas/861203622` | confirmar `005554` |
| 4 | **Criar** agrupamento | `POST /expedicao` body `{ "idsPedidos": [861203611] }` | retorna `{ id: idAgrupamento }` |
| 5 | Detalhe | `GET /expedicao/{idAgrupamento}` | achar `idExpedicao` |
| 6 | Etiquetas lote | `GET /expedicao/{idAgrupamento}/etiquetas` | `{ urls: [...] }` |
| 7 | Etiqueta individual | `GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas` | URL do pedido |
| 8 | **Concluir** | `POST /expedicao/{idAgrupamento}/concluir` | fecha lote no ERP |

**Importante:** para **imprimir** etiqueta basta criar + GET etiquetas. **Concluir** é passo separado (despacho no Tiny); na prova o usuário pediu “gerar tudo” (incluir concluir).

Design aprovado do packing (só create na etiqueta; concluir fora de escopo da 1ª entrega): [[superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design]].

---

## O que já foi feito

### Evidências / arquivos

| Arquivo | Conteúdo |
|---------|----------|
| `docs/tiny-pedido-861203611.json` | JSON completo do pedido certo (pedido + NF 005554 + busca expedição = 0) |
| `docs/tiny-pedido-860803335.json` | JSON do pedido antigo (211641 / 002707) |
| `docs/tiny-criar-expedicao-214617.json` | Tentativas `POST /expedicao` → **HTTP 403** (corpo vazio) |
| `docs/tiny-fluxo-etiqueta-214617.json` | Descrição de cada etapa, retorno esperado e últimos resultados reais |
| `apps/api/scripts/teste-fluxo-etiqueta-completo.ts` | Script que executa o fluxo e grava resultado |
| `apps/api/package.json` → `teste-fluxo-etiqueta` | `tsx --env-file .env scripts/teste-fluxo-etiqueta-completo.ts` |

### Resultado das tentativas reais

- `GET /pedidos`, `GET /notas`, `GET /expedicao` (leitura): **OK** (enquanto token era válido).
- `POST /expedicao` (criar): **403** — permissão Incluir/editar na API de Expedição faltando **ou** token antigo sem o novo escopo.
- Depois: regeneraram chaves OAuth → refresh passou a falhar com `Invalid client or Invalid client credentials`.
- Token expirou → `GET` também **401**.
- Conexão Tiny no banco remoto: status **`ERROR`**, `updatedAt` ~ `2026-08-10T14:56:02Z` (sem reconexão bem-sucedida desde então).

### Ambiente / banco

- Postgres **local** (`localhost:5432`) via Docker: **não estava rodando**.
- Banco útil (pedidos + OAuth Tiny): remoto Coolify em `177.7.39.127:5432` (hostname interno Coolify `wms-wms-tjyjjq` **não resolve** da máquina local).
- `apps/api/.env` foi ajustado para o host remoto `177.7.39.127` para scripts/API local usarem os mesmos dados.
- Redirect OAuth gravado na conexão:  
  `https://wms-backend-4dhznc-57e100-177-7-39-127.sslip.io/integrations/tiny/oauth/callback`  
  Com `API_PUBLIC_URL=http://localhost:3333`, o WMS local força callback  
  `http://localhost:3333/integrations/tiny/oauth/callback` — **esse URI precisa existir no app Tiny**.

---

## Bloqueio atual (obrigatório antes de continuar)

```
Tiny status = ERROR
lastError = Invalid client or Invalid client credentials
```

O script `pnpm teste-fluxo-etiqueta` **vai falhar sempre** até OAuth ficar `CONNECTED`.

### Reconectar (checklist)

1. Tiny ERP → Configurações → Aplicativos → app da integração  
   - Client ID / Secret **atuais**  
   - Permissão **API de Expedição: Incluir e editar**  
   - Redirect URI incluir: `http://localhost:3333/integrations/tiny/oauth/callback` (e o de produção se ainda usar)
2. Subir `pnpm run dev` (API + web) com o `.env` do banco remoto.
3. Abrir [http://localhost:3000/integracoes/tiny](http://localhost:3000/integracoes/tiny)  
4. Colar secret → **Conectar/Reconectar** → autorizar no popup.  
5. Confirmar status **CONNECTED** na UI.  
6. Rodar:
   ```powershell
   cd apps/api
   pnpm teste-fluxo-etiqueta --numero 214617
   ```
7. Resultado esperado: `docs/tiny-fluxo-etiqueta-861203611-resultado.json` com `urls` preenchidas.

Sem `--skip-concluir` o script também chama `POST .../concluir`.

---

## Integração WMS (próximo passo de produto — ainda não implementado)

Hoje `POST /api/packing/orders/:id/shipping-labels` só **consulta** (GET). Se pedido fora de expedição → `NOT_IN_EXPEDICAO`.

Design já aprovado:

- No clique “Buscar etiqueta”: se não estiver em agrupamento → `POST /expedicao` → buscar URLs → salvar `Order.shippingLabel`.
- Flag `createdAgrupamento` na resposta.
- **Concluir** fora do escopo da 1ª entrega de packing (usuário pediu prova completa via script; na tela pode ser botão separado depois).

Arquivos-chave:

- `apps/api/src/services/tiny-shipping-labels.ts` — orquestra busca
- `apps/api/src/services/tiny-expedicao-labels.ts` — wrappers GET (falta wrapper POST create/concluir)
- `apps/api/src/routes/web.ts` — rota packing shipping-labels
- `apps/web/app/(dashboard)/packing/[orderId]/page.tsx` — UI etiqueta

---

## Comandos úteis

```powershell
# Diagnóstico completo de um pedido (JSON em docs/)
cd apps/api
pnpm teste-pedido TINY-861203611

# Fluxo criar + etiquetas + concluir (precisa Tiny CONNECTED)
pnpm teste-fluxo-etiqueta --numero 214617
pnpm teste-fluxo-etiqueta TINY-861203611 --skip-concluir
```

---

## Critério de sucesso desta prova

1. Tiny `CONNECTED` no WMS.  
2. `POST /expedicao` retorna `id` (não 403).  
3. `GET .../etiquetas` retorna `urls` (ZPL/PDF).  
4. Arquivo `docs/tiny-fluxo-etiqueta-861203611-resultado.json` com cada etapa `ok` e retornos reais.  
5. (Opcional na prova) `POST .../concluir` = 200.
