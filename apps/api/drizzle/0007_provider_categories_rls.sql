alter table provider_categories enable row level security;
--> statement-breakpoint
create policy provider_categories_company on provider_categories for all
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());
