create index uploads_company_idx on uploads (company_id, created_at);
--> statement-breakpoint
create index service_request_photos_request_idx on service_request_photos (service_request_id, position);
--> statement-breakpoint
alter table uploads enable row level security;
--> statement-breakpoint
create policy uploads_company on uploads for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
--> statement-breakpoint
alter table service_request_photos enable row level security;
--> statement-breakpoint
-- A empresa vê as fotos dos seus pedidos; o cliente vê as dos próprios em todas as empresas ("Meus pedidos").
create policy service_request_photos_select on service_request_photos for select using (
  company_id = app.current_company_id()
  or exists (
    select 1 from service_requests r
     where r.id = service_request_photos.service_request_id and r.client_id = app.current_user_id()
  )
);
--> statement-breakpoint
create policy service_request_photos_insert on service_request_photos for insert
  with check (company_id = app.current_company_id());
--> statement-breakpoint
create policy service_request_photos_delete on service_request_photos for delete
  using (company_id = app.current_company_id());
