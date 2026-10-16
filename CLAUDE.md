# Despacho

Plataforma multi-empresa de serviços (estilo GetNinjas, mas cada empresa controla seus usuários).
Três perfis: **admin da empresa**, **prestador** e **cliente (solicitante)**.

Leia antes de trabalhar:
- `GLOSSARY.md` — termos do domínio. Use exatamente esses termos em código, testes, tickets e conversa.
- `docs/adr/` — decisões já tomadas. Não contradiga um ADR sem propor um novo que o substitua.
- `docs/v1-scope.md` — o que entra e o que não entra na primeira versão.
- `docs/reference/` — schema SQL de referência e o protótipo navegável (`despacho.html`). São referência de comportamento, não código para copiar.

## Estrutura (monorepo pnpm + Turborepo)

```
apps/
  api/       NestJS — REST + Socket.IO (chat, GPS, status) + BullMQ (filas, push)
  admin/     Next.js — painel web da empresa
  mobile/    React Native + Expo — app único com modo cliente e modo prestador
packages/
  shared/    tipos e schemas Zod compartilhados (contratos da API e eventos de socket)
infra/       docker-compose, Caddy, scripts de backup
```

## Regras que valem para todo o código

- **Isolamento por empresa é inegociável.** Toda tabela de domínio tem `company_id`. Toda consulta filtra por ele na camada de repositório, e o Postgres reforça com RLS (`set local app.user_id` / `app.company_id` por transação). Teste que um usuário de uma empresa nunca lê dados de outra.
- **Regras de negócio no backend.** Transições de status, aceite mútuo e permissões são validadas na API, nunca só no app.
- **Contratos no `packages/shared`.** Payloads REST e eventos de socket têm schema Zod lá; api, admin e mobile importam de lá.
- **Sem IA na v1** (ADR 0007).

## App mobile — desempenho

Público inclui prestadores com Android de entrada. Meta: abrir < 2 s, listas a 60 fps, medido em build de release.
- Listas: FlashList (nunca ScrollView + map).
- Animações/gestos: Reanimated + Gesture Handler.
- Imagens: expo-image, sempre redimensionadas antes do upload (máx. 1000 px, JPEG ~80%).
- Estado: Zustand (app) + TanStack Query (servidor). Eventos de socket atualizam só a tela afetada.
- Armazenamento local: MMKV.

## Comandos

Node 24 (`.nvmrc`) e pnpm via corepack (`corepack enable pnpm`). Rode da raiz:

```bash
pnpm install
pnpm infra:up      # Postgres+PostGIS e Redis (infra/docker-compose.yml)
pnpm dev           # todos os apps; um só: pnpm --filter @despacho/api dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

`packages/shared` compila para `dist/`; o turbo o constrói antes dos apps.
No mobile, adicione dependências com `npx expo install <pacote>` (ver `apps/mobile/AGENTS.md`).
<!-- Falta: db:migrate (quando o Drizzle entrar). -->

## Agent skills

### Issue tracker

Issues no GitHub em `rafael-campi/nearo` (via `gh -R rafael-campi/nearo`). See `docs/agents/issue-tracker.md`.

### Triage labels

Labels padrão: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` na raiz. See `docs/agents/domain.md`.
