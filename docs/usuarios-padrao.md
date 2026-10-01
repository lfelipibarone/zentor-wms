# Usuários padrão

Criados automaticamente no boot da API (`apps/api/src/services/ensure-default-users.ts`). A senha só é definida na criação; troque-a pelo painel após o primeiro acesso.

| Perfil | E-mail | Senha inicial | Acesso |
| --- | --- | --- | --- |
| Admin master (plataforma) | `admin@wms.local` | `admin123` | Web — gestão de clientes |
| Admin da conta | `adm@wms.local` | `admin123` | Web e mobile — tenant `default` |
| Operador | `operador@wms.local` | `operador123` | Web — tenant `default` |
| Separador | `picker@wms.local` | `dev` | Mobile — tenant `default` |
