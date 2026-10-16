-- =====================================================================
-- Plataforma de serviços multi-tenant (Supabase / Postgres)
-- Cada empresa (tenant) tem seus próprios usuários, categorias e chamados.
-- Isolamento garantido por Row Level Security (RLS) via company_id.
-- =====================================================================

create extension if not exists postgis;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type member_role      as enum ('admin', 'gestor', 'solicitante', 'prestador');
create type assignment_mode  as enum ('manual', 'broadcast');
create type request_status   as enum ('aberto', 'atribuido', 'aceito', 'em_deslocamento',
                                      'em_execucao', 'concluido', 'cancelado');
create type request_priority as enum ('baixa', 'media', 'alta', 'urgente');

-- ---------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------
create table companies (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  slug             text not null unique,
  plano            text not null default 'basico',
  modo_atribuicao  assignment_mode not null default 'manual',
  ativo            boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Perfil global da pessoa (1 por login). O vínculo com empresas fica em memberships.
create table profiles (
  id                 uuid primary key references auth.users on delete cascade,
  nome               text not null,
  telefone           text,
  is_platform_admin  boolean not null default false,  -- dono da plataforma (você)
  created_at         timestamptz not null default now()
);

-- Vínculo usuário <-> empresa. Uma pessoa pode estar em mais de uma empresa
-- (ex.: prestador terceirizado que atende duas empresas).
create table memberships (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies on delete cascade,
  user_id        uuid not null references profiles on delete cascade,
  role           member_role not null,
  ativo          boolean not null default true,
  convidado_por  uuid references profiles,
  created_at     timestamptz not null default now(),
  unique (company_id, user_id)
);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies on delete cascade,
  email       text not null,
  role        member_role not null,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  expira_em   timestamptz not null default now() + interval '7 days',
  aceito_em   timestamptz,
  criado_por  uuid not null references profiles,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Catálogo e prestadores (por empresa)
-- ---------------------------------------------------------------------
create table categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies on delete cascade,
  nome        text not null,
  sla_horas   int,
  ativo       boolean not null default true,
  unique (company_id, nome)
);

create table provider_profiles (
  company_id   uuid not null references companies on delete cascade,
  user_id      uuid not null references profiles on delete cascade,
  localizacao  geography(Point, 4326),
  raio_km      numeric not null default 20,
  disponivel   boolean not null default true,
  primary key (company_id, user_id)
);

create table provider_categories (
  company_id   uuid not null references companies on delete cascade,
  user_id      uuid not null references profiles on delete cascade,
  category_id  uuid not null references categories on delete cascade,
  primary key (company_id, user_id, category_id)
);

-- ---------------------------------------------------------------------
-- Chamados
-- ---------------------------------------------------------------------
create table service_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies on delete cascade,
  solicitante_id  uuid not null references profiles,
  prestador_id    uuid references profiles,
  category_id     uuid not null references categories,
  titulo          text not null,
  descricao       text,
  endereco        text,
  localizacao     geography(Point, 4326),
  prioridade      request_priority not null default 'media',
  status          request_status not null default 'aberto',
  prazo_sla       timestamptz,
  atribuido_por   uuid references profiles,
  concluido_em    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Histórico/auditoria de cada mudança
create table request_events (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies on delete cascade,
  request_id       uuid not null references service_requests on delete cascade,
  autor_id         uuid references profiles,
  status_anterior  request_status,
  status_novo      request_status not null,
  nota             text,
  created_at       timestamptz not null default now()
);

create table reviews (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies on delete cascade,
  request_id  uuid not null references service_requests on delete cascade,
  autor_id    uuid not null references profiles,
  alvo_id     uuid not null references profiles,
  nota        smallint not null check (nota between 1 and 5),
  comentario  text,
  created_at  timestamptz not null default now(),
  unique (request_id, autor_id)
);

-- ---------------------------------------------------------------------
-- Notificações / push
-- ---------------------------------------------------------------------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies on delete cascade,
  user_id     uuid not null references profiles on delete cascade,
  tipo        text not null,
  payload     jsonb not null default '{}',
  lida_em     timestamptz,
  created_at  timestamptz not null default now()
);

