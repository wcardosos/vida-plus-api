# Vida Plus API

API REST do **SGHSS Vida Plus**, um sistema de gestão hospitalar e de serviços de saúde. Cobre o cadastro de unidades, pacientes e profissionais, a agenda e as consultas (presenciais e por telemedicina), o prontuário eletrônico com prescrições, a internação e o controle de leitos, a trilha de auditoria e os consentimentos da LGPD.

## Sumário

- [Funcionalidades](#funcionalidades)
- [Stack](#stack)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [Executando a aplicação](#executando-a-aplicação)
- [Documentação da API](#documentação-da-api)
- [Testes](#testes)
- [Scripts disponíveis](#scripts-disponíveis)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)

## Funcionalidades

| Módulo | O que faz |
|---|---|
| `auth` | Login com JWT, logout, recuperação e definição de senha, rate limit nas rotas públicas |
| `units` | Unidades da rede (hospital, clínica, laboratório, home care) |
| `patients` | Autocadastro e cadastro pelo administrador, edição de dados, ativação e desativação de conta |
| `professionals` | Profissionais de saúde, registro em conselho e vínculo com unidades |
| `scheduling` | Disponibilidades, bloqueios, horários livres, agendamento, cancelamento e falta |
| `medical-records` | Prontuário imutável com correções versionadas e prescrições, com campos clínicos criptografados |
| `admissions` | Leitos, internação, transferência e alta |
| `lgpd` | Registro e revogação de consentimentos |
| `audit` | Trilha de auditoria somente de inserção, consultável pelo administrador |

Perfis de acesso: `PATIENT`, `PROFESSIONAL` e `ADMIN`.

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22+, TypeScript, ESM |
| HTTP | Fastify 5, `@fastify/jwt`, `@fastify/rate-limit` |
| Validação | Zod 4 com `fastify-type-provider-zod` |
| Banco de dados | PostgreSQL 17, Drizzle ORM e drizzle-kit |
| Segurança | argon2 (senhas), AES-256-GCM (dados clínicos) |
| Logs | pino (JSON estruturado com request id) |
| Documentação | OpenAPI gerado pelas rotas, Swagger UI |
| Build | `tsc` (checagem de tipos) e esbuild (bundle) |
| Testes | Vitest |

## Pré-requisitos

- [Node.js](https://nodejs.org/) **22 ou superior** (o projeto usa `--env-file` e `process.loadEnvFile()` nativos)
- npm 10+
- PostgreSQL 17, local ou em contêiner. O repositório traz um `docker-compose.yml` para subir o banco com **Docker** (`docker compose`)
- `openssl` para gerar a chave de criptografia (opcional, qualquer gerador de 32 bytes em base64 serve)

## Instalação

```bash
npm install
cp .env.example .env
```

Em seguida, edite o `.env` (veja [Variáveis de ambiente](#variáveis-de-ambiente)). No mínimo, gere segredos reais para o JWT e para a chave dos dados clínicos:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # CLINICAL_DATA_KEY
```

## Variáveis de ambiente

As variáveis são carregadas do `.env` e validadas com Zod em `src/env.ts` na inicialização. Um valor inválido impede a aplicação de subir e a mensagem de erro indica qual variável corrigir.

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `DATABASE_URL` | sim | | URL de conexão com o PostgreSQL |
| `JWT_SECRET` | sim | | Segredo de assinatura dos tokens, com pelo menos 32 caracteres |
| `CLINICAL_DATA_KEY` | sim | | Chave AES-256 em base64 (32 bytes) para os campos clínicos |
| `NODE_ENV` | não | `development` | `development`, `test` ou `production` |
| `HOST` | não | `0.0.0.0` | Interface em que o servidor escuta |
| `PORT` | não | `3000` | Porta HTTP |
| `LOG_LEVEL` | não | | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` |
| `TRUST_PROXY` | não | `false` | Habilite atrás de um proxy reverso para obter o IP real do cliente |
| `APP_URL` | não | `http://localhost:3000` | URL base usada nos links enviados por e-mail |
| `APP_TIMEZONE` | não | `America/Fortaleza` | Fuso horário IANA usado na agenda |
| `JWT_EXPIRES_IN` | não | `1h` | Validade do token de acesso |
| `RESET_TOKEN_TTL` | não | `30min` | Validade do link de redefinição de senha |
| `PASSWORD_SETUP_TOKEN_TTL` | não | `72h` | Validade do link de definição de senha de contas criadas pelo administrador |
| `TERMS_VERSION` | não | `2026-10` | Versão dos termos registrada nos consentimentos |
| `AUTH_RATE_LIMIT_MAX` | não | `10` | Tentativas permitidas nas rotas públicas de autenticação por janela |
| `AUTH_RATE_LIMIT_WINDOW` | não | `15min` | Janela do rate limit |
| `SEED_ADMIN_EMAIL` | para o seed | | E-mail do primeiro administrador |
| `SEED_ADMIN_PASSWORD` | para o seed | | Senha do primeiro administrador (8 a 128 caracteres) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | não | `postgres`, `postgres`, `vida_plus`, `5432` | Usadas apenas pelo `docker-compose.yml` |

Durações aceitam os sufixos `ms`, `s`, `min`, `h` e `d` (ex.: `30min`, `72h`).

> A `CLINICAL_DATA_KEY` não pode ser trocada depois que houver dados gravados: os registros cifrados com a chave anterior deixam de ser legíveis.

## Banco de dados

### 1. Subir o PostgreSQL

Com Docker:

```bash
docker compose up -d
```

O contêiner `vida-plus-postgres` expõe a porta `5432` e mantém os dados no volume `postgres_data`.

### 2. Aplicar as migrations

```bash
npm run db:migrate
```

As migrations ficam versionadas em `src/db/migrations/`. Elas incluem uma constraint de exclusão com `btree_gist` que impede um profissional de ter duas consultas sobrepostas; por isso o usuário do banco precisa ter permissão para criar extensões (o usuário padrão `postgres` tem).

### 3. Popular os dados iniciais

Adicione ao `.env` as variáveis do primeiro administrador (elas não vêm no `.env.example`):

```dotenv
SEED_ADMIN_EMAIL=admin@vidaplus.com
SEED_ADMIN_PASSWORD=uma-senha-forte
```

Depois rode:

```bash
npm run db:seed
```

O seed cria o primeiro usuário `ADMIN` e uma unidade de demonstração de cada tipo. Ele é idempotente: pode ser executado novamente sem duplicar dados.

## Executando a aplicação

### Desenvolvimento

```bash
npm run dev
```

Inicia o servidor com recarga automática (`tsx watch`) em `http://localhost:3000`.

### Produção

```bash
npm run build
npm start
```

O build checa os tipos e gera o bundle em `dist/server.js`. As dependências não são embutidas no bundle, então o `node_modules` precisa estar presente no ambiente de execução. As migrations não são aplicadas automaticamente na inicialização: rode `npm run db:migrate` antes de cada deploy.

### Verificando

```bash
curl http://localhost:3000/health
```

Para obter um token com o administrador criado pelo seed:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "admin@vidaplus.com", "password": "sua-senha"}'
```

A resposta traz `accessToken`, que deve ser enviado nas demais requisições no cabeçalho `Authorization: Bearer <token>`.

Os e-mails (redefinição e definição de senha) são, por enquanto, escritos no log da aplicação em vez de enviados. Procure por `email delivered to console` na saída do servidor para obter os links.

## Documentação da API

A documentação é gerada a partir dos schemas das rotas e fica disponível em todos os ambientes:

| Recurso | URL |
|---|---|
| Swagger UI | http://localhost:3000/docs |
| Especificação OpenAPI (JSON) | http://localhost:3000/docs/json |
| Especificação OpenAPI (YAML) | http://localhost:3000/docs/yaml |

No Swagger UI, use o botão **Authorize** com o `accessToken` obtido no login para testar as rotas autenticadas.

### Respostas de erro

Todos os erros seguem o mesmo formato de corpo:

```json
{
  "message": "Request validation failed",
  "error": "Bad Request",
  "statusCode": 400,
  "details": [{ "location": "body", "path": "/email", "message": "Invalid email address" }]
}
```

O campo `details` só aparece nas falhas de validação. Os códigos usados são:

| Situação | Status |
|---|---|
| Falha de validação | 400 |
| Token ausente ou inválido | 401 |
| Perfil sem permissão ou sem vínculo com o paciente | 403 |
| Recurso não encontrado | 404 |
| Conflito (registro duplicado, horário sobreposto) | 409 |
| Violação de regra de negócio | 422 |
| Limite de requisições excedido | 429 |
| Erro interno | 500 |

## Testes

Os testes usam o [Vitest](https://vitest.dev/) e estão divididos em dois projetos:

| Projeto | Local | Precisa de banco | O que cobre |
|---|---|---|---|
| `unit` | `src/**/*.test.ts` | não | Regras de negócio das entidades, value objects e funções puras (criptografia, cálculo de horários livres) |
| `integration` | `tests/integration/**/*.test.ts` | sim | API de ponta a ponta: autenticação, perfis, índices únicos, transações, auditoria e criptografia |

```bash
npm test                  # todos os testes
npm run test:unit         # apenas unitários
npm run test:integration  # apenas integração
npm run test:watch        # modo watch
```

Para rodar um único arquivo ou um único teste:

```bash
npx vitest run src/modules/audit/entities/audit.entity.test.ts
npx vitest run tests/integration/auth.routes.test.ts -t "nome do teste"
```

### Banco dos testes de integração

Os testes de integração precisam do PostgreSQL rodando e de um `.env` válido. A cada execução, o setup global:

1. remove e recria o banco `<nome do banco da DATABASE_URL>_test` (ex.: `vida_plus_test`) no mesmo servidor;
2. aplica todas as migrations;
3. executa os arquivos de teste em sequência, com `NODE_ENV=test` e logs silenciados.

O banco de desenvolvimento nunca é tocado, mas o usuário da `DATABASE_URL` precisa ter permissão para criar e remover bancos.

### Verificação de tipos

```bash
npm run typecheck
```

## Scripts disponíveis

| Script | Descrição |
|---|---|
| `npm run dev` | Servidor em modo desenvolvimento com recarga automática |
| `npm run build` | Checagem de tipos e bundle de produção em `dist/` |
| `npm start` | Executa o bundle de produção |
| `npm run typecheck` | Checagem de tipos sem gerar arquivos |
| `npm test` | Todos os testes |
| `npm run test:unit` | Testes unitários |
| `npm run test:integration` | Testes de integração |
| `npm run test:watch` | Vitest em modo watch |
| `npm run db:generate` | Gera uma nova migration a partir dos schemas do Drizzle |
| `npm run db:migrate` | Aplica as migrations pendentes |
| `npm run db:push` | Sincroniza o schema direto no banco (somente desenvolvimento) |
| `npm run db:studio` | Abre o Drizzle Studio |
| `npm run db:seed` | Cria o primeiro administrador e as unidades de demonstração |

## Estrutura do projeto

```
src/
  app.ts                 # monta a aplicação: plugins, error handler e rotas
  container.ts           # composition root: cria os módulos em ordem de dependência
  server.ts              # ponto de entrada: sobe o servidor e trata o shutdown
  env.ts                 # validação das variáveis de ambiente
  db/
    client.ts            # conexão Drizzle + PostgreSQL
    schema.ts            # reexporta os schemas de todos os módulos
    seed.ts              # dados iniciais
    migrations/          # migrations SQL versionadas
  plugins/               # autenticação JWT, rate limit, Swagger
  shared/                # erros, criptografia, logger e value objects compartilhados
  modules/<modulo>/
    <modulo>.module.ts   # monta repositórios, service e rotas do módulo
    <modulo>.routes.ts   # rotas Fastify
    <modulo>.schemas.ts  # DTOs Zod de entrada e saída
    schema.ts            # tabelas Drizzle do módulo
    entities/            # entidades de domínio e seus testes unitários
    repositories/        # acesso a dados e mapeamento linha <-> entidade
    services/            # orquestração dos casos de uso
tests/integration/       # testes de API contra PostgreSQL real
```

Cada módulo segue a mesma divisão em camadas: as rotas validam a entrada e chamam o service; o service orquestra transações, auditoria e outros módulos; as regras de negócio ficam nas entidades; e o acesso ao banco fica nos repositórios. Um módulo só conversa com outro pelo service.

## Solução de problemas

**A aplicação não sobe e mostra um erro de validação do Zod.**
Alguma variável do `.env` está ausente ou inválida. A mensagem indica o campo; as causas mais comuns são `JWT_SECRET` com menos de 32 caracteres e `CLINICAL_DATA_KEY` que não é uma chave base64 de 32 bytes.

**`ECONNREFUSED` ou `getaddrinfo ENOTFOUND`.**
O PostgreSQL não está rodando ou o host da `DATABASE_URL` não corresponde ao ambiente. Com o banco subido pelo `docker compose` e a aplicação rodando na máquina, use `localhost`.

**Os testes de integração falham ao criar o banco.**
O usuário da `DATABASE_URL` precisa da permissão `CREATEDB` e o servidor precisa ter a extensão `btree_gist` disponível (inclusa na imagem oficial do PostgreSQL).

**`npm run db:seed` falha pedindo `SEED_ADMIN_EMAIL`.**
Essas variáveis não estão no `.env.example`; adicione-as ao `.env` antes de rodar o seed (veja [Popular os dados iniciais](#3-popular-os-dados-iniciais)).
