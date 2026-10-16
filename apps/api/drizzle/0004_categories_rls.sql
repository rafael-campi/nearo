alter table categories enable row level security;
--> statement-breakpoint
create policy categories_company on categories for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