create table device_tokens (
  token       text primary key,
  user_id     uuid not null references profiles on delete cascade,
  plataforma  text not null check (plataforma in ('android', 'ios', 'web')),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
create index on memberships (user_id);
create index on service_requests (company_id, status);
create index on service_requests (prestador_id);
create index on service_requests (solicitante_id);
create index on service_requests using gist (localizacao);
create index on provider_profiles using gist (localizacao);
create index on provider_categories (company_id, category_id);
create index on request_events (request_id);
create index on notifications (user_id, lida_em);

-- =====================================================================
-- Funções auxiliares de acesso (security definer evita recursão no RLS)
-- =====================================================================
create or replace function public.my_role(cid uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select m.role
  from memberships m
  join companies c on c.id = m.company_id
  where m.company_id = cid
    and m.user_id = auth.uid()
    and m.ativo
    and c.ativo
$$;

create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role(cid) is not null
$$;

create or replace function public.has_role(cid uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(cid) = any(roles), false)
$$;

create or replace function public.shares_company(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships a
    join memberships b on b.company_id = a.company_id
    where a.user_id = auth.uid() and a.ativo
      and b.user_id = other
  )
$$;

-- =====================================================================
-- Triggers
-- =====================================================================

-- Cria o profile quando alguém se registra no Supabase Auth
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nome, telefone)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
          new.raw_user_meta_data->>'telefone');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger service_requests_updated_at
  before update on service_requests
  for each row execute function public.touch_updated_at();

-- Gera notificações (uma Edge Function escuta inserts em notifications e envia o push FCM)
create or replace function public.notify_request_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_modo assignment_mode;
begin
  select modo_atribuicao into v_modo from companies where id = new.company_id;

  if tg_op = 'INSERT' then
    -- Admins e gestores sempre ficam sabendo de chamados novos
    insert into notifications (company_id, user_id, tipo, payload)
    select new.company_id, m.user_id, 'novo_chamado',
           jsonb_build_object('request_id', new.id, 'titulo', new.titulo)
    from memberships m
    where m.company_id = new.company_id and m.ativo and m.role in ('admin', 'gestor');

    -- Modo broadcast: avisa prestadores aptos (categoria + disponível + dentro do raio)
    if v_modo = 'broadcast' then
      insert into notifications (company_id, user_id, tipo, payload)
      select new.company_id, pc.user_id, 'oportunidade',
             jsonb_build_object('request_id', new.id, 'titulo', new.titulo)
      from provider_categories pc
      join memberships m on m.company_id = pc.company_id and m.user_id = pc.user_id
                        and m.role = 'prestador' and m.ativo
      join provider_profiles pp on pp.company_id = pc.company_id and pp.user_id = pc.user_id
                               and pp.disponivel
      where pc.company_id = new.company_id
        and pc.category_id = new.category_id
        and (new.localizacao is null or pp.localizacao is null
             or st_dwithin(pp.localizacao, new.localizacao, pp.raio_km * 1000));
    end if;

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'atribuido' and new.prestador_id is not null then
      insert into notifications (company_id, user_id, tipo, payload)
      values (new.company_id, new.prestador_id, 'chamado_atribuido',
              jsonb_build_object('request_id', new.id, 'titulo', new.titulo));
    end if;

    insert into notifications (company_id, user_id, tipo, payload)
    values (new.company_id, new.solicitante_id, 'status_alterado',
            jsonb_build_object('request_id', new.id, 'status', new.status));
  end if;

  return new;
end $$;

create trigger service_requests_notify
  after insert or update on service_requests
  for each row execute function public.notify_request_change();

-- =====================================================================
-- RPCs (regras de negócio que não cabem em RLS)
-- =====================================================================

-- Aceitar convite: cria o vínculo do usuário logado com a empresa
create or replace function public.accept_invite(p_token text) returns memberships
language plpgsql security definer set search_path = public as $$
declare
  i invites;
  m memberships;
begin
  select * into i from invites
  where token = p_token and aceito_em is null and expira_em > now()
  for update;

  if not found then raise exception 'Convite inválido ou expirado'; end if;
  if lower(i.email) <> lower(auth.jwt()->>'email') then
    raise exception 'Este convite é para outro e-mail';
  end if;

  insert into memberships (company_id, user_id, role, convidado_por)
  values (i.company_id, auth.uid(), i.role, i.criado_por)
  on conflict (company_id, user_id)
    do update set role = excluded.role, ativo = true
  returning * into m;

  if i.role = 'prestador' then
    insert into provider_profiles (company_id, user_id)
    values (i.company_id, auth.uid())
    on conflict do nothing;
  end if;

  update invites set aceito_em = now() where id = i.id;
  return m;
