# Etiquetas de expedição pelo Tiny — guia simples

Documento para entender **por que a etiqueta às vezes vem e às vezes não**, e **o que o WMS precisa fazer** para buscá-la corretamente.

Relacionado: [[handoff-desenvolvimento-jun-2026]], [[integracao-tiny-pedidos]], [[Tarefas]].

---

## Em uma frase

> **A etiqueta de envio não fica no pedido.** Ela só aparece na API Tiny depois que o pedido entra em um **agrupamento de expedição** — e, em marketplaces (Mercado Livre, Shopee), o Tiny ainda precisa conseguir buscar a etiqueta **lá no marketplace**.

---

## O que é cada coisa (sem confundir)

| Documento | O que é | Onde fica |
|-----------|---------|-----------|
| **DANFE / NF-e** | Nota fiscal eletrônica | `GET /notas/{id}/link` — link do PDF fiscal |
| **Etiqueta de transporte** | Adesivo que vai na caixa (ZPL/PDF) | `GET /expedicao/.../etiquetas` — URL na S3 do Tiny |

São coisas **diferentes**. Ter nota fiscal emitida **não significa** que a etiqueta de envio já está disponível na API.

---

## Analogia rápida

Pense no Tiny como um **centro de expedição**:

1. **Pedido** = encomenda anotada no sistema (pode estar “Pronto para envio”).
2. **Agrupamento de expedição** = a caixa/lote que o operador monta no balcão de expedição do ERP.
3. **Etiqueta** = o adesivo de transporte que só é impresso **depois** que a encomenda entrou nesse lote.

Se o pedido ainda está só na fila (“Pronto Envio”) mas **ninguém colocou no lote de expedição**, a API responde como se não existisse etiqueta — porque, de fato, o fluxo de expedição ainda não começou.

---

## Fluxo correto na API Tiny v3

**Não existe** `GET /pedidos/{id}/etiquetas`. O caminho é sempre este:

```
Pedido no Tiny (TINY-{id})
        │
        ▼
┌───────────────────────────────────┐
│  Pedido está em agrupamento de    │
│  expedição?  (GET /expedicao)     │
└───────────────────────────────────┘
        │
   NÃO  │  SIM
   ▼   │   ▼
 null  │  GET /expedicao/{agrupamento}/etiquetas
       │  GET /expedicao/{agrupamento}/expedicao/{expedicao}/etiquetas
       │        │
       │        ▼
       │  { "urls": ["https://s3.../etiqueta.zpl"] }
```

### Rotas envolvidas

| Passo | Rota | Para quê |
|-------|------|----------|
| 1 | `GET /pedidos/{id}` | Situação, NF, forma de envio |
| 2 | `GET /expedicao` | Listar agrupamentos (lotes de envio) |
| 3 | `GET /expedicao/{idAgrupamento}` | Ver se o pedido/NF está dentro (`expedicoes[]`) |
| 4 | `GET /expedicao/{idAgrupamento}/etiquetas` | URLs das etiquetas do lote |
| 5 | `GET /expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas` | URL da etiqueta de um pedido só |

