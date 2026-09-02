# Zentor WMS (Help Route)

**Zentor WMS** é o sistema de **gestão de armazém (WMS)** multi-tenant da Help Route: layout do galpão, recebimento e putaway, ondas de picking, packing, etiquetas de expedição e integração com **Tiny ERP** (OAuth v3). Inclui app mobile para operações de chão.

Nome comercial na interface: **Help Route** · WMS.

## Capacidades principais

- **Inbound:** conferência de NF, putaway, reabastecimento (pulmão → gôndola)
- **Outbound:** ondas (`BY_PRODUCT`, `PROXIMITY`, `SINGLE_ITEM`), packing consolidado, etiquetas Tiny/Mercado Envios
- **Integração Tiny:** pedidos, OAuth, rate limit, webhooks
- **Multi-tenant:** isolamento por empresa com RBAC operacional

## Stack

| Camada | Tecnologia |
|--------|------------|
| Web | Next.js (App Router) |
| API | Node.js + Prisma |
| Mobile | React Native / Expo (apps/mobile) |
| Banco | PostgreSQL |
| Monorepo | npm workspaces (`apps/*`, `packages/*`) |

## Desenvolvimento

```bash
npm install
docker compose up -d       # Postgres + dependências (ver docs)
npm run db:migrate
npm run dev                # web + api conforme package.json
```

## Documentação

Centro completo em [`docs/README.md`](docs/README.md) (vault Obsidian):

- Setup local, arquitetura, modelagem de dados
- Fluxos: recebimento, reabastecimento, ondas, packing
- Integração Tiny (OAuth, pedidos, etiquetas)
- Usuários de teste e credenciais seed

## Estrutura

```
apps/web/      # Painel web (Help Route)
apps/api/      # API REST
apps/mobile/   # Operações de chão
packages/      # shared, prisma, etc.
docs/          # Documentação Obsidian
```