end $$;

-- Atribuir chamado a um prestador (admin/gestor)
create or replace function public.assign_request(p_request_id uuid, p_prestador_id uuid)
returns service_requests
language plpgsql security definer set search_path = public as $$
declare
  r service_requests;
  v_old request_status;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found then raise exception 'Chamado não encontrado'; end if;

  if not has_role(r.company_id, array['admin', 'gestor']::member_role[]) then
    raise exception 'Sem permissão';
  end if;
  if r.status not in ('aberto', 'atribuido') then
    raise exception 'Chamado já está em andamento (%)', r.status;
  end if;
  if not exists (select 1 from memberships
                 where company_id = r.company_id and user_id = p_prestador_id
                   and role = 'prestador' and ativo) then
    raise exception 'Prestador inválido para esta empresa';
  end if;

  v_old := r.status;
  update service_requests
     set prestador_id = p_prestador_id, status = 'atribuido', atribuido_por = auth.uid()
   where id = r.id
  returning * into r;

  insert into request_events (company_id, request_id, autor_id, status_anterior, status_novo)
  values (r.company_id, r.id, auth.uid(), v_old, r.status);

  return r;
end $$;

-- Mudança de status com validação de transição por papel
create or replace function public.change_request_status(
  p_request_id uuid,
  p_novo request_status,
  p_nota text default null
) returns service_requests
language plpgsql security definer set search_path = public as $$
declare
  r      service_requests;
  v_role member_role;
  v_old  request_status;
  v_modo assignment_mode;
  v_ok   boolean := false;
  v_tr   text;
begin
  -- "for update" trava a linha: se dois prestadores tentarem pegar o mesmo
  -- chamado ao mesmo tempo, o segundo verá que já foi aceito.
  select * into r from service_requests where id = p_request_id for update;
  if not found then raise exception 'Chamado não encontrado'; end if;

  v_role := my_role(r.company_id);
  if v_role is null then raise exception 'Sem acesso'; end if;

  select modo_atribuicao into v_modo from companies where id = r.company_id;
  v_old := r.status;
  v_tr  := r.status::text || '>' || p_novo::text;

  if v_role in ('admin', 'gestor') then
    v_ok := true;

  elsif v_role = 'prestador' then
    v_ok :=
      -- pegar um chamado aberto (somente modo broadcast e se atende a categoria)
      (v_tr = 'aberto>aceito' and v_modo = 'broadcast' and r.prestador_id is null
        and exists (select 1 from provider_categories pc
                    where pc.company_id = r.company_id and pc.user_id = auth.uid()
                      and pc.category_id = r.category_id))
      -- fluxo do chamado atribuído a ele
      or (r.prestador_id = auth.uid() and v_tr in (
            'atribuido>aceito', 'atribuido>aberto',          -- aceitar / recusar
            'aceito>em_deslocamento', 'em_deslocamento>em_execucao',
            'em_execucao>concluido'));

  elsif v_role = 'solicitante' then
    v_ok := r.solicitante_id = auth.uid()
            and r.status in ('aberto', 'atribuido')
            and p_novo = 'cancelado';
  end if;

  if not v_ok then
    raise exception 'Transição % -> % não permitida para %', r.status, p_novo, v_role;
  end if;

  update service_requests set
    status = p_novo,
    prestador_id = case
      when v_tr = 'aberto>aceito' and v_role = 'prestador' then auth.uid()
      when p_novo = 'aberto' then null              -- recusa devolve para a fila
      else prestador_id end,
    concluido_em = case when p_novo = 'concluido' then now() else concluido_em end
  where id = r.id
  returning * into r;

  insert into request_events (company_id, request_id, autor_id, status_anterior, status_novo, nota)
  values (r.company_id, r.id, auth.uid(), v_old, p_novo, p_nota);

  return r;
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table companies           enable row level security;
alter table profiles            enable row level security;
alter table memberships         enable row level security;
alter table invites             enable row level security;
alter table categories          enable row level security;
alter table provider_profiles   enable row level security;
alter table provider_categories enable row level security;
alter table service_requests    enable row level security;
alter table request_events      enable row level security;
alter table reviews             enable row level security;
alter table notifications       enable row level security;
alter table device_tokens       enable row level security;

