# Design: APK mobile apontando para homologação

**Data:** 2026-09-03  
**Status:** pendente review  
**Escopo:** distribuição Android interna para testadores do galpão / operação

## Objetivo

Entregar um **APK instalável** do `@wms/mobile` que fala com a **API de homologação**, sem Expo Go e sem Metro ligado no PC.

## Contexto

- App Expo SDK 54 (`apps/mobile`), package `br.com.zentor.wms`
- EAS projectId já configurado em `app.json`
- Perfil `preview` em `eas.json` já define:
  - `distribution: internal`
  - `android.buildType: apk`
  - `EXPO_PUBLIC_API_URL` → `https://wms-backend-4dhznc-57e100-177-7-39-127.sslip.io`
- Web/API homolog existem no Dokploy; **Postgres de homolog precisa de schema + seed** antes dos testes (login/mobile quebram sem tabelas)

## Fora de escopo

- Build iOS / TestFlight
- Publicação na Play Store
- Expo Go / tunnel
- Mudança de domínio da API (mantém URL sslip.io atual)

## Fluxo de entrega

1. **Pré-requisito backend:** no container/DB de homolog, `prisma db push` + `db:seed` (usuários mobile do seed).
2. **Build:** na pasta `apps/mobile`, com conta Expo logada:
   ```bash
   eas build -p android --profile preview
   ```
3. **Distribuição:** link do EAS (ou download do `.apk`) enviado aos funcionários.
4. **Instalação:** Android → permitir instalar apps de fontes desconhecidas → instalar APK.
5. **Login de teste (tenant default):**
   - `picker@wms.local` / `dev`
   - `maria@wms.local` / `dev`
   - `carlos@wms.local` / `dev`  
   (detalhes em `docs/usuarios-teste.md`)

## Critérios de sucesso

- [ ] APK gera com sucesso no EAS (profile `preview`)
- [ ] App abre e alcança a API de homolog (login não falha por rede/URL)
- [ ] Login com picker do seed funciona **após** seed no banco homolog
- [ ] Funcionário consegue ver fila de separação / fluxos mobile básicos

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Banco homolog vazio (`tenants` inexistente) | `db push` + seed antes de liberar o APK |
| API/web offline no Dokploy | Confirmar `/health` da API; web opcional para teste só mobile |
| `EXPO_PUBLIC_*` só entra no build-time | Rebuild se a URL de homolog mudar |
| Android bloquear instalação | Orientar “fontes desconhecidas” / transferir via Drive/WhatsApp |

## Decisão

Usar **EAS Build profile `preview` → APK** como canal oficial de homologação mobile. Expo Go fica só para dev local.
