# Mapa físico do galpão + Route Engine

## Objetivo

Representar o barracão em 2D (grid) e usar essa planta como fonte única de distância para separação, putaway, reabastecimento, pick face, packing e ondas. Implantação incremental: sem planta (ou com o motor em `LEGACY`) o comportamento antigo é mantido.

## Vocabulário do cadastro

- **Estante** (`WarehouseEstante`) = a gôndola física. O endereço do usuário é só Estante-Coluna-Linha (+ Face): `A-6-3` = estante A, coluna 6, linha 3. Setor e corredor continuam no banco, preenchidos com `—` (ou herdados quando já existe uma estante com o mesmo código no barracão, layouts antigos). Em dados antigos com estante `—`, o código da gôndola é o do corredor (`gondolaCode`).
- **Posição × SKU**: a posição é cadastrada vazia (endereço + etiqueta + tipo); o SKU, capacidade e mínimo são associados depois, na edição da posição.
- **Proximidade manual** (referências corredor/estante/linha por posição) foi removida das telas e não influencia mais a rota antiga; a distância vem só do endereço (ou da planta, no motor físico).
- **Coluna** = posição ao longo da gôndola (muda o ponto de acesso no chão).
- **Linha** = altura/prateleira (não afeta caminhada).
- **Lado LD / LE** (enum `LocationFace` A / B): os dois lados da estante, cada um acessado por um corredor de circulação diferente. A numeração das colunas é contínua: LD 1–7, LE 8–14. LD e LE podem ter quantidades diferentes.
- **Gerador** (`POST /api/warehouse/estantes/generate`, tela `/gestao-barracao/lote`): estante + LD (colunas, linhas) + LE opcional (colunas, linhas); as colunas do LE começam em `colunasLD + 1`. Etiqueta provisória `ESTANTE-LADO-COLUNA-LINHA` (`A-LD-6-3`, `A-LE-8-3`); posições já existentes são puladas. A importação depois troca a etiqueta: em upsert, código de barras novo em endereço já ocupado atualiza a posição daquele endereço. Planilha aceita `lado` = LD/LE (ou A/B).
- **Planilha de inventário** (`services/inventory-layout.ts`, `POST /api/warehouse/inventory-layout/preview|apply`, tela `/gestao-barracao/inventario`): lê a coluna "Localização" (aba "Localização" ou a mais preenchida). Formatos: `B1-D-12-7` (barracão, estante D, coluna, linha), `B1-O-E7-2-3` (estante `O-E7` = rua O, estante 7), `B1-A-E2-3` / `B1-E-5` (só coluna, linha 1). O sufixo `/Z509`, `/Z603-604` é pulmão e ainda não é importado. Cada estante ganha a grade completa (maior coluna × maior linha vistas, tudo no LD; editável na prévia) pelo gerador com etiqueta = endereço `BARRACAO-ESTANTE-COLUNA-LINHA`; posições existentes têm a etiqueta trocada para o endereço se estiver livre. Depois associa o SKU de cada endereço (só produtos já cadastrados; endereço com vários SKUs fica com o primeiro; respeita o limite de giro por SKU). Reimportar é seguro.
- **Gôndola frente e verso** (`WarehouseFloorElement.estanteIdB`): a gôndola pode ter uma estante no LD (`estanteId`) e outra no LE (`estanteIdB`), ex.: rua C/D com D no LD e C no LE, de costas e sem corredor entre elas. Sem `estanteIdB`, a mesma estante atende os dois lados. A posição só é roteada se a face cadastrada bater com o lado da gôndola; a validação avisa (`FACE_NOT_MAPPED`) e o painel oferece "Passar todas as posições da X para o LD/LE" (`PATCH /api/warehouse/estantes/:id/face`). "Dados da estante" no painel ajusta colunas/linhas/nome (`PATCH /api/warehouse/estantes/:id/structure`); posições que saem precisam estar vazias e sem histórico.
- **Estante em partes** (`colunaMinA/colunaMaxA/colunaMinB/colunaMaxB` na gôndola): a mesma rua pode ocupar várias gôndolas com corredor entre elas (ex.: C parte 1 = colunas 1–7, parte 2 = 8–14). Cada lado da gôndola atende só as colunas numéricas dentro da faixa (nulo = sem limite). O painel tem "Colunas do LD/LE de/até" e "Dividir em 2 partes" (parte 1 = primeiras N colunas como aparecem no desenho, corredor em células). A validação acusa coluna em duas gôndolas (`ESTANTE_DUPLICATED`) e colunas fora de todas (`FACE_NOT_MAPPED`).

## Modelo

