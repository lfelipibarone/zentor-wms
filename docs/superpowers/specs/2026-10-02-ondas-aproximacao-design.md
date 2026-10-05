# Ondas de aproximação (picking e packing)

## Objetivo

Cadastrar áreas fixas de trabalho no barracão ("Onda 1 = C, D, E, F"; "Onda 3 = F 8–14, K, L, M, N"), cada uma com um **ponto de saída** e uma **sequência de paradas**, e usar essas áreas para:

- **Picking:** ao liberar, os pedidos saem num lote e as coletas são repartidas pelas áreas; cada separador pega a parte da sua área e anda na sequência cadastrada.
- **Packing:** a fila do packing é filtrada por área (cada mesa ou pessoa pega a sua), com cadastro próprio, independente do picking.

A onda personalizada (pedidos escolhidos à mão, mesmo em pontos diferentes) continua existindo.

## Vocabulário

| Termo | Significado |
| :--- | :--- |
| **Onda de aproximação** | Área cadastrada: nome, cor, ponto de saída e paradas em ordem. Tipo `PICKING` ou `PACKING`. |
| **Parada** | Um lado de uma estante, inteiro ou numa faixa de colunas (ex.: `C 1→7`, `D 8→14`, `E 14→8`). |
| **Lote** | A onda de liberação que já existe (`PickWave`): um conjunto de pedidos liberados juntos. |
| **Parte** | Pedaço do lote de uma onda de aproximação de picking (`PickWavePart`). Cada parte é aceita por um separador. |

## Modelo de dados

- `ApproachWave`: `id`, `tenantId`, `barracaoId`, `kind` (`PICKING` \| `PACKING`), `name`, `color`, `sortOrder`, `active`, `startX`, `startY` (célula da planta do barracão).
- `ApproachWaveStop`: `id`, `approachWaveId`, `position` (ordem na sequência), `estanteId`, `face` (`A` = LD, `B` = LE), `colunaFrom`, `colunaTo` (nulos = estante inteira daquele lado). `colunaFrom > colunaTo` significa andar em ordem decrescente (ex.: `E 14→8`).
- `PickWavePart`: `id`, `waveId`, `approachWaveId` (nulo = "Sem área" ou onda personalizada), `name` (cópia do nome da área na liberação), `color`, `sortOrder`, `acceptedById`, `acceptedAt`.
- `PickWaveLine.partId` (nulo nas ondas antigas, que continuam funcionando como hoje).

**Regra de pertencimento:** uma localização pertence a uma parada quando a estante e a face batem e a coluna está dentro da faixa (em qualquer sentido). Duas ondas do mesmo tipo não podem ter paradas que se sobreponham; o cadastro recusa a gravação e mostra o conflito.

## Cadastro (tela)

Terceiro modo no Mapa do galpão, ao lado de "Editar planta" e "Simular rota": **"Ondas de aproximação"**, com as abas **Picking** e **Packing**.

- Lista de ondas (cor, nome, quantidade de paradas): criar, renomear, trocar cor, mudar a ordem, desativar e excluir.
- Ao editar uma onda:
  - **Definir saída:** clicar numa célula livre do mapa (bandeira com a cor da onda).
  - **Adicionar paradas:** clicar num lado de uma gôndola (ou de uma parte de gôndola). Entra a parada `estante desse lado + faixa de colunas dessa parte`. Ex.: lado de cima da C/D parte 1 → `D 1→7`; lado de baixo → `C 1→7`.
  - Lista de paradas numeradas: subir/descer, editar "de/até" (inverter para andar ao contrário) e remover.
- O mapa pinta os lados das gôndolas com a cor da onda e mostra o número de cada parada e uma linha ligando saída → parada 1 → parada 2 …
- O desenho da planta não é editável neste modo.

API: `GET` e `PUT /api/warehouse/floor-plans/:barracaoId/approach-waves?kind=PICKING|PACKING`. O `PUT` substitui o conjunto inteiro daquele tipo numa transação e valida a sobreposição, as estantes do barracão e a saída dentro da planta, em célula livre.

## Picking

**Estratégia nova `BY_APPROACH` ("Por onda de aproximação")** nas configurações de ondas e no botão de liberar.

