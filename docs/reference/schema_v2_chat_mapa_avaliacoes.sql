-- =====================================================================
-- Migração v2: aceite mútuo, chat com fotos, localização ao vivo,
-- aviso de proximidade e avaliações dos dois lados.
-- Rodar depois de schema.sql.
-- IMPORTANTE: rode a seção 1 (alter type) sozinha e só depois o resto.
-- O Postgres não deixa usar um valor novo de enum na mesma transação em que ele foi criado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Novos status
--   aberto -> (prestador aceita) aguardando_cliente -> (cliente confirma) confirmado
--   -> a_caminho -> chegou -> em_execucao -> concluido
-- ---------------------------------------------------------------------
alter type request_status add value if not exists 'aguardando_cliente' after 'atribuido';
alter type request_status add value if not exists 'confirmado' after 'aguardando_cliente';
alter type request_status add value if not exists 'chegou' after 'em_deslocamento';
-- 'aceito' deixa de ser usado; 'em_deslocamento' passa a significar "a caminho".

alter table service_requests
  add column if not exists perto_notificado_em timestamptz,
  add column if not exists chegou_em timestamptz,
  add column if not exists raio_aviso_m int not null default 500;

-- ---------------------------------------------------------------------
-- 2. Recusas (os dois lados podem recusar)
-- ---------------------------------------------------------------------
create type decline_by as enum ('prestador', 'cliente');

create table request_declines (
  request_id   uuid not null references service_requests on delete cascade,
  company_id   uuid not null references companies on delete cascade,
  provider_id  uuid not null references profiles on delete cascade,
  recusado_por decline_by not null,
  motivo       text,
  created_at   timestamptz not null default now(),
  primary key (request_id, provider_id)
);

-- ---------------------------------------------------------------------
-- 3. Chat (texto + foto). A foto vai para o Storage, bucket 'chat-images',
--    no caminho {company_id}/{request_id}/{uuid}.jpg
-- ---------------------------------------------------------------------
create table messages (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies on delete cascade,
  request_id       uuid not null references service_requests on delete cascade,
  sender_id        uuid not null references profiles,
  body             text check (body is null or length(body) <= 2000),
  attachment_path  text,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  check (body is not null or attachment_path is not null)
);
create index on messages (request_id, created_at);

