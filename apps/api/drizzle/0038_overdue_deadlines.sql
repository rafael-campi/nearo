-- Varredura de prazos vencidos que o BullMQ não executou (Redis fora do ar na hora de agendar, job perdido).
-- Só os prazos que mudam o estado do pedido, pois repetem sem efeito colateral: espera do cliente (volta para
-- `open`) e revelação das avaliações. Os avisos (lembrete e "sem aceite") não têm marca de envio, então
-- ficam de fora para não repetir a cada passada. Olha todas as empresas, daí o security definer.
create function app.overdue_deadlines(p_now timestamptz, p_client_timeout_s integer, p_reveal_s integer)
returns table (kind text, service_request_id uuid, company_id uuid, stamp timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select 'awaiting_client_timeout'::text, r.id, r.company_id, r.accepted_at
    from service_requests r
   where r.status = 'awaiting_client'
     and r.accepted_at <= p_now - make_interval(secs => p_client_timeout_s)
  union all
  select 'reveal_reviews'::text, r.id, r.company_id, r.completed_at
    from service_requests r
   where r.status = 'completed'
     and r.completed_at <= p_now - make_interval(secs => p_reveal_s)
     and exists (select 1 from reviews v where v.service_request_id = r.id and v.visible_at is null)
$$;
--> statement-breakpoint
revoke all on function app.overdue_deadlines(timestamptz, integer, integer) from public;
--> statement-breakpoint
grant execute on function app.overdue_deadlines(timestamptz, integer, integer) to despacho_app;
