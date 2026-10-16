-- A revelação devolve quem foi avaliado (para avisar essas pessoas), em vez de só a contagem.
drop function app.reveal_reviews(uuid, timestamptz, boolean);
--> statement-breakpoint
create function app.reveal_reviews(p_request_id uuid, p_now timestamptz, p_force boolean)
returns setof uuid
language sql security definer
set search_path = public, pg_temp
as $$
  update reviews
     set visible_at = p_now
   where service_request_id = p_request_id
     and company_id = app.current_company_id()
     and visible_at is null
     and (p_force or (select count(*) from reviews r where r.service_request_id = p_request_id) >= 2)
  returning reviewee_id
$$;
--> statement-breakpoint
revoke all on function app.reveal_reviews(uuid, timestamptz, boolean) from public;
--> statement-breakpoint
grant execute on function app.reveal_reviews(uuid, timestamptz, boolean) to despacho_app;
