# Packing — conferência de onda com quantidade e dois reportes

**Data:** 2026-10-28  
**Escopo:** tela web `/packing/waves/[lineId]` (conferir item da onda por pedido)  
**Fora de escopo:** packing de pedido avulso (`/packing/[orderId]`), mobile Expo

## Problema

Na conferência de um item da onda, o packing só tem o botão “Confirmar X un.” — sem campo para digitar a quantidade encontrada. Também precisa de dois caminhos claros de reporte que devolvem o trabalho ao separador da onda.

## Objetivo

1. Digitar quantas unidades realmente conferiu (pode ser menor que o esperado).
2. Se a quantidade for menor → ao confirmar, abrir automaticamente o reporte de **quantidade errada** e devolver ao separador.
3. Poder **Reportar** à parte quando pegaram o **item errado** (ou danificado / faltando), sem depender do campo de quantidade.

## Comportamento por pedido (allocation)

Cada card de pedido na linha mostra:

| Elemento | Comportamento |
| --- | --- |
| Campo quantidade | Pré-preenchido com `remaining` (unidades ainda não conferidas). Aceita inteiro `1…remaining`. |
| Confirmar | Se `qty === remaining` → chama sort com essa quantidade (fluxo atual). Se `0 < qty < remaining` → **não** chama sort; abre modal de reporte com tipo `WRONG_QUANTITY`, descrição sugerindo “conferiu X de Y”. |
| Reportar | Abre o modal existente (`WaveLineIssueModal`) com tipos: item errado, quantidade errada, danificado, faltando. Usado quando o produto na cesta está errado (ou outros casos), independente do campo. |

Regras:

- Quantidade inválida (vazia, ≤ 0, > remaining, não numérica) → Confirmar desabilitado / mensagem curta.
- `qty === remaining` nunca abre reporte automático.
- Após reporte enviado com sucesso, atualizar a linha (allocation em `awaitingRepick` / separador avisado) — comportamento já existente da API `report-issue`.
- Botão Reportar permanece disponível mesmo com qty = remaining (item errado na cesta).

## Fluxo

```
[Conferir SKU da onda]
  → para cada pedido com remaining > 0:
       input qty (default = remaining)
       [Confirmar] ── qty == remaining ──► POST .../sort
                  └── qty < remaining  ──► modal Reportar (WRONG_QUANTITY)
                                            └── POST .../report-issue → separador
       [Reportar] ───────────────────────► modal Reportar (tipo escolhido)
                                            └── POST .../report-issue → separador
```

## Componentes

- **UI:** `apps/web/app/(dashboard)/packing/waves/[lineId]/page.tsx` — input de qty por allocation; Confirmar bifurca sort vs modal; Reportar abre modal.
- **Modal:** reutilizar `WaveLineIssueModal`; permitir `initialType` e descrição inicial quando vem do Confirmar com qty menor.
- **API:** sem mudança de contrato obrigatória — `sort` e `report-issue` já existem. Opcional: enviar na description do report a qty conferida vs esperada.

## Erros

- Falha no sort → mensagem na tela, qty permanece editável.
- Falha no report → modal mostra erro; usuário pode tentar de novo ou fechar.
- Linha ainda não pronta (`ready` falso na overview) → botão Conferir continua oculto (sem mudança).

## Testes manuais

1. qty = esperado → Confirmar marca allocation conferida.
2. qty < esperado → Confirmar abre modal quantidade errada; após OK, pedido volta ao separador.
3. Reportar com item errado (qty intacta) → modal; após OK, separador avisado.
4. qty inválida → Confirmar não dispara.
