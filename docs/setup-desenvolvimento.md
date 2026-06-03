# ⚙️ Guia de Setup e Desenvolvimento Local

Este guia detalha o processo de inicialização do ambiente de desenvolvimento local do **Zentor WMS** utilizando o monorepo pnpm e Docker.

---

## 🛠️ Requisitos de Software

Antes de iniciar, garanta que você possui instalado em sua máquina:

1.  **Node.js**: Versão `>= 20.0.0` (LTS recomendada).
2.  **pnpm**: Versão `>= 9.0.0`. Instale globalmente com `npm i -g pnpm`.
3.  **Docker & Docker Compose**: Para rodar o banco de dados PostgreSQL.

---

## 🚀 Inicialização Passo a Passo

### 1. Clonar o Repositório e Instalar Dependências
No diretório do projeto, execute:

```bash
pnpm install
```

### 2. Subir o Banco de Dados (PostgreSQL)
O projeto inclui um arquivo `docker-compose.yml` pré-configurado na raiz para subir uma instância local do PostgreSQL.

```bash
docker compose up -d
```

### 3. Configurar as Variáveis de Ambiente (`.env`)

Crie os arquivos de ambiente nas seguintes pastas:

#### 📂 Backend API (`apps/api/.env`)
Crie o arquivo `apps/api/.env` baseado no `.env.example` local:

```env
# Banco de dados (Postgres rodando via Docker)
DATABASE_URL="postgresql://postgres:admin@localhost:5432/wms?schema=public"

# Configuração de criptografia para chaves OAuth do Tiny ERP
ENCRYPTION_KEY="cole_aqui_64_caracteres_hexadecimais"
AUTH_SECRET="chave_qualquer_para_assinar_states_oauth"

# URLs públicas de redirecionamento do WMS
API_PUBLIC_URL="http://localhost:3333"
WEB_URL="http://localhost:3000"

# Habilitar workers internos em segundo plano
START_OAUTH_REFRESH_WORKER="true"
```

> [!TIP]
> Você pode gerar uma `ENCRYPTION_KEY` hexadecimal de 64 caracteres executando:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

#### 📂 Dashboard Web (`apps/web/.env`)
Crie o arquivo `apps/web/.env.local` ou `apps/web/.env` contendo:

```env
# Endereço da API backend
NEXT_PUBLIC_API_URL="http://localhost:3333"
```

#### 📂 App Mobile (`apps/mobile/.env`)
Crie o arquivo `apps/mobile/.env` contendo:

```env
# Endereço da API (em conexões físicas de celular, use o IP da sua máquina na rede local)
EXPO_PUBLIC_API_URL="http://localhost:3333"
```

### 4. Executar Migrações e Seeds do Banco de Dados
Gere os tipos do cliente Prisma e aplique a estrutura e dados de teste na sua instância local do Postgres:

```bash
# Gerar os binários de acesso do Prisma
pnpm db:generate

# Aplicar migrações do banco
pnpm db:push

# Popular o banco com dados de demonstração (tenants, usuários e produtos padrão)
pnpm db:seed
```

---

## 💻 Comandos Úteis do Monorepo

Os comandos a seguir são executados a partir do diretório raiz utilizando filtros do **pnpm**:

| Comando | Descrição |
| :--- | :--- |
| `pnpm dev` | Executa a API e o Painel Web em paralelo em modo hot-reload. |
| `pnpm dev:api` | Roda apenas o servidor backend Fastify. |
| `pnpm dev:web` | Roda apenas o dashboard Next.js. |
| `pnpm dev:mobile` | Roda o servidor do Expo para o aplicativo mobile. |
| `pnpm build` | Compila todos os pacotes e aplicativos para produção. |
| `pnpm db:studio` | Abre a interface visual do Prisma Studio no navegador (`http://localhost:5555`). |
| `pnpm test` | Executa os testes de serviço (lógica de ondas, proximidade e oauth). |
| `pnpm lint` | Analisa e corrige problemas de formatação e sintaxe em todo o monorepo. |

---

## 🔍 Validando o Funcionamento
Após executar `pnpm dev`, verifique os seguintes endereços locais:
*   **Web Dashboard**: `http://localhost:3000`
*   **Servidor API**: `http://localhost:3333/health` (ou rotas da API)
*   **Prisma Studio**: `http://localhost:5555`

Para obter a lista de e-mails e senhas criados pelo seed para realizar o login e validar as restrições de cada tenant, abra o documento [[usuarios-teste|Usuários de Teste]].
