ALTER TABLE "companies" ADD COLUMN "join_code" text;--> statement-breakpoint
-- Empresas que já existem ganham um código (8 caracteres hex em maiúsculas).
UPDATE "companies" SET "join_code" = upper(substr(md5(random()::text || id::text), 1, 8)) WHERE "join_code" IS NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "join_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_join_code_unique" UNIQUE("join_code");--> statement-breakpoint
-- Entrar numa empresa pelo código acontece antes de haver empresa no contexto.
-- Única leitura de empresa fora do RLS: pelo código, que a empresa divulga de propósito.
create function app.company_by_join_code(p_code text)
returns table (id uuid, name text, active boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.active from companies c where c.join_code = p_code
$$;--> statement-breakpoint
revoke all on function app.company_by_join_code(text) from public;--> statement-breakpoint
grant execute on function app.company_by_join_code(text) to despacho_app;
