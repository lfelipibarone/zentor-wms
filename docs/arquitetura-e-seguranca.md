# 🏛️ Arquitetura e Controle de Acesso (Segurança)

O **Zentor WMS** é projetado sob a arquitetura de **Monorepo** utilizando o gerenciador de pacotes **pnpm** para organizar o backend, frontend web, aplicativo mobile e códigos compartilhados. O sistema é nativamente **multi-tenant**, isolando os dados de cada cliente no banco de dados.

---

## 🏗️ Estrutura do Monorepo

O código-fonte está distribuído nas seguintes pastas:

*   **`packages/shared/`**: Biblioteca compartilhada de tipagens, utilitários, enums do Prisma e definições de permissões do sistema. Garante que regras de negócio (como permissões e urgências) sejam idênticas na API, no Web e no Mobile.
*   **`apps/api/`**: Servidor backend desenvolvido em **Fastify** com **TypeScript** e **Prisma ORM**. Gerencia a conexão com o banco de dados PostgreSQL, filas de ondas, sincronizações com Tiny ERP e autenticações.
*   **`apps/web/`**: Dashboard administrativo desenvolvido em **Next.js** (App Router) com TailwindCSS. Utilizado pelos administradores e expedidores para cadastros, gerenciamento de estoque, acompanhamento de ondas e fila de packing.
*   **`apps/mobile/`**: Aplicativo móvel para os operadores de galpão desenvolvido em **Expo** (React Native). Otimizado para coletores de dados e celulares, controlando a separação física, reabastecimentos, armazenagem e inventário.

---

## 🔑 Modelo de Permissões (RBAC)

O controle de acesso é baseado em papéis de usuário (**Role-Based Access Control - RBAC**). As definições principais residem em `packages/shared/src/permissions.ts`.

### 👥 Papéis do Sistema (Roles)

1.  **`PICKER` (Separador)**:
    *   *Foco*: Operação de campo (separação física de mercadorias).
    *   *Acesso*: Apenas aplicativo móvel (`apps/mobile`).
2.  **`REPLENISHER` (Reabastecedor)**:
    *   *Foco*: Movimentação de estoque interno (pulmão → gôndola).
    *   *Acesso*: Aplicativo móvel (`apps/mobile`) e visualização básica de estoque na Web.
3.  **`EXPEDITER` (Expedidor)**:
    *   *Foco*: Conferência de compras, faturamento, packing e despacho de pedidos.
    *   *Acesso*: Painel administrativo Web (`apps/web`).
4.  **`ADMIN` (Administrador do Cliente/Tenant)**:
    *   *Foco*: Gestão de usuários, configurações operacionais de ondas, integrações e relatórios.
    *   *Acesso*: Acesso total ao Web e Mobile (exceto gerenciar outros tenants).

---

## 📋 Catálogo de Permissões Granulares

As permissões operacionais do sistema estão mapeadas na seguinte estrutura:

| Permissão | Grupo | Label | Padrão nos Papéis |
| :--- | :--- | :--- | :--- |
| `mobile.access` | Geral | Acesso ao app mobile | `PICKER`, `REPLENISHER` |
| `web.access` | Geral | Acesso ao painel web | `ADMIN`, `EXPEDITER`, `REPLENISHER` |
| `dashboard.view` | Operação | Visualizar Dashboard | `ADMIN`, `EXPEDITER` |
| `registers.view` | Operação | Acesso aos Cadastros | `ADMIN`, `EXPEDITER` |
| `sales.view` | Operação | Visualizar Pedidos | `ADMIN`, `EXPEDITER` |
| `receipts.view` | Operação | Conferência de Recebimento | `ADMIN`, `EXPEDITER` |
| `stock.view` | Operação | Controle de Estoque | `ADMIN`, `EXPEDITER`, `REPLENISHER` |
| `shipping.view` | Operação | Expedição e Despacho | `ADMIN`, `EXPEDITER` |
| `reports.view` | Admin | Relatórios Gerenciais | `ADMIN` |
| `system.view` | Sistema | Logs e Status de Integridade | `ADMIN`, `EXPEDITER` |
| `users.manage` | Admin | Gerenciar Usuários | `ADMIN` |
| `settings.manage` | Admin | Configurações do Sistema | `ADMIN` |
| `olist.configure` | Integrações | Configurar Tiny/Olist | `ADMIN`, `EXPEDITER` |
| `notifications.view` | Geral | Visualizar Notificações | Todos |
| `tenants.manage` | Plataforma | Gerenciar Clientes/Tenants | **Apenas Super-Admin** |

---

## 🏢 Isolamento Multi-Tenant e o Super-Admin

O Zentor WMS protege o isolamento de dados das empresas clientes (tenants) em todas as rotas e queries através da coluna `tenantId`.

### 👑 O Super-Admin da Plataforma

*   **Usuário**: Definido pela flag `isPlatformAdmin: true` e `tenantId: null` no banco de dados.
*   **Permissões**: Possui um conjunto estrito de ações em nível de provedor, mapeadas em `PLATFORM_ADMIN_PERMISSIONS`:
    *   `web.access`
    *   `tenants.manage` (único papel que pode criar novos clientes no banco de dados)
    *   `notifications.view`
*   **Isolamento**: O Super-Admin **não** tem acesso operacional a gôndolas, ondas, pedidos, relatórios de produtividade ou configurações de integrações Tiny de nenhum cliente. Ele opera exclusivamente na interface de cadastro de clientes.
*   **Mobile**: O acesso ao aplicativo mobile (`apps/mobile`) é sumariamente **bloqueado** para o Super-Admin da plataforma.

Para entender como criar e testar esses usuários no seu ambiente local, consulte o guia [[usuarios-teste|Credenciais e Usuários de Teste]].
