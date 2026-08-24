# Contexto: etiqueta Tiny — pedido 214617 / NF 005554

> **Nota 2026-08-18:** caso **CARBI / Correios**. Para o fluxo atual **MEU PUXADOR / Jadlog / packing**, use o documento mestre [[contexto-etiqueta-packing-tiny]].

**Atualizado em:** 2026-08-12  
**Status:** OAuth **CONNECTED** ✅ · API de Expedição (POST) liberada ✅ · **etiqueta de transporte ainda NÃO gerada** — bloqueio está **no Tiny ERP** (estado do pedido/NF + forma de frete), não no WMS/OAuth.

Relacionado: [[contexto-etiqueta-packing-tiny]], [[etiquetas-expedicao-tiny]], [[tiny-fluxo-etiqueta-214617]], [[tiny-formas-envio]], [[superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design]], [[integracao-tiny-oauth]].

---

## Objetivo

1. Provar o fluxo completo na Tiny até obter URL de etiqueta.
2. Documentar cada etapa e retorno (JSON).
3. Depois integrar nas rotas WMS (botão “Buscar / imprimir etiqueta” no packing).

---

## Pedido alvo (mapeamento correto)

| Campo | Valor |
|-------|--------|
| Número na tela Tiny | **214617** |
| NF na tela | **005554** |
| `erpOrderId` no WMS | **`TINY-861203611`** |
| `idPedido` API | `861203611` |
| `idNotaFiscal` API | `861203622` |
| Forma envio | **Correios** (`743997871`) |
| Cliente | Rafael Garcia |
| Situação pedido | Faturada (`1`) |
| Situação NF | `"6"` |

### Pedido confuso (NÃO usar neste fluxo)

| Campo | Valor |
|-------|--------|
| `erpOrderId` | `TINY-860803335` |
| Número na tela | **211641** (não 214617) |
| NF | **002707** |
| Marcadores | “1ª venda”, “Devolvido” |

Ambos existem no WMS em `PAUSED_ISSUE`.

---

## Fluxo correto da API (confirmado na doc Olist + testes reais)

**Não existe** `GET /pedidos/{id}/etiquetas` nem `GET /notas/{id}/etiquetas` (404).

Para **Correios**, a ordem que funciona na prática é:

| # | Etapa | Rota | Retorno esperado |
|---|--------|------|------------------|
| 1 | Criar agrupamento | `POST /expedicao` body `{ "idsPedidos": [...] }` e/ou `{ "idsNotasFiscais": [...] }` | `{ "id": idAgrupamento }` |
| 2 | Conferir vínculo | `GET /expedicao/{idAgrupamento}` | `expedicoes[]` **não vazio** (tem o pedido/NF) |
| 3 | **Concluir** | `POST /expedicao/{idAgrupamento}/concluir` | `200` |
| 4 | **Etiquetas** | `GET /expedicao/{idAgrupamento}/etiquetas` | `{ "urls": ["https://...zpl"] }` |

Opcional: `GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas` (etiqueta individual).

### Erros reais que validam essa ordem

| Chamada fora de ordem / estado ruim | Resposta Tiny |
|-------------------------------------|---------------|
| `GET .../etiquetas` **antes** de concluir | `400` — *"Agrupamento ainda não foi concluído"* |
| `POST .../concluir` com `expedicoes: []` | `400` — *"Nenhuma expedição vinculada a este agrupamento"* |
| `POST /expedicao` com NF já expedida | `400` — *"Nota fiscal com id '861203622' já foi expedida"* |

Docs oficiais:

