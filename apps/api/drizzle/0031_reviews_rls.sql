alter table reviews add constraint reviews_rating_range check (rating between 1 and 5);
--> statement-breakpoint
create index reviews_reviewee_idx on reviews (company_id, reviewee_id) where visible_at is not null;
--> statement-breakpoint
alter table reviews enable row level security;
--> statement-breakpoint
-- Às cegas: dentro da empresa, cada um lê a própria avaliação; a do outro lado só depois de visível.
create policy reviews_select on reviews for select using (
  company_id = app.current_company_id()
  and (visible_at is not null or reviewer_id = app.current_user_id())
);
--> statement-breakpoint
create policy reviews_insert on reviews for insert
  with check (company_id = app.current_company_id() and reviewer_id = app.current_user_id());
--> statement-breakpoint
-- Revelar avaliações mexe também na linha do outro lado (que o RLS esconde): função própria. Revela quando
-- os dois já avaliaram ou quando o prazo manda (p_force). Devolve quantas revelou.
create function app.reveal_reviews(p_request_id uuid, p_now timestamptz, p_force boolean)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare revealed integer;
begin
  update reviews
     set visible_at = p_now
   where service_request_id = p_request_id
     and company_id = app.current_company_id()
     and visible_at is null
     and (p_force or (select count(*) from reviews r where r.service_request_id = p_request_id) >= 2);
  get diagnostics revealed = row_count;
  return revealed;
end
$$;
--> statement-breakpoint
revoke all on function app.reveal_reviews(uuid, timestamptz, boolean) from public;
--> statement-breakpoint
grant execute on function app.reveal_reviews(uuid, timestamptz, boolean) to despacho_app;
--> statement-breakpoint
-- O prestador do pedido passa a vir com a nota dele na empresa (só avaliações visíveis).
create or replace function app.request_provider(p_request_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'name', u.name,
           'phone', case when r.status in ('confirmed', 'en_route', 'arrived', 'in_progress', 'completed') then u.phone end,
           'completedCount', (
             select count(*)::int from service_requests c
              where c.provider_membership_id = m.id and c.status = 'completed'
           ),
           'rating', jsonb_build_object(
             'average', (
               select round(avg(v.rating)::numeric, 1)::float8 from reviews v
                where v.reviewee_id = m.user_id and v.company_id = r.company_id and v.visible_at is not null
             ),
             'count', (
               select count(*)::int from reviews v
                where v.reviewee_id = m.user_id and v.company_id = r.company_id and v.visible_at is not null
             )
           )
         )
    from service_requests r
    join memberships m on m.id = r.provider_membership_id
    join users u on u.id = m.user_id
   where r.id = p_request_id
     and (r.client_id = app.current_user_id() or r.company_id = app.current_company_id())
$$;
