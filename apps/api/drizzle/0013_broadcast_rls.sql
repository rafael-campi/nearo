create index service_request_declines_membership_idx on service_request_declines (provider_membership_id);
--> statement-breakpoint
create index notifications_user_idx on notifications (user_id, created_at desc);
--> statement-breakpoint
alter table service_request_declines enable row level security;
--> statement-breakpoint
create policy service_request_declines_company on service_request_declines for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
--> statement-breakpoint
alter table notifications enable row level security;
--> statement-breakpoint
-- A pessoa lê e marca como lidas as próprias atualizações, de todas as empresas.
create policy notifications_owner_select on notifications for select using (user_id = app.current_user_id());
--> statement-breakpoint
create policy notifications_owner_update on notifications for update
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());
--> statement-breakpoint
-- Atualizações nascem de ações dentro de uma empresa (ex.: o cliente cria um pedido e os prestadores aptos são avisados).
create policy notifications_insert on notifications for insert
  with check (company_id = app.current_company_id());
