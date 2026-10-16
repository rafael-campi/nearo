create index service_request_events_request_idx on service_request_events (service_request_id, created_at);
--> statement-breakpoint
alter table service_request_events enable row level security;
--> statement-breakpoint
create policy service_request_events_company on service_request_events for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
