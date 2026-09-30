# Permissões por cargo (por empresa)

## Objetivo

Canais (mobile/web) e módulos operacionais são definidos **por cargo**, configuráveis **por tenant**. Funcionários só recebem um cargo.

## Modelo

- Enum `UserRole` permanece fixo: `PICKER`, `REPLENISHER`, `EXPEDITER`, `ADMIN`.
- Tabela `TenantRolePermission` (`tenantId` + `role` + `permissions[]`), unique `(tenantId, role)`.
- Seed da matriz com `ROLE_DEFAULTS` na criação do tenant e backfill para tenants existentes.
- `User.permissions` deixa de ser override (persistir `[]`); permissões efetivas vêm da matriz do cargo.

## Resolução

1. Platform admin → `PLATFORM_ADMIN_PERMISSIONS`
2. `ADMIN` do tenant → todas as permissões do tenant (exceto `tenants.manage`)
3. Demais → linha da matriz do tenant; fallback `defaultPermissionsForRole`

Resolução ocorre no load de auth e nas respostas públicas de usuário.

## API / UI

- `GET/PUT /api/admin/role-permissions`
- Create/update de usuário sem campo `permissions`
- Tela Admin → Cargos; Funcionários só escolhe cargo
- `ADMIN` não é editável na matriz

## Fora de escopo

Cargos custom; RLS no Postgres.