Referência oficial: [Etiquetas de agrupamento](https://api-docs.erp.olist.com/api-reference/expedição/obter-etiquetas-de-um-agrupamento-de-expedição)

---

## Os 3 resultados possíveis nos testes

Quando rodamos o script de diagnóstico (`teste-etiquetas-lote`), cada pedido cai em **um destes cenários**:

### Cenário A — `expedicao: null` e `etiquetas: null`

**O que significa:** o pedido **não está** em nenhum agrupamento de expedição no Tiny.

**O que vimos:** nos 30 pedidos aleatórios do banco (jun/2026), **todos** caíram aqui. Eram Mercado Envios ou Shopee Envios, muitos em situação 7 (Pronto Envio), mas **fora da expedição**.

**O que fazer:** agrupar o pedido na expedição no ERP Tiny (manual ou via API `POST /expedicao`).

---

### Cenário B — `expedicao` encontrada, mas `urls` vazia + erro do marketplace

**O que significa:** o pedido **está** no lote de expedição, mas o Tiny **não conseguiu** pegar a etiqueta no Mercado Livre / Shopee / Amazon.

**Exemplo real:** `TINY-860301754`
- Agrupamento `746503742`, expedição `749882106` ✅
- API retorna erro: *"Não foi possível obter as etiquetas em sua plataforma e-commerce"*

**Causas comuns:**
- Shipment do ML em status inválido (ex.: já coletado)
- Etiqueta ainda não gerada no marketplace
- Integração marketplace desatualizada

**O que fazer:** verificar no Mercado Livre / Shopee se a etiqueta existe; corrigir status do envio; em último caso, imprimir pelo painel do marketplace.

---

### Cenário C — `urls` com link ZPL/PDF ✅

**O que significa:** sucesso. URL típica:

```
https://s3.amazonaws.com/tiny-tmp-us/erp/.../etiquetas/arquivo.zpl
```

**Quando acontece:** pedidos em expedição com **Correios**, **transportadora própria** ou marketplace com etiqueta válida e integração OK.

---

## Por forma de envio

| Forma de envio | Precisa agrupar na expedição Tiny? | Etiqueta via API Tiny? |
|----------------|-----------------------------------|------------------------|
| Correios | Sim | ✅ Costuma funcionar |
| Transportadora própria | Sim | ✅ Costuma funcionar |
| Mercado Envios | Nem sempre (pedido pode ficar só “Pronto Envio”) | ⚠️ Só se agrupado **e** ML liberar a URL |
| Shopee Envios | Idem | ⚠️ Idem |
| Amazon DBA | Sim | ⚠️ Testes retornaram erro “URL não encontrada na Amazon” |

**Conclusão prática:** pedidos de marketplace podem aparecer prontos no Tiny, mas a etiqueta **morar no marketplace** até entrarem na expedição — e mesmo assim o Tiny pode falhar ao buscar.

---

## O que o WMS já faz hoje

Serviço: `apps/api/src/services/tiny-shipping-labels.ts`

```
Order WMS (erpOrderId = TINY-{id})
    → busca pedido no Tiny
    → procura em agrupamentos de expedição
    → chama rotas de etiqueta
    → salva URL em Order.shippingLabel
```

Rota no packing:

```
POST /api/packing/orders/{id}/shipping-labels
POST /api/packing/orders/{id}/shipping-labels?refresh=1
```

**Status retornados pelo serviço:**

| Status | Significado para o operador |
|--------|----------------------------|
| `OK` | Etiqueta obtida (URL salva) |
| `NOT_IN_EXPEDICAO` | Pedido não está no lote de expedição do Tiny |
| `MARKETPLACE_ERROR` | Está na expedição, mas ML/Shopee/Amazon bloqueou |
| `NO_URLS` | Está na expedição, API não devolveu URL |
| `NOT_TINY_ORDER` | Pedido não é `TINY-{id}` |

---

## Como colocar o pedido na expedição (para a etiqueta existir)

### Opção 1 — Manual (operacional)

1. Abrir expedição no ERP Tiny (tela web).
2. Criar ou abrir um agrupamento.
3. Incluir o pedido ou a nota fiscal.
4. Gerar/imprimir etiqueta no ERP.
5. No WMS, chamar busca de etiqueta (ou `?refresh=1`).

### Opção 2 — Via API (ainda não integrado no WMS)

```http
POST /expedicao
{ "idsPedidos": [860301754] }
ou
{ "idsNotasFiscais": [860301759] }

→ retorna { "id": idAgrupamento }

GET /expedicao/{idAgrupamento}/etiquetas
→ { "urls": [...] }
```

Doc: [Criar agrupamento de expedição](https://api-docs.erp.olist.com/api-reference/expedição/criar-agrupamento-de-expedição)

**Próximo passo de desenvolvimento:** automatizar esse `POST /expedicao` quando o packing detectar `NOT_IN_EXPEDICAO`.

---

## Como testar no projeto

Pré-requisito: OAuth conectado em `/integracoes/tiny`.

```powershell
cd apps/api

# Por expedição (recomendado): listagem → detalhe → etiquetas
pnpm teste-etiquetas-expedicao --limite 30

# Por pedido (busca pedido dentro da expedição)
pnpm teste-etiquetas TINY-860301754
pnpm teste-etiquetas-lote --fonte-tiny --limite 40 --excluir-testados
```

**Arquivos gerados:**

| Arquivo | Conteúdo |
|---------|----------|
| `docs/tiny-etiquetas-expedicao.json` | Varredura por agrupamento de expedição |
| `docs/tiny-etiquetas-{id}.json` | Detalhe de um pedido |
| `docs/tiny-etiquetas-lote.json` | Resultado do lote por pedido |

**Como ler o JSON:**

```json
{
  "expedicao": null,      // ← pedido NÃO está no lote de expedição
  "etiquetas": null,      // ← rotas de etiqueta nem foram chamadas
  "temEtiqueta": false
}
```

vs.

```json
{
  "expedicao": { "idAgrupamento": 746503742, "idExpedicao": 749882106 },
  "etiquetas": {
    "urls": [],
    "marketplaceError": "Não foi possível obter as etiquetas..."
  },
  "temEtiqueta": false
}
```

O segundo caso é **progresso**: achou a expedição, mas o marketplace não liberou a URL.

---

## Checklist para validar um pedido

Use esta ordem ao investigar um pedido específico:

- [ ] O `erpOrderId` no WMS é `TINY-{id}`?
- [ ] O pedido está **faturado** e com NF (`idNotaFiscal` > 0)?
- [ ] Qual a **forma de envio**? (Mercado Envios ≠ Correios)
- [ ] O pedido aparece em `GET /expedicao/{id}/expedicoes`? (rodar `pnpm teste-etiquetas`)
- [ ] Se sim, `GET .../etiquetas` retorna `urls[]` ou `erro` do marketplace?
- [ ] A URL é `.zpl`/`.pdf` de transporte (não link de DANFE)?

---

## Resumo visual

```
                    PEDIDO TINY
                         │
            ┌────────────┴────────────┐
            │                         │
     Marketplace               Correios / Transp.
   (ML, Shopee, Amazon)         própria
            │                         │
            ▼                         ▼
   Pode ficar "Pronto Envio"    Normalmente precisa
   SEM entrar na expedição      agrupar na expedição
            │                         │
            └────────────┬────────────┘
                         ▼
              AGRUPAMENTO DE EXPEDIÇÃO
              (obrigatório para a API)
                         │
                         ▼
              GET /expedicao/.../etiquetas
                         │
            ┌────────────┴────────────┐
            │                         │
     Marketplace OK              Marketplace erro
            │                         │
            ▼                         ▼
      urls[] com ZPL/PDF      mensagem de erro ML/Shopee
```

---

---

## Cruzamento de dados (pedido ↔ expedição ↔ etiqueta)

Artefato gerado automaticamente:

```powershell
pnpm teste-etiquetas-expedicao --limite 95
pnpm cruzar-etiquetas
```

Saída: `docs/tiny-etiquetas-cruzamento.json` — índice `indicePorPedido` + estatísticas + recomendação WMS.

### Resultado do cruzamento (jun/2026)

| Conjunto | Quantidade | Observação |
|----------|------------|------------|
| Pedidos **na expedição** (scan direto) | 94 | Amazon DBA + Mercado Envios |
| Pedidos **testados por pedido** | 102 | 100 do lote + 2 individuais |
| **Cruzados** (nos dois fluxos) | **1** | `TINY-860301754` |
| Só na expedição | 93 | Busca por pedido **não achou** |
| Só no teste por pedido | 101 | **Fora** da expedição na amostra |
| Com URL de etiqueta | **0** | Todos erro marketplace |

### Melhor fluxo para o WMS

```
┌─────────────────────────────────────────────────────────────┐
│  FASE 1 — Índice (expedição-first, 1x por sync/packing)    │
│  GET /expedicao (paginar) → GET /expedicao/{id}             │
│  Montar mapa: pedidoId → { idAgrupamento, idExpedicao }     │
│  Chave: expedicoes[].venda.id (fallback: notaFiscal.id)    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  FASE 2 — Pedido WMS (TINY-{id})                            │
│  Lookup no índice → se ausente: NOT_IN_EXPEDICAO            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  FASE 3 — Etiqueta                                          │
│  1º GET .../expedicao/{idExp}/etiquetas  (individual)       │
│  2º GET .../expedicao/{idAgr}/etiquetas  (fallback lote)    │
│  urls[] → salvar em Order.shippingLabel                     │
│  erro marketplace → MARKETPLACE_ERROR na UI                 │
└─────────────────────────────────────────────────────────────┘
```

**Não usar** busca pedido-a-pedido varrendo `/expedicao` — nos testes varreu 20–22 agrupamentos com filtro de forma de envio e perdeu **93 pedidos** que estão na expedição com Amazon DBA.

### Único caso cruzado: `TINY-860301754`

| Campo | Valor |
|-------|-------|
| Agrupamento | `746503742` (Mercado Envios) |
| Expedição | `749882106` |
| Etiqueta | ❌ erro ML (`S47281733718`) |
| Diagnóstico | **Consistente** nos dois fluxos |

### Dois mundos distintos na conta

1. **Pedidos marketplace (ML/Shopee) “Pronto Envio”** — 101 testados, **fora** da expedição Tiny → etiqueta no marketplace, não na API.
2. **Pedidos Amazon DBA agrupados** — 93 na expedição, etiqueta bloqueada pela Amazon → `Url das etiquetas não encontrada na Amazon`.

---

## Perguntas frequentes

**Por que 30 pedidos aleatórios vieram todos sem etiqueta?**  
Porque nenhum estava agrupado na expedição Tiny. O script parou no passo 2 — nem chegou a pedir etiqueta.

**O WMS está quebrado?**  
Não necessariamente. O código busca corretamente **quando o pedido está na expedição**. O bloqueio é de **processo operacional** (agrupamento) e de **marketplace** (ML/Shopee).

**Dá para pegar etiqueta só com o ID do pedido?**  
Não na API v3. Sempre passa pelo módulo de expedição.

**E se agruparmos via API automaticamente?**  
É o próximo passo técnico recomendado. Pode destravar Mercado Envios em alguns casos, mas não garante URL se o ML recusar.

---

## Referências

- [Listar agrupamentos de expedição](https://api-docs.erp.olist.com/api-reference/expedição/listar-agrupamentos-de-expedição)
- [Obter etiquetas de agrupamento](https://api-docs.erp.olist.com/api-reference/expedição/obter-etiquetas-de-um-agrupamento-de-expedição)
- [Criar agrupamento de expedição](https://api-docs.erp.olist.com/api-reference/expedição/criar-agrupamento-de-expedição)
- Artefatos de teste: `docs/tiny-etiquetas-lote.json`, `docs/tiny-etiquetas-860301754.json`, `docs/tiny-teste-rotas.json`