- [Criar agrupamento](https://api-docs.erp.olist.com/api-reference/expedição/criar-agrupamento-de-expedição)
- [Concluir agrupamento](https://api-docs.erp.olist.com/api-reference/expedição/concluir-um-agrupamento-de-expedição)
- [Obter etiquetas do agrupamento](https://api-docs.erp.olist.com/api-reference/expedição/obter-etiquetas-de-um-agrupamento-de-expedição)

---

## Por que a etiqueta do 214617 NÃO gera (bloqueio no Tiny)

O WMS e o OAuth estão ok. A etiqueta **não sai** por problemas **na conta Tiny**:

### 1. NF já marcada como expedida

`POST /expedicao` com `{ "idsNotasFiscais": [861203622] }` →

```json
{
  "mensagem": "Ocorreram erros de validação",
  "detalhes": [{
    "campo": "idsNotasFiscais[0]",
    "mensagem": "Nota fiscal com id '861203622' já foi expedida"
  }]
}
```

Porém a NF **não aparece** em `GET /expedicao` (busca em 400 agrupamentos + janela 06–13/08) — estado inconsistente no ERP (marcada expedida, sem agrupamento listável com objetos).

### 2. `POST` com `idsPedidos` cria agrupamento vazio

`POST /expedicao` `{ "idsPedidos": [861203611] }` retorna `id` (ex.: `746506387`…`746506390`), mas:

```json
{
  "formaEnvio": { "id": 743997871, "nome": "Correios" },
  "expedicoes": []
}
```

`quantidadeObjetos: 0` → não dá para concluir → não dá para pegar etiqueta.

### 3. Forma de envio Correios sem formas de frete

`GET /formas-envio` + `GET /formas-envio/743997871`:

| Forma | ID | `formasFrete` |
|-------|-----|---------------|
| **Correios** (usada no pedido) | `743997871` | **`[]` vazia** |
| Correios Gateway | `765781250` | 6 (PAC, SEDEX, …) |
| Mercado Envios | `744061814` | 15 |

Sem forma de frete (PAC/SEDEX) na forma **Correios** do pedido, o Tiny tende a montar expedição sem objetos úteis para etiqueta.

### 4. O que existe vs o que falta

| Documento | Status |
|-----------|--------|
| DANFE / NF-e | Existe (`GET /notas/{id}/link`) — **não é** etiqueta de transporte |
| Etiqueta Correios (ZPL/PDF) | **Não gerada** — falta agrupamento válido + concluir + GET etiquetas |

---

## O que fazer no Tiny ERP (desbloqueio)

1. Abrir NF **005554** / pedido **214617** e **desfazer** a marcação de expedida (ou usar **outro pedido teste** ainda não expedido).
2. Em **Configurações → Formas de envio → Correios** (`743997871`): cadastrar/ativar **formas de frete** (PAC/SEDEX), **ou** usar no pedido de teste uma forma que já tem frete (ex.: **Correios Gateway** `765781250`).
3. Depois, na API (script ou packing):
   1. `POST /expedicao` → conferir `expedicoes[]` preenchido  
   2. `POST /expedicao/{id}/concluir`  
   3. `GET /expedicao/{id}/etiquetas` → `urls`

---

## OAuth / ambiente (já resolvido)

| Item | Estado |
|------|--------|
| `tiny_connections` | 1 conexão `CONNECTED` (reconectada 2026-08-12) |
| Empresa | CARBI & MS DISTRIBUIDORA… |
| `GET /pedidos`, `GET /notas` | OK |
| `POST /expedicao` (permissão escrita) | OK (não é mais 403) |
| Banco local scripts | `DATABASE_URL` remoto `177.7.39.127` (Docker local costuma estar parado) |

Conexões antigas em `ERROR` foram **apagadas** e a conta foi recriada do zero.

---

## Evidências / arquivos

| Arquivo | Conteúdo |
|---------|----------|
| `docs/tiny-pedido-861203611.json` | Pedido + NF 005554 completos |
| `docs/tiny-formas-envio.json` | `GET /formas-envio` + detalhes (Correios sem frete) |
| `docs/tiny-fluxo-etiqueta-861203611-resultado.json` | Create ok, detalhe vazio, etiquetas/concluir 400 |
| `docs/tiny-coleta-etiqueta-214617.json` | Busca em 400 agrupamentos — sem match |
| `docs/tiny-coleta-etiqueta-214617-tentativa2.json` | WMS `NOT_IN_EXPEDICAO` + probes 404 |
| `docs/tiny-diagnostico-nf-ja-expedida.json` | Erro “já foi expedida” |
| `docs/tiny-diagnostico-expedicao-vazia.json` | Agrupamentos com `expedicoes: []` |
| `apps/api/scripts/teste-fluxo-etiqueta-completo.ts` | Script create → (etiquetas) → concluir |

---

## Integração WMS (próximo passo de produto)

Hoje `POST /api/packing/orders/:id/shipping-labels` só **consulta**. Se fora de expedição → `NOT_IN_EXPEDICAO`.

Quando o Tiny estiver ok, o botão de etiqueta no packing deve:

1. `POST /expedicao` (se ainda não agrupado)  
2. Garantir `expedicoes[]` com o pedido  
3. `POST /expedicao/{id}/concluir` (necessário p/ Correios antes das URLs, conforme testes)  
4. `GET .../etiquetas` → salvar `Order.shippingLabel`

Arquivos-chave: `tiny-shipping-labels.ts`, `tiny-expedicao-labels.ts`, rota packing em `web.ts`, UI `packing/[orderId]/page.tsx`.

> Nota: o design antigo ([[superpowers/specs/2026-08-05-tiny-etiqueta-geracao-design]]) colocava **concluir** fora de escopo. Os testes com Correios mostram que **sem concluir a API não devolve etiqueta** (`Agrupamento ainda não foi concluído`). Ajustar o design/plano na implementação.

---

## Comandos úteis

```powershell
cd apps/api
pnpm teste-pedido TINY-861203611
pnpm teste-fluxo-etiqueta --numero 214617
pnpm teste-fluxo-etiqueta TINY-861203611 --skip-concluir
```

---

## Critério de sucesso

1. ~~Tiny `CONNECTED`~~ ✅  
2. ~~`POST /expedicao` sem 403~~ ✅  
3. No Tiny: NF **não** “já expedida” + Correios com **forma de frete** (ou outro canal)  
4. `POST /expedicao` → `expedicoes[]` com o pedido  
5. `POST .../concluir` = 200  
6. `GET .../etiquetas` → `urls` preenchidas  
7. JSON de resultado com cada etapa `ok`
