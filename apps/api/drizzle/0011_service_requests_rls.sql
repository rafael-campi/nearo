create index service_requests_company_status_idx on service_requests (company_id, status, created_at desc);
--> statement-breakpoint
create index service_requests_client_idx on service_requests (client_id, created_at desc);
--> statement-breakpoint
create index service_requests_location_idx on service_requests using gist (location);
--> statement-breakpoint
alter table service_requests enable row level security;
--> statement-breakpoint
-- A empresa vê seus pedidos; o cliente vê os próprios em todas as empresas (lista "Meus pedidos").
create policy service_requests_select on service_requests for select using (
  company_id = app.current_company_id() or client_id = app.current_user_id()
);
--> statement-breakpoint
create policy service_requests_insert on service_requests for insert
  with check (company_id = app.current_company_id() and client_id = app.current_user_id());
--> statement-breakpoint
create policy service_requests_update on service_requests for update
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
--> statement-breakpoint
-- Membros ativos de uma empresa leem as categorias dela (nome da categoria em "Meus pedidos").
create policy categories_members_select on categories for select using (
  exists (
    select 1 from memberships m
    where m.company_id = categories.company_id and m.user_id = app.current_user_id() and m.active
  )
);
