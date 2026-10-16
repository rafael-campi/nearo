# Referência

- `schema.sql` e `schema_v2_chat_mapa_avaliacoes.sql`: modelagem feita para Supabase. Servem de referência para tabelas, regras de transição e políticas de acesso. No backend próprio, `auth.users` vira a tabela `users` e `auth.uid()` vira `current_setting('app.user_id')::uuid` (ADR 0001 e 0003).
- `despacho.html`: protótipo navegável com os três perfis. Abra no navegador. Mostra o comportamento esperado de aceite mútuo, chat, mapa e avaliações.