-- companies: membros veem a própria empresa; admin edita
create policy companies_select on companies for select using (is_member(id));
create policy companies_update on companies for update
  using (has_role(id, array['admin']::member_role[]));

-- profiles: a própria pessoa + quem está na mesma empresa
create policy profiles_select on profiles for select
  using (id = auth.uid() or shares_company(id));
create policy profiles_update on profiles for update using (id = auth.uid());

-- memberships: cada um vê o seu; admin/gestor veem todos da empresa; só admin altera
create policy memberships_select on memberships for select
  using (user_id = auth.uid()
         or has_role(company_id, array['admin', 'gestor']::member_role[]));
create policy memberships_admin on memberships for all
  using (has_role(company_id, array['admin']::member_role[]))
  with check (has_role(company_id, array['admin']::member_role[]));

-- invites: só admin
create policy invites_admin on invites for all
  using (has_role(company_id, array['admin']::member_role[]))
  with check (has_role(company_id, array['admin']::member_role[]) and criado_por = auth.uid());

-- categories: membros leem, admin gerencia
create policy categories_select on categories for select using (is_member(company_id));
create policy categories_admin on categories for all
  using (has_role(company_id, array['admin']::member_role[]))
  with check (has_role(company_id, array['admin']::member_role[]));

-- provider_profiles: o próprio prestador e admin/gestor
create policy provider_profiles_select on provider_profiles for select
  using (user_id = auth.uid()
         or has_role(company_id, array['admin', 'gestor']::member_role[]));
create policy provider_profiles_self on provider_profiles for update
  using (user_id = auth.uid() and is_member(company_id));
create policy provider_profiles_admin on provider_profiles for all
  using (has_role(company_id, array['admin']::member_role[]))
  with check (has_role(company_id, array['admin']::member_role[]));

-- provider_categories: membros leem, admin define quem atende o quê
create policy provider_categories_select on provider_categories for select
  using (is_member(company_id));
create policy provider_categories_admin on provider_categories for all
  using (has_role(company_id, array['admin']::member_role[]))
  with check (has_role(company_id, array['admin']::member_role[]));

-- service_requests
create policy requests_select on service_requests for select using (
  has_role(company_id, array['admin', 'gestor']::member_role[])
  or (solicitante_id = auth.uid() and is_member(company_id))
  or (prestador_id = auth.uid() and is_member(company_id))
  -- modo broadcast: prestador vê chamados abertos das categorias que atende
  or (status = 'aberto'
      and has_role(company_id, array['prestador']::member_role[])
      and exists (select 1 from companies c
                  where c.id = company_id and c.modo_atribuicao = 'broadcast')
      and exists (select 1 from provider_categories pc
                  where pc.company_id = service_requests.company_id
                    and pc.user_id = auth.uid()
                    and pc.category_id = service_requests.category_id))
);

create policy requests_insert on service_requests for insert with check (
  has_role(company_id, array['solicitante', 'admin', 'gestor']::member_role[])
  and solicitante_id = auth.uid()
  and status = 'aberto'
  and prestador_id is null
);

-- Edição direta só para admin/gestor; status muda via change_request_status / assign_request
create policy requests_update on service_requests for update
  using (has_role(company_id, array['admin', 'gestor']::member_role[]));

-- request_events: visível para quem vê o chamado (o RLS de service_requests se aplica no subselect)
create policy events_select on request_events for select
  using (exists (select 1 from service_requests r where r.id = request_id));

-- reviews
create policy reviews_select on reviews for select using (is_member(company_id));
create policy reviews_insert on reviews for insert with check (
  autor_id = auth.uid()
  and exists (
    select 1 from service_requests r
    where r.id = request_id
      and r.company_id = reviews.company_id
      and r.status = 'concluido'
      and ((r.solicitante_id = auth.uid() and r.prestador_id = alvo_id)
        or (r.prestador_id  = auth.uid() and r.solicitante_id = alvo_id))
  )
);

-- notifications e device_tokens: só o dono
create policy notifications_own on notifications for select using (user_id = auth.uid());
create policy notifications_mark_read on notifications for update using (user_id = auth.uid());
create policy device_tokens_own on device_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
