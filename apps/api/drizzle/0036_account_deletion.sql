-- O que impede uma pessoa de excluir a conta, olhando todas as empresas (o RLS esconde os vínculos e pedidos
-- de outras empresas): pedido aberto ou ativo como cliente, pedido atribuído ou ativo como prestador, ou
-- ser o único administrador de uma empresa. Devolve o motivo ou null.
create function app.account_deletion_blocker(p_user_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from service_requests r
       where r.client_id = p_user_id
         and r.status in ('open', 'assigned', 'awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress')
    ) then 'client_request'
    when exists (
      select 1 from service_requests r
        join memberships m on m.id = r.provider_membership_id
       where m.user_id = p_user_id
         and r.status in ('assigned', 'awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress')
    ) then 'provider_request'
    when exists (
      select 1 from memberships a
       where a.user_id = p_user_id and a.role = 'admin' and a.active
         and not exists (
           select 1 from memberships o
            where o.company_id = a.company_id and o.role = 'admin' and o.active and o.user_id <> p_user_id
         )
    ) then 'sole_admin'
  end
$$;
--> statement-breakpoint
revoke all on function app.account_deletion_blocker(uuid) from public;
--> statement-breakpoint
grant execute on function app.account_deletion_blocker(uuid) to despacho_app;
--> statement-breakpoint
-- Exclui a conta: apaga os dados pessoais (nome, e-mail, telefone, endereço-base, aparelhos, sessões,
-- atualizações e convites pendentes), desativa os vínculos e deixa pedidos, mensagens e avaliações com o
-- autor "Usuário removido". Devolve o motivo do bloqueio, ou null quando excluiu.
create function app.delete_account(p_user_id uuid, p_email text, p_password_hash text, p_now timestamptz)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  blocker text;
  old_email text;
begin
  blocker := app.account_deletion_blocker(p_user_id);
  if blocker is not null then
    return blocker;
  end if;

  select email into old_email from users where id = p_user_id and deleted_at is null;
  if old_email is null then
    return 'not_found';
  end if;

  update provider_profiles set base_location = null, available = false
   where membership_id in (select id from memberships where user_id = p_user_id);
  update memberships set active = false where user_id = p_user_id;
  delete from device_tokens where user_id = p_user_id;
  delete from sessions where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from invites where lower(email) = lower(old_email) and accepted_at is null;
  update users
     set name = 'Usuário removido', email = p_email, phone = null, password_hash = p_password_hash, deleted_at = p_now
   where id = p_user_id;
  return null;
end
$$;
--> statement-breakpoint
revoke all on function app.delete_account(uuid, text, text, timestamptz) from public;
--> statement-breakpoint
grant execute on function app.delete_account(uuid, text, text, timestamptz) to despacho_app;