-- ---------------------------------------------------------------------
-- 4. Última posição do prestador em cada atendimento
--    (o app envia a cada ~10 s enquanto status = em_deslocamento;
--     o cliente escuta via Supabase Realtime)
-- ---------------------------------------------------------------------
create table provider_locations (
  request_id   uuid primary key references service_requests on delete cascade,
  company_id   uuid not null references companies on delete cascade,
  provider_id  uuid not null references profiles on delete cascade,
  localizacao  geography(Point, 4326) not null,
  heading      real,
  speed_mps    real,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Notas médias (prestador e cliente) a partir de reviews
-- ---------------------------------------------------------------------
create or replace view user_ratings with (security_invoker = true) as
select company_id, alvo_id as user_id,
       round(avg(nota)::numeric, 2) as media,
       count(*) as total
from reviews
group by company_id, alvo_id;

-- =====================================================================
-- Funções auxiliares
-- =====================================================================
create or replace function public.is_request_participant(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from service_requests r
    where r.id = rid
      and is_member(r.company_id)
      and (r.solicitante_id = auth.uid()
           or r.prestador_id = auth.uid()
           or has_role(r.company_id, array['admin', 'gestor']::member_role[]))
  )
$$;

-- =====================================================================
-- RPCs
-- =====================================================================

-- Prestador aceita (pedido aberto ou atribuído) ou recusa
create or replace function public.provider_respond(p_request_id uuid, p_aceitar boolean, p_motivo text default null)
returns service_requests
language plpgsql security definer set search_path = public as $$
declare
  r service_requests;
  v_old request_status;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found then raise exception 'Chamado não encontrado'; end if;
  if not has_role(r.company_id, array['prestador']::member_role[]) then raise exception 'Sem permissão'; end if;
  if exists (select 1 from request_declines where request_id = r.id and provider_id = auth.uid()) then
    raise exception 'Você já recusou ou foi recusado neste pedido';
  end if;

  v_old := r.status;

  if p_aceitar then
    if not (
      (r.status = 'aberto' and r.prestador_id is null
        and exists (select 1 from provider_categories pc
                    where pc.company_id = r.company_id and pc.user_id = auth.uid() and pc.category_id = r.category_id))
      or (r.status = 'atribuido' and r.prestador_id = auth.uid())
    ) then
      raise exception 'Este pedido não está mais disponível';
    end if;

    update service_requests set status = 'aguardando_cliente', prestador_id = auth.uid()
    where id = r.id returning * into r;
  else
    insert into request_declines (request_id, company_id, provider_id, recusado_por, motivo)
    values (r.id, r.company_id, auth.uid(), 'prestador', p_motivo);

    if r.status = 'atribuido' and r.prestador_id = auth.uid() then
      update service_requests set status = 'aberto', prestador_id = null
      where id = r.id returning * into r;
    end if;
  end if;

  insert into request_events (company_id, request_id, autor_id, status_anterior, status_novo, nota)
  values (r.company_id, r.id, auth.uid(), v_old, r.status, case when p_aceitar then 'prestador aceitou' else 'prestador recusou' end);
  return r;
end $$;

-- Cliente confirma ou recusa o prestador que aceitou
create or replace function public.client_respond(p_request_id uuid, p_aceitar boolean, p_motivo text default null)
returns service_requests
language plpgsql security definer set search_path = public as $$
declare
  r service_requests;
  v_prov uuid;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.solicitante_id <> auth.uid() then raise exception 'Chamado não encontrado'; end if;
  if r.status <> 'aguardando_cliente' then raise exception 'Não há prestador aguardando sua confirmação'; end if;

  v_prov := r.prestador_id;

  if p_aceitar then
    update service_requests set status = 'confirmado' where id = r.id returning * into r;
    insert into notifications (company_id, user_id, tipo, payload)
    values (r.company_id, v_prov, 'cliente_confirmou', jsonb_build_object('request_id', r.id));
  else
    insert into request_declines (request_id, company_id, provider_id, recusado_por, motivo)
    values (r.id, r.company_id, v_prov, 'cliente', p_motivo);
    update service_requests set status = 'aberto', prestador_id = null where id = r.id returning * into r;
    insert into notifications (company_id, user_id, tipo, payload)
    values (r.company_id, v_prov, 'cliente_recusou', jsonb_build_object('request_id', r.id));
    -- o trigger de notificação re-avisa os demais prestadores aptos (ver notify_request_change abaixo)
  end if;

  insert into request_events (company_id, request_id, autor_id, status_anterior, status_novo, nota)
  values (r.company_id, r.id, auth.uid(), 'aguardando_cliente', r.status,
          case when p_aceitar then 'cliente confirmou' else 'cliente recusou' end);
  return r;
end $$;

-- Avanço do atendimento pelo prestador
create or replace function public.provider_advance(p_request_id uuid) returns service_requests
language plpgsql security definer set search_path = public as $$
declare
  r service_requests;
  v_old request_status;
  v_new request_status;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.prestador_id <> auth.uid() then raise exception 'Chamado não encontrado'; end if;

  v_old := r.status;
  v_new := case r.status
    when 'confirmado'      then 'em_deslocamento'
    when 'em_deslocamento' then 'chegou'
    when 'chegou'          then 'em_execucao'
    when 'em_execucao'     then 'concluido'
  end;
  if v_new is null then raise exception 'Nada a avançar a partir de %', r.status; end if;

  update service_requests set
    status = v_new,
    chegou_em = case when v_new = 'chegou' then now() else chegou_em end,
    concluido_em = case when v_new = 'concluido' then now() else concluido_em end
  where id = r.id returning * into r;

  if v_new <> 'em_deslocamento' then
    delete from provider_locations where request_id = r.id;   -- para de expor a posição
  end if;

  insert into request_events (company_id, request_id, autor_id, status_anterior, status_novo)
  values (r.company_id, r.id, auth.uid(), v_old, v_new);
  return r;
end $$;

-- Posição do prestador + aviso de proximidade (uma vez por pedido)
create or replace function public.update_provider_location(
  p_request_id uuid, p_lat double precision, p_lng double precision,
  p_heading real default null, p_speed real default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r service_requests;
  v_pos geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_dist double precision;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.prestador_id <> auth.uid() or r.status <> 'em_deslocamento' then
    raise exception 'Localização só é aceita durante o deslocamento do prestador do pedido';
  end if;

  insert into provider_locations (request_id, company_id, provider_id, localizacao, heading, speed_mps, updated_at)
  values (r.id, r.company_id, auth.uid(), v_pos, p_heading, p_speed, now())
  on conflict (request_id) do update
    set localizacao = excluded.localizacao, heading = excluded.heading,
        speed_mps = excluded.speed_mps, updated_at = now();

  if r.localizacao is not null then
    v_dist := st_distance(v_pos, r.localizacao);
    if r.perto_notificado_em is null and v_dist <= r.raio_aviso_m then
      update service_requests set perto_notificado_em = now() where id = r.id;
      insert into notifications (company_id, user_id, tipo, payload)
      values (r.company_id, r.solicitante_id, 'prestador_perto',
              jsonb_build_object('request_id', r.id, 'distancia_m', round(v_dist)));
    end if;
  end if;

  return jsonb_build_object('distancia_m', round(v_dist));
end $$;

-- =====================================================================
-- Triggers
-- =====================================================================

-- Mensagem nova -> notificação para o outro participante
create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r service_requests;
  v_to uuid;
begin
  select * into r from service_requests where id = new.request_id;
  v_to := case when new.sender_id = r.solicitante_id then r.prestador_id else r.solicitante_id end;
  if v_to is not null then
    insert into notifications (company_id, user_id, tipo, payload)
    values (new.company_id, v_to, 'mensagem',
            jsonb_build_object('request_id', new.request_id, 'message_id', new.id,
                               'tem_foto', new.attachment_path is not null));
  end if;
  return new;
end $$;

create trigger messages_notify after insert on messages
  for each row execute function public.notify_new_message();

-- Substitui o trigger da v1: avisa o cliente em cada etapa e
-- re-avisa prestadores aptos quando o pedido volta para 'aberto'.
create or replace function public.notify_request_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_modo assignment_mode;
begin
  select modo_atribuicao into v_modo from companies where id = new.company_id;

  if tg_op = 'INSERT' then
    insert into notifications (company_id, user_id, tipo, payload)
    select new.company_id, m.user_id, 'novo_chamado', jsonb_build_object('request_id', new.id, 'titulo', new.titulo)
    from memberships m
    where m.company_id = new.company_id and m.ativo and m.role in ('admin', 'gestor');
  end if;

  if new.status = 'aberto' and v_modo = 'broadcast'
     and (tg_op = 'INSERT' or old.status is distinct from 'aberto') then
    insert into notifications (company_id, user_id, tipo, payload)
    select new.company_id, pc.user_id, 'oportunidade', jsonb_build_object('request_id', new.id, 'titulo', new.titulo)
    from provider_categories pc
    join memberships m on m.company_id = pc.company_id and m.user_id = pc.user_id and m.role = 'prestador' and m.ativo
    join provider_profiles pp on pp.company_id = pc.company_id and pp.user_id = pc.user_id and pp.disponivel
    where pc.company_id = new.company_id
      and pc.category_id = new.category_id
      and not exists (select 1 from request_declines d where d.request_id = new.id and d.provider_id = pc.user_id)
      and (new.localizacao is null or pp.localizacao is null
           or st_dwithin(pp.localizacao, new.localizacao, pp.raio_km * 1000));
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'atribuido' and new.prestador_id is not null then
      insert into notifications (company_id, user_id, tipo, payload)
      values (new.company_id, new.prestador_id, 'chamado_atribuido', jsonb_build_object('request_id', new.id, 'titulo', new.titulo));
    end if;
    if new.status in ('aguardando_cliente', 'em_deslocamento', 'chegou', 'em_execucao', 'concluido') then
      insert into notifications (company_id, user_id, tipo, payload)
      values (new.company_id, new.solicitante_id, 'status_alterado',
              jsonb_build_object('request_id', new.id, 'status', new.status, 'prestador_id', new.prestador_id));
    end if;
  end if;

  return new;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table request_declines   enable row level security;
alter table messages           enable row level security;
alter table provider_locations enable row level security;

-- Pedido em broadcast não aparece para quem recusou ou foi recusado
drop policy if exists requests_select on service_requests;
create policy requests_select on service_requests for select using (
  has_role(company_id, array['admin', 'gestor']::member_role[])
  or (solicitante_id = auth.uid() and is_member(company_id))
  or (prestador_id = auth.uid() and is_member(company_id))
  or (status = 'aberto'
      and has_role(company_id, array['prestador']::member_role[])
      and exists (select 1 from companies c where c.id = company_id and c.modo_atribuicao = 'broadcast')
      and exists (select 1 from provider_categories pc
                  where pc.company_id = service_requests.company_id
                    and pc.user_id = auth.uid()
                    and pc.category_id = service_requests.category_id)
      and not exists (select 1 from request_declines d
                      where d.request_id = service_requests.id and d.provider_id = auth.uid()))
);

create policy declines_select on request_declines for select
  using (provider_id = auth.uid() or has_role(company_id, array['admin', 'gestor']::member_role[]));

-- Chat: só cliente, prestador do pedido e admin/gestor leem; só os dois participantes escrevem
create policy messages_select on messages for select using (is_request_participant(request_id));
create policy messages_insert on messages for insert with check (
  sender_id = auth.uid()
  and exists (
    select 1 from service_requests r
    where r.id = request_id
      and r.company_id = messages.company_id
      and (r.solicitante_id = auth.uid() or r.prestador_id = auth.uid())
      and r.status in ('aguardando_cliente', 'confirmado', 'em_deslocamento', 'chegou', 'em_execucao')
  )
);
create policy messages_mark_read on messages for update
  using (is_request_participant(request_id) and sender_id <> auth.uid());

-- Localização: só o cliente do pedido e admin/gestor veem; escrita só pela RPC
create policy locations_select on provider_locations for select using (
  exists (select 1 from service_requests r
          where r.id = request_id
            and (r.solicitante_id = auth.uid()
                 or has_role(r.company_id, array['admin', 'gestor']::member_role[])))
  or provider_id = auth.uid()
);

-- Avaliação: cada lado avalia o outro uma vez, depois de concluído (policy da v1 já cobre)

-- =====================================================================
-- Storage: fotos do chat
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

create policy chat_images_read on storage.objects for select
  using (bucket_id = 'chat-images'
         and is_request_participant(((storage.foldername(name))[2])::uuid));

create policy chat_images_upload on storage.objects for insert
  with check (bucket_id = 'chat-images'
              and owner = auth.uid()
              and is_request_participant(((storage.foldername(name))[2])::uuid));

-- =====================================================================
-- Realtime: o app escuta essas tabelas
-- =====================================================================
alter publication supabase_realtime add table messages, provider_locations, notifications, service_requests;
