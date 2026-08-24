# Status etiqueta Tiny — 2026-08-17

> **Atualização 2026-08-18:** a NF **171579** (`40A0133E85`) **foi encontrada** no agrupamento **`746538070`** com ZPL OK.  
> Documento mestre: [[contexto-etiqueta-packing-tiny]].

Conta: **MEU PUXADOR** (`cmst909h50epkl0016ytukm52`) · OAuth **CONNECTED**

## O que já funciona (prova)

| Passo | Resultado |
|-------|-----------|
| `GET /expedicao/746538070/etiquetas` | `200` + ZPL da NF **171579** |
| Arquivo | `docs/tiny-etiqueta-171579.zpl` |
| Amostra antiga | `GET /expedicao/746537716/etiquetas` → `docs/tiny-etiqueta-sample.zpl` |
| Forma | Jadlog via Melhor Envio Vnda (`851418498`) |

## Fluxo correto (validado)

1. `POST /expedicao` com **`idsNotasFiscais`** (preferencial) → `{ id }`
2. `GET /expedicao/{id}` → `expedicoes[]` **não vazio**
3. `POST /expedicao/{id}/concluir` (se GET etiquetas exigir)
4. `GET /expedicao/{id}/etiquetas` → `{ urls: [zpl...] }`

Ou, se já expedido: achar o agrupamento (datas até **hoje**) → GET etiquetas.

## Lições desta rodada

1. Busca só em `dataFinal=2026-08-14` **não achava** o lote (ele é **17/08**).
2. `idsPedidos` com NF já expedida → lote **vazio** — não usar como caminho feliz.
3. Listagem não traz NFs; `quantidadeObjetos` na lista mente.
4. WMS packing ainda só GET — falta create/conclude + busca ampliada.

## Próximo passo

Ver checklist em [[contexto-etiqueta-packing-tiny]] §11.
