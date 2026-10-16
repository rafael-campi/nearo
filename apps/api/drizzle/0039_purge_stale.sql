-- Limpeza diária de dados que não servem mais: sessões vencidas, links de redefinição vencidos ou usados, e
-- uploads que ninguém usou (o app subiu a foto, mas o pedido ou a mensagem não saiu). Olha todas as empresas,
-- daí o security definer. Os uploads devolvem as chaves para a API apagar os arquivos no storage.
create function app.purge_stale_auth(p_now timestamptz) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
  more integer;
begin
  delete from sessions where expires_at < p_now;
  get diagnostics removed = row_count;
  delete from password_resets where expires_at < p_now - interval '1 day' or used_at < p_now - interval '1 day';
  get diagnostics more = row_count;
  return removed + more;
end
$$;
--> statement-breakpoint
create function app.purge_unused_uploads(p_cutoff timestamptz) returns setof text
language sql security definer
set search_path = public, pg_temp
as $$
  delete from uploads where used_at is null and created_at < p_cutoff returning key
$$;
--> statement-breakpoint
revoke all on function app.purge_stale_auth(timestamptz) from public;
--> statement-breakpoint
revoke all on function app.purge_unused_uploads(timestamptz) from public;
--> statement-breakpoint
grant execute on function app.purge_stale_auth(timestamptz) to despacho_app;
--> statement-breakpoint
grant execute on function app.purge_unused_uploads(timestamptz) to despacho_app;
