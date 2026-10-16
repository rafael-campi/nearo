# 0003 — Stack: TypeScript em tudo, NestJS, PostgreSQL + PostGIS

**Status:** aceito

## Decisão
- **Backend:** NestJS (Node.js, TypeScript), REST + Socket.IO, BullMQ para filas.
- **Banco:** PostgreSQL + PostGIS (relacional, geográfico e chat no mesmo banco). ORM: Drizzle (bom suporte a SQL puro e PostGIS).
- **Cache / pub-sub / filas:** Redis (adapter do Socket.IO, BullMQ, última posição do prestador).
- **Arquivos:** S3 compatível (MinIO na VPS), upload direto do app por URL assinada.
- **Push:** FCM via firebase-admin, disparado pelo worker.
- **Web admin:** Next.js + TanStack Query + shadcn/ui.
- **Mobile:** React Native + Expo (ADR 0004).
- **Monorepo:** pnpm + Turborepo, com `packages/shared` (tipos e schemas Zod).

## Alternativas consideradas
- Supabase como backend: mais rápido de começar, mas optamos por backend próprio para controlar regras, filas e chat.
- MongoDB/Cassandra para o chat: desnecessário no volume previsto; somaria um segundo banco.
- Kotlin/Spring ou Go no backend: bons, mas perderíamos o compartilhamento de tipos.

## Consequências
- Uma linguagem só; contratos compartilhados entre api, admin e mobile.
- Mensagens do chat: índice `(request_id, created_at)`, paginação por cursor; particionar por mês se passar de ~50 milhões.
- GPS: última posição no Redis; no Postgres, só um ponto a cada ~30 s, com retenção de 30 dias.
