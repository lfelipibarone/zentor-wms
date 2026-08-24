# Postman — Buscar NF em expedição

Collection focada no pedido **40A0133E85** (MEU PUXADOR).

**Contexto completo:** [[../contexto-etiqueta-packing-tiny]]

## Mais fácil (1 arquivo)

Importe **somente**:

`docs/postman/Tiny-Busca-NF-Expedicao.pronto.postman_collection.json`

- Token já embutido nas variáveis da collection
- Não precisa de environment
- Abra a pasta **01** → **1 GET pedido** → **Send**

Se der 401: rode **00 - OAuth → Refresh access_token**.

Abra o **Console** (View → Show Postman Console) ao rodar o detalhe do lote.

## Alternativa (collection + environment)

1. `Tiny-Busca-NF-Expedicao.postman_collection.json`
2. `Tiny-Busca-NF-Expedicao.local.postman_environment.json`
3. Selecione o environment no canto superior direito

## Ordem

| Pasta | Ação |
|-------|------|
| 00 | Refresh se 401 |
| 01 | Pedido + NF (`862886936` / `862886988`) |
| 02 | Listar lotes → detalhe (`<<< MATCH`) → etiquetas |
| 03 | Create (NF já expedida → 400 esperado) |
| 04 | Amostra ZPL lote `746537716` (outras NFs) |

### Prova direta da NF 171579

Defina `idAgrupamento` = **`746538070`** (não use `750138952` na listagem):

1. `GET /expedicao/746538070`
2. `GET /expedicao/746538070/etiquetas`

## Se “não carrega”

1. Use o arquivo **`.pronto`**, não o antigo
2. File → Import → Upload Files (não “Link”)
3. Confirme que aparece: **Zentor Tiny - Busca NF Expedicao (40A0133E85)**
4. Não rode Collection Runner inteiro de uma vez — clique request por request