1. **Candidatos:** como hoje (pendentes, fora de onda ativa, prioridade, marketplace, máximo de pedidos).
2. **Lote:** um lote com todos os candidatos. As linhas são montadas como hoje (produto + localização).
3. **Partes:** cada linha vai para a parte da onda de aproximação que contém a sua localização. Só são criadas as partes que têm linhas. Linhas fora de todas as áreas vão para a parte **"Sem área"**. Como a linha já é por localização, um pedido com item na C e item na K fica com uma coleta em cada parte. O pedido continua num lote só (regra atual de um pedido por onda).
4. **Celular:**
   - A lista mostra as partes, ex.: "Lote 14:30 · Onda 1 — 12 coletas".
   - O aceite, o cancelamento do aceite e o registro de coleta passam a ser por parte. Só o separador da parte coleta as linhas dela.
   - Lotes antigos, sem partes, continuam com aceite da onda inteira.
   - Se o app não informar a parte, a API usa a parte do próprio separador ou a primeira livre.
5. **Rota da parte:** o celular lista as coletas na ordem das paradas cadastradas. A primeira da lista é por onde começar; a saída marcada no mapa serve de referência visual no cadastro. Dentro de cada parada, segue a coluna no sentido `de → até`. A parte "Sem área" usa o motor de rota atual a partir do ponto de início da planta.
6. **Packing do lote:** igual a hoje. As coletas de todas as partes caem na fila do packing, e as cestas de cada pedido são montadas pela triagem existente.

**Packing de lote:** o packing confere o serviço do picking, embala e imprime a etiqueta. Não precisa ser quem separou (aprovado em 02/10/2026).
- O packing pelo painel web já não exige ser o operador da onda (`webPacking` em `pick-wave-sort.ts`). Nada muda aí.
- A triagem pelo celular passa a exigir ser o separador **da parte** da linha, e não mais o da onda inteira.
- Em todos os casos, a linha precisa estar totalmente coletada antes do packing (regra atual).

**Onda personalizada:** em "Montar onda" (pedidos escolhidos à mão), o seletor "Modo de onda" ganha dois modos:
- **"Onda única" (`SINGLE_WAVE`):** todos os pedidos escolhidos vão para uma onda, sem divisão nem exclusão, com um separador. A rota usa o motor atual a partir do ponto de início, então os pedidos podem estar em qualquer lugar.
- **"Por onda de aproximação" (`BY_APPROACH`):** divide em partes como na liberação automática.
- Os modos atuais continuam como estão.

**Anexar pedidos a uma onda aberta:** em ondas `BY_APPROACH`, as linhas novas vão para a parte da área. Se a parte ainda não existir, ela é criada. Em ondas `BY_APPROACH` e `SINGLE_WAVE`, não se exige SKU em comum nem proximidade.

## Packing

1. **Cadastro próprio** (aba Packing), com saída (normalmente a mesa) e paradas, independente do picking.
2. **Área do pedido na fila:**
   - Pedido dedicado: a onda de packing onde está a **maior quantidade de itens**. Empate: a de menor `sortOrder`. Sem nenhuma área: "Sem área".
   - Linha de lote: a área da localização da linha.
3. **Filtro:**
   - `GET /api/packing/queue/unified?approachWaveId=…` (ou `none` para "Sem área").
   - Na tela do packing, um seletor "Onda de aproximação", lembrado no navegador da mesa.
   - Sem filtro, a fila fica como hoje.
4. **Ordem dentro da área:** a urgência continua em primeiro lugar. No desempate, em vez do "mais perto do anterior", segue a sequência da onda: primeiro a parada, depois a coluna.

## Compatibilidade e rollout

- Sem ondas cadastradas, nada muda. A `BY_APPROACH` sem cadastro responde "Cadastre as ondas de aproximação de picking".
- O pertencimento e a sequência usam estante, face e coluna, então funcionam também com o motor de rota antigo (`LEGACY`). O ponto de saída só influencia a distância com o mapa físico ativo.
- Migration nova para as três tabelas e a coluna `partId`. Somente adições, sem perda de dados.

## Testes

- **Unitários (`node --test`, sem banco, no padrão atual da API):**
  - pertencimento da localização à parada (faces, faixas, sentido invertido, estante inteira);
  - recusa de sobreposição;
  - repartição das linhas em partes, incluindo "Sem área";
  - ordenação da parte pela sequência;
  - área do pedido no packing (maioria e empate);
  - ordenação da fila filtrada;
  - estratégias `BY_APPROACH` e `SINGLE_WAVE` na partição.
- **Verificação manual no ambiente local:**
  - cadastrar ondas no mapa;
  - liberar um lote `BY_APPROACH` e ver as partes no celular ou na API;
  - testar o aceite por parte com dois usuários;
  - ver a onda única com pedidos espalhados;
  - usar o filtro do packing;
  - apagar os dados de teste ao final.

## Fora de escopo

Pulmão nas paredes, horário de liberação por onda, balanceamento automático de carga entre partes e impressão de etiquetas.
