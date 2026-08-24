# Postman — Tiny Etiquetas

**Contexto completo (ago/2026):** [[../contexto-etiqueta-packing-tiny]]

## Buscar NF / expedição (MEU PUXADOR — 40A0133E85)

Collection dedicada (recomendada para o fluxo atual):

- Guia: **[README-busca-nf.md](./README-busca-nf.md)**
- `Tiny-Busca-NF-Expedicao.pronto.postman_collection.json` — 1 arquivo, token embutido
- `Tiny-Busca-NF-Expedicao.postman_collection.json` + `.local` / `.example`

Prova rápida:

1. `GET /expedicao/746538070` — NF **171579** em `expedicoes[]`
2. `GET /expedicao/746538070/etiquetas` — `{ urls: […zpl] }`

## Collection reunião suporte (CARBI / marketplaces)

### Importar

**Opção A — mais fácil:** `Tiny-Etiquetas-Expedicao.pronto.postman_collection.json`  
(token embutido; regenerar com `pnpm export-postman-tiny-etiquetas` em `apps/api`)

**Opção B:** collection + environment:

1. `Tiny-Etiquetas-Expedicao.postman_collection.json`
2. `Tiny-Etiquetas-Expedicao.local.postman_environment.json`
3. Ative o environment **LOCAL** no canto superior direito.

### Antes da reunião

```powershell
cd apps/api
pnpm export-postman-tiny-etiquetas
```

Se der 401: pasta **00 — OAuth** → **Refresh access_token**.

### Demo sugerida (collection clássica)

1. **00 — OAuth** → Refresh (se 401)
2. **01 — Info conta** → GET /info
3. **02 — Mercado Envios** — requests 1→6 (etiquetas podem falhar sem `urls[]`)
4. **03 — Amazon DBA** — repetir
5. **06 — Produtos** — filtros SKU / nome / GTIN
6. *(Opcional)* **05 — WMS** — via API packing

### Conta (environment clássico — pode ser CARBI)

| Campo | Valor típico no export |
|-------|-------|
| Tenant | Default |
| Empresa | Depende da connection exportada (CARBI ou MEU PUXADOR) |

Para MEU PUXADOR / Jadlog / NF 171579, use a collection **Busca NF**, não a demo Mercado/Amazon.

## Arquivos com tokens

`*.local.postman_environment.json` e `*.pronto.postman_collection.json` contêm secrets — **não commitar** (gitignore).
