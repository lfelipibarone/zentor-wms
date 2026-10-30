# Packing — mesa dual (visual)

**Data:** 2026-10-30  
**Escopo:** `apps/web` `/packing` + painel de conferência  
**Fora de escopo:** APIs, mobile, mudança de regras de qty/report

## Problema

Cards amarelos empilhados, Pedido×item confuso, painel apertado. Operador não enxerga a fila nem a conferência com clareza.

## Direção (aprovada)

**Mesa dual:** esquerda = fila densa com conferência **inline**; direita = só bipar cesta (avulso).

## Layout

| Zona | Conteúdo |
| --- | --- |
| Topo | Título curto + filtros (marketplace, zona, Todos/Ondas/Pedidos) numa barra |
| Esquerda | Ondas com cabeçalho + **tabela** Pedido \| SKU \| Cesta \| Local \| **input Qtd** \| **Conferir** + **Reportar** lado a lado. Qty menor que o esperado abre modal WRONG_QUANTITY. |
| Direita | Compacto: bipar cesta para pedido avulso. |

## Visual

- Fundo neutro do app; destaque operacional em teal (`#0d9488`) e âmbar só no badge “Onda”.
- Tipografia mono para pedido/SKU; qty tabular e grande no painel.
- Linha ativa na tabela com borda teal; painel com scroll interno (`min-h-0`).
- Mobile: estação em cima, fila embaixo.

## Comportamento (inalterado)

APIs sort/report, auto-etiquetas, poll silencioso, `?line=` via `history.replaceState`.
