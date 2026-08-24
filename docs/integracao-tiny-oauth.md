# 🔌 Integração OAuth — Olist ERP API v3 (Tiny)

O **Zentor WMS** utiliza a API v3 pública do Olist ERP (Tiny) para importação de pedidos de venda, consulta de notas fiscais de entrada ( DANFE ) e sincronização de status de conferência.

**Etiquetas de transporte / packing:** [[contexto-etiqueta-packing-tiny]] (não confundir DANFE com ZPL).

---

## ⚙️ Registro do Aplicativo no ERP

Para configurar a integração, é necessário registrar um aplicativo na conta do Tiny ERP do cliente:

1.  Acesse o painel do Tiny ERP em **Configurações → Aplicativos**.
2.  Crie um novo aplicativo com escopo de permissão de leitura e gravação em Notas Fiscais, Pedidos de Venda e Produtos.
3.  Defina o **Redirect URI** correspondente ao endereço do seu WMS:
    *   *Desenvolvimento local*: `http://localhost:3333/integrations/tiny/oauth/callback`
    *   *Produção*: URL pública do backend configurada em `API_PUBLIC_URL` mais o path `/integrations/tiny/oauth/callback`.
4.  Copie o **Client ID** e **Client Secret** gerados para colar nas configurações de Integração do WMS Web Dashboard.

---

## 🛡️ Segurança e Armazenamento de Credenciais

Devido à sensibilidade dos dados de faturamento e tokens do cliente, o WMS aplica criptografia simétrica forte de ponta a ponta:

*   **Criptografia**: Os dados de `oauthClientSecret`, `accessToken` e `refreshToken` são criptografados antes de serem persistidos na tabela `tiny_connections` do PostgreSQL.
*   **Chave Hexadecimal**: A API exige a definição da variável de ambiente `ENCRYPTION_KEY` (chave hex de 64 caracteres) em `apps/api/.env`.
*   *Geração da chave no console*:
    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```

> [!CAUTION]
> Se a `ENCRYPTION_KEY` for alterada após a conexão das contas, os tokens existentes se tornarão indecifráveis, quebrando a comunicação da API e exigindo uma nova reconexão manual (OAuth popup) pelas configurações do tenant.

---

## ⚡ Lógica de Throttling e Rate Limits (Tiny API)

O Tiny ERP limita severamente a taxa de requisições enviadas para a sua API v3. O cliente HTTP interno do WMS (`TinyApiV3Client`) gerencia essa taxa de forma automatizada:

1.  **Intervalo Mínimo (`TINY_MIN_REQUEST_INTERVAL_MS`)**: O WMS impõe um atraso padrão de **2 segundos** entre chamadas na mesma conexão (~30 req/min, margem sobre o limite Olist de **120 GET/min**). Ajustável via env `TINY_MIN_REQUEST_INTERVAL_MS` (mínimo 500 ms).
2.  **Desaceleração proativa**: quando `X-RateLimit-Remaining` ≤ 8, o cliente pausa com base em `X-RateLimit-Reset` antes de continuar.
3.  **Tratamento de Rate Limit (HTTP 429)**:
    *   `X-RateLimit-Reset` = **segundos restantes** até a janela de 1 minuto resetar (ex.: `05` → aguarde ~5 s).
    *   Até **5 tentativas** com espera entre 5 s e 120 s (+ buffer de 1 s).
    *   A conexão **permanece `CONNECTED`**; gravamos `metadata.rateLimitUntil` e `lastError` temporários.
    *   Status `BLOCKED` legado é **recuperado automaticamente** (abrir Integrações, sync ou worker OAuth) — **não exige reconectar OAuth**.
    *   Sync de produtos/pedidos **interrompe** ao receber 429 (preserva checkpoint de produtos).

---

## 🔄 Renovação de Tokens OAuth

Conforme a [documentação oficial Olist/Tiny](https://api-docs.erp.olist.com/documentacao/comecando/autenticacao):

| Token | Validade | Estratégia WMS |
|-------|----------|----------------|
| **access_token** | ~4 horas | Renovar quando faltam **30 min** para expirar, ou a cada **3 h** sem renovação |
| **refresh_token** | ~24 horas | Renovar proativamente a cada **20 h** (worker + chamadas API) para manter a sessão |

> [!IMPORTANT]
> Se o WMS ficar **mais de 24 h sem renovar** o refresh token (API parada, worker desabilitado ou `ENCRYPTION_KEY` alterada), será necessário **Conectar com Olist** novamente.

### 1. Atualização por Demanda (Renovação Ativa)
Toda requisição via `getTinyApiClient` verifica `tokenExpiresAt` e `updatedAt`. Se o token estiver próximo de expirar ou a conexão estiver há mais de 20 h sem refresh, renova **antes** da chamada à API Tiny.

Chamadas que recebem HTTP **401** também disparam refresh com **mutex** (evita renovações simultâneas que invalidam o refresh token).

### 2. Worker em Background (`tiny-oauth-refresh-worker.ts`)
Iniciado junto com a API (desabilitar com `START_OAUTH_REFRESH_WORKER=false`).

*   Roda a cada **10 minutos**
*   Varre conexões `CONNECTED` com refresh token
*   Renova quando a política acima indicar necessidade

### Erros transitórios vs. sessão expirada

*   **Falha de rede / OAuth temporário**: mantém status `CONNECTED` e tokens — o worker tenta de novo
* **`invalid_grant`**: refresh token expirou ou foi revogado — limpa tokens e exige reconexão manual

---

## 📋 Auditoria e Log de Integração (`IntegrationEventLog`)

Todos os eventos importantes de troca de dados (notificações de venda do Tiny enviadas por webhooks, início de conferência de DANFE ou erros de OAuth) gravam uma linha de auditoria na tabela `integration_event_logs`.
*   Você pode acompanhar payloads recebidos e status de erros diretamente pela tela de **Logs de Sistema** no painel administrativo web do tenant.

Para entender os dados mapeados nesta integração, consulte a [[modelagem-dados|Modelagem de Dados]].

Para o histórico de problemas e correções ao conectar a conta em desenvolvimento, consulte [[tiny-conexao-conta-ajustes|Conexão Tiny — histórico e ajustes]].

Para pedidos de venda (webhook, API v3 e mapeamento no WMS), consulte [[integracao-tiny-pedidos|Integração Tiny — Pedidos de venda]].
