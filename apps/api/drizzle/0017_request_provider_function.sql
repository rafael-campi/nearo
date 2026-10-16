-- O cliente lê o prestador do próprio pedido sem ter o contexto da empresa, e o RLS de memberships
-- esconde o vínculo dele. A função devolve só nome, telefone (depois da confirmação) e quantos pedidos
-- ele concluiu na empresa, para o cliente do pedido ou para quem age dentro da empresa do pedido.
create function app.request_provider(p_request_id uuid)
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
           )
         )
    from service_requests r
    join memberships m on m.id = r.provider_membership_id
    join users u on u.id = m.user_id
   where r.id = p_request_id
     and (r.client_id = app.current_user_id() or r.company_id = app.current_company_id())
$$;
--> statement-breakpoint
revoke all on function app.request_provider(uuid) from public;
--> statement-breakpoint
grant execute on function app.request_provider(uuid) to despacho_app;
