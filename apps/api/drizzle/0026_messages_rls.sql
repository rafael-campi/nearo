create index messages_request_idx on messages (service_request_id, created_at desc, id desc);
--> statement-breakpoint
alter table messages enable row level security;
--> statement-breakpoint
create policy messages_company on messages for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
