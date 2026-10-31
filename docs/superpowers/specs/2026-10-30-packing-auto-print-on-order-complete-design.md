# Packing — auto-imprimir etiqueta ao concluir pedido

**Data:** 2026-10-30  
**Escopo:** onda + avulso em `/packing`  
**Fora de escopo:** impressão da onda inteira no início da conferência

## Problema

Conferir só marca o item. Ao fechar o pedido, nada finaliza nem imprime. Gerar/Imprimir no card da onda não cobre o momento em que o pacote está pronto.

## Comportamento

1. **Último item conferido do pedido** → pedido vai para `DISPATCHING` + imprime etiqueta daquele pedido (QZ / fallback download).
2. **Botão Imprimir no cabeçalho do pedido** (enquanto ainda está na lista) → gera etiqueta se faltar e imprime (retry manual).
3. **Avulso:** no último item, auto finalize + imprime; painel de etiqueta permanece para retry.
4. Gerar/Imprimir no card da onda ficam como lote/retry da onda.

## API

`POST .../waves/lines/:lineId/sort` passa a devolver `orderCompleted` + `orderId` quando todas as alocações do pedido estão sorted; nesse caso atualiza status para `DISPATCHING` e sincroniza `quantityPacked`.
