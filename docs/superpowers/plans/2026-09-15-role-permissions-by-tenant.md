# Role permissions by tenant — Implementation Plan

> **For agentic workers:** Implemented inline in session 2026-09-15.

**Goal:** Canais e módulos configuráveis por cargo, por empresa.

**Architecture:** `TenantRolePermission` + resolução no auth; UI Admin → Cargos; usuários só escolhem cargo.

**Tech Stack:** Prisma, Fastify, Next.js, `@wms/shared`

## Status

- [x] Schema + migration SQL + db push
- [x] Shared helpers (`ROLE_MATRIX_*`, `resolveRolePermissions`, `expandRoleMatrixPermissions`)
- [x] Service + admin API GET/PUT `/api/admin/role-permissions`
- [x] Auth resolve from matrix; users stop accepting per-user permissions
- [x] Seed / ensure-db / createTenant seed matrix
- [x] UI Cargos + Funcionários sem checkboxes individuais
- [x] Unit tests
