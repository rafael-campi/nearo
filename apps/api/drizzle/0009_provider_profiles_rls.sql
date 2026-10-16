alter table provider_profiles
  add constraint provider_profiles_radius_range check (service_radius_km between 1 and 100);
--> statement-breakpoint
-- Busca de prestadores aptos por distância (pedido dentro da área de atendimento).
create index provider_profiles_base_location_idx on provider_profiles using gist (base_location);
--> statement-breakpoint
alter table provider_profiles enable row level security;
--> statement-breakpoint
create policy provider_profiles_company on provider_profiles for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
