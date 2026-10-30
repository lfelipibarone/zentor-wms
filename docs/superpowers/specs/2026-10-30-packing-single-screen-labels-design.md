# Packing — tela única + etiquetas automáticas da onda

**Data:** 2026-10-30  
**Escopo:** `apps/web` packing hub + `apps/api` geração de etiquetas no fim do picking  
**Fora de escopo:** redesign visual geral do dashboard; mobile packing

## Problema

O packing tem várias subtelas (fila, onda, conferir linha, pedido, etiquetas em lote). O operador perde tempo navegando. Etiquetas são manuais e, em onda com N pedidos, precisam sair todas ao fim da coleta.

## Objetivos

1. **Uma tela:** `/packing` com fila à esquerda e painel à direita (cesta ou conferência).
2. **Conferir in-place:** qty + confirmar/reportar no painel (sem mudar URL).
3. **Etiquetas na mesma tela:** status, gerar/retry, imprimir lote no card da onda.
4. **Auto-etiqueta:** ao concluir o picking da onda, gerar etiqueta de **todos** os pedidos da onda (ex.: 10/10). Pedido avulso: ao finalizar separação.
5. **Falha:** mostrar erro; retry automático (até 3x) + botão manual.

## UI — `/packing`

| Zona | Conteúdo |
| --- | --- |
| Esquerda | Filtros + cards onda/pedido. Onda: Pedido × SKU × cesta; `Etiquetas k/n`; Conferir; Imprimir. |
| Direita | Default: bipar cesta. Ao Conferir: painel qty/confirmar/reportar + etiqueta do pedido. |

Rotas antigas redirecionam para `/packing` (com query opcional `?wave=&line=`).

## Backend — auto-etiqueta

**Gatilho onda:** quando a onda fica pronta para packing (todas as linhas `PICKED`/`SORTED` / `wavePickFinished`), enfileirar geração para **cada pedido** da onda.

**Gatilho avulso:** em `complete-picking` do pedido.

**Por pedido:** chamar o mesmo serviço Tiny de `/shipping-labels`. Persistir `shippingLabel` ou erro (`labelError` / campo existente). Retry: 3 tentativas com backoff curto; falhas restantes ficam visíveis na fila.

**Idempotente:** se já tem etiqueta válida, não regenera.

## Conferência no painel

Reaproveita APIs `sort` / `report-issue` da linha de onda e confirm-item do pedido avulso. Comportamento qty menor → report quantidade (spec 2026-10-28).

## Testes manuais

1. Onda com 3 pedidos: ao fim do pick mobile, 3 etiquetas geradas (ou erros com retry).
2. `/packing`: Conferir abre painel; confirmar qty fecha e atualiza fila.
3. Card mostra `Etiquetas 3/3`; Imprimir envia ZPL.
4. Link antigo `/packing/ondas/:id` cai em `/packing`.
