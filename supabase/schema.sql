-- ═══════════════════════════════════════════════════════════════════════
--  StarSeed · Evento Manifiesto · Supabase Schema
--  Ejecutar en: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- Tabla principal de participantes registrados
create table if not exists public.tickets (
  id              bigint generated always as identity primary key,
  node_id         text unique not null,          -- SS-XXX-XXXX-XXXX-XX
  name            text not null,
  email           text not null,
  whatsapp        text,
  comment         text,
  role_id         text not null,
  role_label      text,
  frame_file      text,
  frame_category  text,
  colors          jsonb,
  -- Donación
  don_amount      numeric(10,2) default 0,
  don_method      text,                          -- card | spei | cash | promo
  don_status      text default 'pending',        -- paid | pending | pending_event | pending_mp
  don_txn_id      text,
  don_promo       text,
  -- Metadata
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Índices útiles para el panel admin
create index if not exists tickets_email_idx   on public.tickets (email);
create index if not exists tickets_status_idx  on public.tickets (don_status);
create index if not exists tickets_created_idx on public.tickets (created_at desc);

-- Row Level Security: inserción pública (anon puede insertar),
-- lectura y modificación sólo para service_role / dashboard
alter table public.tickets enable row level security;

create policy "allow_insert_anon"
  on public.tickets for insert
  to anon
  with check (true);

create policy "allow_select_service"
  on public.tickets for select
  to service_role
  using (true);

create policy "allow_update_service"
  on public.tickets for update
  to service_role
  using (true);

-- Trigger para updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tickets_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

-- Vista de estadísticas rápidas para el dashboard
create or replace view public.tickets_stats as
select
  count(*)                                           as total,
  count(*) filter (where don_status = 'paid')        as paid,
  count(*) filter (where don_status = 'pending')     as pending_spei,
  count(*) filter (where don_status = 'pending_event') as pending_cash,
  count(*) filter (where don_status = 'pending_mp')  as pending_mp,
  sum(don_amount) filter (where don_status = 'paid') as total_collected,
  250 - count(*)                                     as cupo_restante
from public.tickets;
