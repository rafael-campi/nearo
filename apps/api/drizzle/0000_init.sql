-- Base do isolamento por empresa (ADR 0001).
-- A API conecta como despacho_app (sem BYPASSRLS), criado pela infra. Cada transação faz
-- `set local app.user_id` / `app.company_id`; as policies leem esses valores pelas funções abaixo.
create schema if not exists app;
--> statement-breakpoint
create function app.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
create function app.current_company_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint
grant usage on schema app to despacho_app;
--> statement-breakpoint
grant usage on schema public to despacho_app;
--> statement-breakpoint
alter default privileges in schema public
  grant select, insert, update, delete on tables to despacho_app;
--> statement-breakpoint
alter default privileges in schema public
  grant usage, select on sequences to despacho_app;
