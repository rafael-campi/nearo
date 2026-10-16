-- Pedido ativo (confirmado a em execução): o prestador tem no máximo um, somando todas as empresas.
-- O vínculo em outra empresa não é visível pelo RLS, então a pergunta é respondida aqui, só com sim/não.
create function app.provider_has_active_request(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from service_requests r
      join memberships m on m.id = r.provider_membership_id
     where m.user_id = p_user_id
       and r.status in ('confirmed', 'en_route', 'arrived', 'in_progress')
  )
$$;
--> statement-breakpoint
revoke all on function app.provider_has_active_request(uuid) from public;
--> statement-breakpoint
grant execute on function app.provider_has_active_request(uuid) to despacho_app;
