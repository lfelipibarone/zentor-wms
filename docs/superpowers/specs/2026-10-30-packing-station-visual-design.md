# Packing — mesa dual (visual)

**Data:** 2026-10-30  
**Escopo:** `apps/web` `/packing` + painel de conferência  
**Fora de escopo:** APIs, mobile, mudança de regras de qty/report

## Problema

Cards amarelos empilhados, Pedido×item confuso, painel apertado. Operador não enxerga a fila nem a conferência com clareza.

## Direção (aprovada)

**Mesa dual:** esquerda = fila densa; direita = estação fixa (cesta ou conferência).

## Layout

| Zona | Conteúdo |
| --- | --- |
| Topo | Título curto + filtros (marketplace, zona, Todos/Ondas/Pedidos) numa barra |
| Esquerda (~58%) | Ondas como bloco com **cabeçalho** (nome, progresso, etiquetas k/n, Gerar, Imprimir) + **tabela** Pedido \| SKU \| Cesta \| Local \| Qty \| ação Conferir. Pedidos avulsos em lista simples. Sem cards amarelos por linha. |
| Direita (~42%, sticky) | Idle: bipar cesta grande. Conferência: foto + SKU + local; por pedido qty grande + Confirmar / Reportar. |

## Visual

- Fundo neutro do app; destaque operacional em teal (`#0d9488`) e âmbar só no badge “Onda”.
- Tipografia mono para pedido/SKU; qty tabular e grande no painel.
- Linha ativa na tabela com borda teal; painel com scroll interno (`min-h-0`).
- Mobile: estação em cima, fila embaixo.

## Comportamento (inalterado)

APIs sort/report, auto-etiquetas, poll silencioso, `?line=` via `history.replaceState`.
