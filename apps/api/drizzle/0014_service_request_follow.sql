-- Para entrar na sala de socket de um pedido é preciso saber de qual empresa ele é antes de ter
-- a empresa no contexto. Devolve só o id da empresa; o acesso é conferido depois, dentro dela.
create function app.service_request_company(p_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select company_id from service_requests where id = p_id $$;
--> statement-breakpoint
revoke all on function app.service_request_company(uuid) from public;
--> statement-breakpoint
grant execute on function app.service_request_company(uuid) to despacho_app;
