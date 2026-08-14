# Studio Laser — Dashboard operacional

Dashboard das ordens de serviço do Nucleus, com extração autenticada por Playwright, paginação completa, etapas do fluxo e indicador de produção em m².

## Arquitetura

- `dashboard`: aplicação web pública. Recebe as credenciais apenas durante a sessão e encaminha as sincronizações pelo backend.
- `nucleus-worker`: serviço Playwright privado. Autentica no Nucleus e realiza as extrações.
- Comunicação entre os serviços: rede privada do Railway. O worker não precisa de domínio público.

Nenhuma credencial do Nucleus é armazenada no código, banco, variáveis do Railway ou navegador.

## Execução local

Requisitos: Node.js 22 ou superior e pnpm.

```bash
pnpm install
cd services/nucleus-worker
pnpm install
pnpm exec playwright install chromium
pnpm start
```

Em outro terminal, na raiz:

```bash
pnpm dev
```

Acesse `http://localhost:3000`. A rota interna `/api/nucleus/*` encaminha as chamadas para `http://localhost:8787` por padrão.

## Implantação no Railway

### Opção recomendada: um único serviço

O Dockerfile da raiz inicia a dashboard e o worker Playwright no mesmo container. No Railway, conecte o repositório, mantenha o diretório raiz em `/` e use `/railway.toml` como arquivo de configuração. Não é necessário definir `NUCLEUS_WORKER_INTERNAL_URL`: o endereço padrão `http://localhost:8787` é usado automaticamente.

Gere um domínio público e confirme que `/api/health` retorna `worker: "ok"` antes de usar a extração.

### Opção avançada: serviços separados

O repositório está preparado como um monorepo com dois serviços e Dockerfiles separados.

### 1. Envie o projeto para um repositório GitHub

Conecte esse repositório a um novo projeto no Railway.

### 2. Crie o serviço privado `https://github.com/workperfect1986/nucleus-worker`

- Nome do serviço: `nucleus-worker`
- Source: o mesmo repositório GitHub
- Root Directory: `/services/nucleus-worker`
- Config File: `/services/nucleus-worker/railway.toml`
- Não gere domínio público para este serviço.

Variáveis:

```env
PORT=8787
NUCLEUS_MAX_PAGES=10000
RAILWAY_SHM_SIZE_BYTES=536870912
```

As URLs do Nucleus já possuem valores seguros como padrão. A URL de ordens é consultada por empresa usando o catálogo em `companies.mjs`; só defina `NUCLEUS_URL`, `NUCLEUS_ORDERS_URL`, `NUCLEUS_ACTIVE_URL` ou `NUCLEUS_PRODUCTION_URL` se precisar substituí-las.

### 3. Crie o serviço público `dashboard`

- Nome do serviço: `dashboard`
- Source: o mesmo repositório GitHub
- Root Directory: `/`
- Config File: `/railway.toml`

Variável:

```env
NUCLEUS_WORKER_INTERNAL_URL=http://${{nucleus-worker.RAILWAY_PRIVATE_DOMAIN}}:8787
```

Depois do deploy, abra **Settings → Networking → Generate Domain** somente no serviço `dashboard`.

### 4. Validação

- Dashboard: `https://SEU-DOMINIO.up.railway.app/api/health`
- Worker: use a aba de deploy do serviço e confirme o healthcheck `/health`.
- Faça login na dashboard e sincronize inicialmente um período curto.

## Configuração opcional

| Variável | Serviço | Padrão | Finalidade |
| --- | --- | --- | --- |
| `NUCLEUS_WORKER_INTERNAL_URL` | dashboard | `http://localhost:8787` | Endereço privado do worker |
| `PORT` | nucleus-worker | `8787` | Porta HTTP privada |
| `NUCLEUS_MAX_PAGES` | nucleus-worker | `10000` | Limite de páginas de ordens |
| `NUCLEUS_COMPANY_CONCURRENCY` | nucleus-worker | `2` | Empresas consultadas em paralelo |
| `NUCLEUS_STATUS_CONCURRENCY` | nucleus-worker | `3` | Status consultados em paralelo |
| `NUCLEUS_URL` | nucleus-worker | URL Studio Laser | Host do Nucleus |
| `NUCLEUS_ORDERS_URL` | nucleus-worker | URL filtrada no código | Fonte das ordens por empresa |
| `NUCLEUS_ACTIVE_URL` | nucleus-worker | URL filtrada no código | Consulta da etapa por ID da OS |
| `NUCLEUS_PRODUCTION_URL` | nucleus-worker | `/dashboard/production` | Fonte do total de produção |

## Segurança

- Nunca adicione e-mail ou senha do Nucleus às variáveis do Railway.
- Não gere domínio público para `nucleus-worker`.
- Os logs não registram as credenciais.
- Altere a senha que foi compartilhada durante o desenvolvimento antes da publicação.
