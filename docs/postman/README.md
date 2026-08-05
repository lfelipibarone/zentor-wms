# Postman — Tiny Etiquetas (reunião suporte)

## Importar (recomendado — sem 401)

**Opção A — mais fácil:** importe só este arquivo (token já embutido):

- `Tiny-Etiquetas-Expedicao.pronto.postman_collection.json`

Não precisa de environment. Abra **01 — Info conta** → **GET /info** → Send.

**Opção B:** collection + environment:

1. `Tiny-Etiquetas-Expedicao.postman_collection.json`
2. `Tiny-Etiquetas-Expedicao.local.postman_environment.json`
3. Ative o environment **LOCAL** no canto superior direito.

## Antes da reunião

```powershell
cd apps/api
pnpm export-postman-tiny-etiquetas
```

Isso renova o access token se estiver perto de expirar e regrava o environment.

Se der 401 durante a call: pasta **00 — OAuth** → **Refresh access_token**.

## Demo sugerida

1. **00 — OAuth** → Refresh (se 401)
2. **01 — Info conta** → GET /info (CNPJ: ver `companyCnpj` no environment)
3. **02 — Mercado Envios** — requests 1→6 em ordem
4. Mostrar que 1–4 OK e 5–6 retornam erro sem `urls[]`
5. **03 — Amazon DBA** — repetir
6. **06 — Produtos** — lista, filtro por SKU (`codigo`), nome, GTIN e detalhe por id
7. *(Opcional)* **05 — WMS** — mesmo fluxo via nossa API

## Conta

| Campo | Valor |
|-------|-------|
| Tenant | Default |
| Empresa | CARBI & MS DISTRIBUIDORA DE ARTIGOS PARA CASA LTDA |
| CNPJ | 37.919.979/0001-06 |
| Client ID | tiny-api-e6759dea860deb3c29929001bc15128ed11d4025-1781104682 |

## Arquivos com tokens

`*.local.postman_environment.json` contém secrets — **não commitar** (gitignore).

Gerado em: 2026-07-14T12:40:44.522Z
Tenant: Default
Token expira: 2026-07-14T15:29:34.856Z
