# 📦 Centro de Documentação — Zentor WMS

Bem-vindo ao centro de documentação técnica e operacional do **Zentor WMS** (Help Route WMS). Este repositório de documentos foi estruturado seguindo o padrão do **Obsidian**, utilizando conexões por wikilinks para facilitar a navegação pelo grafo de conhecimento do projeto.

---

## 🗺️ Mapa da Documentação

Utilize os links abaixo para navegar pelas diferentes seções do sistema:

### ⚙️ Engenharia e Setup
*   [[setup-desenvolvimento|Guia de Setup Local]]: Passo a passo para configurar o ambiente de desenvolvimento, subir o banco de dados via Docker Compose e rodar os seeds.
*   [[arquitetura-e-seguranca|Arquitetura e Segurança]]: Estrutura do monorepo, fluxo de controle de acessos (RBAC) e tabelas de permissões operacionais.
*   [[modelagem-dados|Modelagem de Dados]]: Dicionário do banco de dados (Prisma/PostgreSQL), diagramas lógicos, enums e relacionamentos de multi-tenancy.

### 🚚 Fluxos Operacionais (Inbound & Outbound)
*   [[fluxo-recebimento-putaway|Recebimento e Guardagem]]: Processamento de Notas Fiscais de Entrada (DANFE), conferência cega e alocação de itens em pulmão.
*   [[reabastecimento-estoque|Reabastecimento de Estoque]]: Gatilhos de estoque mínimo (`minThreshold`), ciclo do `CargoTransfer` (pulmão → gôndola) e regras de reconciliação automática de picking.
*   [[logica-ondas|Lógica de Ondas e Packing]]: Estratégias de partição de ondas (`BY_PRODUCT`, `PROXIMITY`, `SINGLE_ITEM`), regras de priorização de marketplaces (ex: Mercado Livre) e fila consolidada de packing.

### 🔌 Integrações e Testes
*   [[integracao-tiny-oauth|Integração Tiny ERP (v3)]]: Autenticação OAuth v3, tratamento automático de Rate Limit (HTTP 429), worker de refresh de tokens e logs de eventos.
*   [[integracao-tiny-pedidos|Integração Tiny — Pedidos de venda]]: Webhooks, sync pull `GET /pedidos`, situações, SKU, diagnóstico e troubleshooting (jun/2026).
*   [[tiny-conexao-conta-ajustes|Conexão Tiny — histórico e ajustes]]: Problemas encontrados ao conectar a conta, correções aplicadas e roteiro de teste local.
*   [[usuarios-teste|Credenciais e Testes]]: Guia de usuários pré-cadastrados via seed, testes de isolamento multi-tenant e validação de acessos.

---

## 💡 Dicas para Visualização no Obsidian
1.  **Modo de Leitura (Preview Mode)**: Pressione `Ctrl + E` para alternar entre o modo de edição e visualização formatada.
2.  **Grafo de Conexões (Graph View)**: Utilize o atalho `Ctrl + G` para visualizar a rede de dependência dos fluxos operacionais e modelos do banco de dados.
3.  **Links Rápidos**: Segure `Ctrl` e clique em qualquer link do tipo `[[nome-do-arquivo]]` para abrir diretamente o documento relacionado em um novo painel.
