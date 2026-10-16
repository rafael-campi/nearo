create index device_tokens_user_idx on device_tokens (user_id);
--> statement-breakpoint
alter table device_tokens enable row level security;
--> statement-breakpoint
-- Cada pessoa vê e mexe só nos próprios tokens.
create policy device_tokens_owner on device_tokens for all
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());
--> statement-breakpoint
-- Um aparelho que troca de conta (logout/login) leva o token junto: quem registra assume o token, mesmo
-- que ele ainda esteja gravado para a conta anterior (que o RLS esconde). Só mexe no token informado.
create function app.claim_device_token(p_token text, p_user_id uuid, p_platform device_platform, p_now timestamptz)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into device_tokens (token, user_id, platform, created_at, updated_at)
  values (p_token, p_user_id, p_platform, p_now, p_now)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at
$$;
--> statement-breakpoint
revoke all on function app.claim_device_token(text, uuid, device_platform, timestamptz) from public;
--> statement-breakpoint
grant execute on function app.claim_device_token(text, uuid, device_platform, timestamptz) to despacho_app;
--> statement-breakpoint
-- O worker de push lê os tokens de quem recebe a atualização (fora do contexto dessa pessoa).
create function app.device_tokens_of(p_user_id uuid)
returns table(token text, platform device_platform)
language sql stable security definer
set search_path = public, pg_temp
as $$ select token, platform from device_tokens where user_id = p_user_id $$;
--> statement-breakpoint
revoke all on function app.device_tokens_of(uuid) from public;
--> statement-breakpoint
grant execute on function app.device_tokens_of(uuid) to despacho_app;
--> statement-breakpoint
-- Token que o FCM recusou é removido, de qualquer pessoa.
create function app.remove_device_tokens(p_tokens text[])
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare removed integer;
begin
  delete from device_tokens where token = any(p_tokens);
  get diagnostics removed = row_count;
  return removed;
end
$$;
--> statement-breakpoint
revoke all on function app.remove_device_tokens(text[]) from public;
--> statement-breakpoint
grant execute on function app.remove_device_tokens(text[]) to despacho_app;