- `LocationFace` enum (`A` = LD, `B` = LE). `WarehouseLinha.face` (unique `tenantId, colunaId, code, face`) e espelho em `Location.face`.
- `Location.corridor` = código da gôndola; `Location.row` = `COLUNA-LINHA` (ex.: `8-3`). A rota antiga e o motor físico usam só a coluna (`colunaFromRow`). Posições antigas com `row` sem hífen são tratadas como se o valor inteiro fosse a coluna até serem reeditadas/reimportadas.
- Pontos de acesso: para cada lado habilitado, as colunas que têm posições naquele lado são distribuídas ao longo do comprimento da gôndola (`GondolaSlots` = estante → `{ A: colunas LD, B: colunas LE }`). Novas gôndolas nascem com `colunaReversedB = true`, porque o LE continua a numeração dando a volta na ponta (coluna 8 em frente à 7).
- `FloorPlan` (1 por barracão): `widthCells`, `heightCells`, `cellSizeCm` (padrão 50), `version` (lock otimista).
- `FloorElement`: `GONDOLA | OBSTACLE | START_POINT | PACKING_POINT | DOCK | RECEIVING_AREA`. `RECEIVING_AREA` (única por planta, bloqueia passagem) é onde a carga conferida na doca fica aguardando; a rota da armazenagem no pulmão parte da primeira célula livre na borda dela (sem ela, da doca; sem doca, do início). No painel, obstáculo/recebimento/doca trocam de tipo entre si.
- Campos do `FloorElement`: retângulo em células, `rotation` (0/90/180/270), e para gôndola `estanteId`, `faceAEnabled`, `faceBEnabled`, `colunaReversedA`, `colunaReversedB` (sentido das colunas em cada lado: crescente ou decrescente no desenho).
- Migração: `20261001120000_warehouse_floor_plan`.

## Geometria

- Gôndola com rotação 0: colunas ao longo de X; LD (face A) no lado de cima (y-1), LE (face B) no de baixo. Rotações giram no sentido horário (90: LD à direita; 180: LD embaixo e colunas invertidas; 270: LD à esquerda).
- Cada linha ocupa um trecho do comprimento; o **ponto de acesso** é a célula livre ao lado da face, no centro do trecho.
- Gôndolas e obstáculos bloqueiam; início, packing e doca não.

## Route Engine (`services/route-engine/`)

- Interface `RouteEngine`: `kind`, `distance(a, b)`, `sortByRoute(locs, start?)`, `locate(loc)`.
- `LegacyRouteEngine`: Manhattan (gôndola, linha) + serpentina de `location-route.ts`; `Location.corridor` guarda o código da gôndola.
- `PhysicalRouteEngine`: BFS no grid a partir de cada ponto de acesso (cache por ponto), distância em metros; ordenação = vizinho mais próximo + 2-opt a partir do início. Locais sem posição na planta caem na ordem legada no fim, com penalidade de 500 m.
- `getRouteEngine(tenantId)`: setting `routing.engine` (`LEGACY` padrão | `PHYSICAL`), cache de 30 s, `invalidateRouteEngine` ao salvar planta ou trocar o motor.
- Helpers `pickNextItemByEngine` / `sortPendingItemsByEngine` para filas de itens.

## Consumidores migrados

Separação mobile (próximo item e grupos de proximidade), reconciliação de pick, putaway, fila de reabastecimento, alocação de pick, localizações do produto, resolução de pick face, transferência de carga, fila de packing (âncora de rota e ordenação), linhas de onda liberadas (reordenadas só em `PHYSICAL`) e perfis/clusters de ondas.

Ondas: cada perfil carrega a função de distância; com motor físico o limite usa `wave.partition.proximityMaxDistanceMeters` (padrão 10 m) via `proximityLimitFor`, senão o limite legado.

## Validação da planta

Erros: `NO_START`, `OUT_OF_BOUNDS`, `OVERLAP`, `GONDOLA_UNLINKED`, `ESTANTE_DUPLICATED`, `NO_FACE`, `SLOTS_TOO_SMALL`, `ACCESS_BLOCKED`. Avisos: `NO_PACKING`, `ESTANTE_NOT_PLACED`. O motor físico só pode ser ativado com planta salva e sem erros.

## API

- `GET/PUT /api/warehouse/floor-plans/:barracaoId` (PUT exige `expectedVersion`; conflito → 409)
- `POST /api/warehouse/floor-plans/:barracaoId/validation` (rascunho)
- `POST /api/warehouse/floor-plans/:barracaoId/route-preview` (pedido + rascunho opcional)
- `GET/PUT /api/warehouse/routing-engine` (troca exige `settings.manage`)
- Posições, importação (coluna `face`, aceita A/FRENTE/B/VERSO) e listagem passam a ter face.

## Web

- `/gestao-barracao/mapa`: editor SVG em grid (ferramentas, arrastar/redimensionar, girar, teclado), painel de propriedades com vínculo à estante, faces e sentido das linhas por face, vista frontal da gôndola, validação ao vivo, salvar com versão, simulação de rota de um pedido sobre o rascunho e toggle do motor de rota.
- Face A/B nos formulários de posição, badge "verso" na tabela, coluna `face` na planilha de importação.
- Configuração de ondas: distância máxima em metros.

## Rollout

1. Aplicar a migração/`db push` no ambiente.
2. Desenhar e salvar a planta de cada barracão até ficar sem erros.
3. Conferir rotas com "Simular rota".
4. Ativar `Mapa físico`; voltar para a rota antiga a qualquer momento.

## Fora de escopo

Multiandar/escadas, sentido único de corredor, custo por altura de coluna, roteamento entre barracões.
