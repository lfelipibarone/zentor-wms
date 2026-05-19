# Usuários de teste — Help Route WMS

Credenciais para desenvolvimento e testes de multi-tenant. Após alterar o seed, rode:

```bash
pnpm --filter @wms/api prisma db seed
```

## Super-admin da plataforma

| E-mail | Senha | Acesso |
|--------|-------|--------|
| `admin@wms.local` | `admin123` | Painel web: **Clientes** (criar tenants, admins). Não opera pedidos/ondas. App mobile bloqueado. |

## Tenant `default` (dados de demonstração completos)

| Slug | Nome |
|------|------|
| `default` | Default |

| E-mail | Senha | Papel | Web | Mobile |
|--------|-------|-------|-----|--------|
| `operador@wms.local` | `operador123` | Expedição / painel operacional | Sim | Não |
| `picker@wms.local` | `dev` | Separador | Não | Sim |
| `maria@wms.local` | `dev` | Separador | Não | Sim |
| `carlos@wms.local` | `dev` | Separador | Não | Sim |

Pedidos de exemplo: prefixo `ERP-DEMO-*` e `ERP-10042`. Dashboard com dezenas de pedidos e alertas de gôndola.

## Loja Demo A (`demo-loja-a`)

| E-mail | Senha | Papel | Web | Mobile |
|--------|-------|-------|-----|--------|
| `admin@loja-a.local` | `admin123` | Admin do cliente | Sim | Não |
| `picker@loja-a.local` | `dev` | Separador | Não | Sim |

Pedidos: `LOJA-A-001` … `LOJA-A-007` (isolados dos outros tenants).

## Loja Demo B (`demo-loja-b`)

| E-mail | Senha | Papel | Web | Mobile |
|--------|-------|-------|-----|--------|
| `admin@loja-b.local` | `admin123` | Admin do cliente | Sim | Não |
| `picker@loja-b.local` | `dev` | Separador | Não | Sim |

Pedidos: `LOJA-B-001` … `LOJA-B-007`.

## Loja Demo C (`demo-loja-c`)

| E-mail | Senha | Papel | Web | Mobile |
|--------|-------|-------|-----|--------|
| `admin@loja-c.local` | `admin123` | Admin do cliente | Sim | Não |
| `picker@loja-c.local` | `dev` | Separador | Não | Sim |

Pedidos: `LOJA-C-001` … `LOJA-C-007`.

## O que validar

1. **Isolamento:** login como `admin@loja-a.local` → pedidos só com prefixo `LOJA-A-*`; não ver `LOJA-B-*` ou `ERP-DEMO-*`.
2. **Plataforma:** login como `admin@wms.local` → menu só **Clientes**; sem Dashboard/Pedidos/Ondas.
3. **Mobile:** `picker@loja-a.local` acessa o app; `admin@wms.local` recebe erro de permissão no mobile.
4. **Criar cliente:** em Clientes, criar tenant e admin inicial; login com o novo admin opera só aquele tenant.

## URLs

- Web: `http://localhost:3000` (ou `NEXT_PUBLIC_API_URL` configurada)
- API: `http://localhost:3333`
- Mobile: Expo — mesma API
