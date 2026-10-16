-- RLS de empresas, vínculos e convites (ADR 0001).
-- Sem FORCE: o dono (despacho) ignora RLS de propósito, para migrations, scripts de operação
-- e funções security definer. A API conecta como despacho_app e fica sujeita às policies.
-- users e sessions são identidade global (sem company_id) e ficam sem RLS; só a autenticação os acessa.

alter table companies enable row level security;
--> statement-breakpoint
create policy companies_select on companies for select using (
  id = app.current_company_id()
  or exists (
    select 1 from memberships m
    where m.company_id = companies.id and m.user_id = app.current_user_id() and m.active
  )
);
--> statement-breakpoint
create policy companies_update on companies for update
  using (id = app.current_company_id())
  with check (id = app.current_company_id());
--> statement-breakpoint
alter table memberships enable row level security;
--> statement-breakpoint
-- A pessoa vê os próprios vínculos em todas as empresas (para escolher onde agir).
create policy memberships_select on memberships for select using (
  company_id = app.current_company_id() or user_id = app.current_user_id()
);
--> statement-breakpoint
create policy memberships_insert on memberships for insert
  with check (company_id = app.current_company_id());
--> statement-breakpoint
create policy memberships_update on memberships for update
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
--> statement-breakpoint
create policy memberships_delete on memberships for delete
  using (company_id = app.current_company_id());
--> statement-breakpoint
alter table invites enable row level security;
--> statement-breakpoint
create policy invites_company on invites for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
--> statement-breakpoint
-- Aceitar um convite acontece antes de haver sessão ou empresa no contexto.
-- Única leitura de convite fora do RLS: pelo hash do token, que só o convidado tem.
create function app.invite_by_token_hash(p_token_hash text)
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  company_active boolean,
  email text,
  role membership_role,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select i.id, i.company_id, c.name, c.active, i.email, i.role, i.expires_at, i.accepted_at
  from invites i join companies c on c.id = i.company_id
  where i.token_hash = p_token_hash
$$;
--> statement-breakpoint
revoke all on function app.invite_by_token_hash(text) from public;
--> statement-breakpoint
grant execute on function app.invite_by_token_hash(text) to despacho_app;
