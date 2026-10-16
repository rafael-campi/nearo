create index provider_positions_request_idx on provider_positions (service_request_id, recorded_at);
--> statement-breakpoint
create index provider_positions_recorded_idx on provider_positions (recorded_at);
--> statement-breakpoint
alter table provider_positions enable row level security;
--> statement-breakpoint
create policy provider_positions_company on provider_positions for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
--> statement-breakpoint
-- Retenção de 30 dias: a limpeza roda por fora de qualquer empresa, então é uma função de plataforma
-- que apaga só pelo critério de idade. Devolve quantas linhas apagou.
create function app.purge_provider_positions(p_older_than timestamptz)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare removed integer;
begin
  delete from provider_positions where recorded_at < p_older_than;
  get diagnostics removed = row_count;
  return removed;
end
$$;
--> statement-breakpoint
revoke all on function app.purge_provider_positions(timestamptz) from public;
--> statement-breakpoint
grant execute on function app.purge_provider_positions(timestamptz) to despacho_app;
