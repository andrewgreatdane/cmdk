-- Resilience Systems admin — database schema
-- Access model: only emails listed in public.admins can read or write anything.

create extension if not exists pgcrypto;

create table if not exists public.admins (
  email text primary key,
  name  text not null
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create table if not exists public.settings (
  key   text primary key,
  value text not null
);

-- Capability sections of the master gear list
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.gear (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name        text not null,
  description text,
  source      text,
  url         text,
  price       numeric(10,2) not null default 0,   -- our cost, in `currency`
  currency    text not null default 'CAD' check (currency in ('CAD','USD')),
  price_est   boolean not null default false,
  sell_cad    numeric(10,2),                       -- null = cost × default markup
  volume_l    numeric(8,2),                        -- packed volume
  capacity_l  numeric(8,2),                        -- for cases/bags: what it holds
  volume_est  boolean not null default false,
  thumb       text,
  sort        int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists gear_category_idx on public.gear(category_id);

create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  household  text,
  location   text,
  status     text not null default 'Intake',
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_gear (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  gear_id     uuid not null references public.gear(id) on delete cascade,
  qty         int  not null default 1 check (qty > 0),
  sell_cad    numeric(10,2),                       -- per-unit override for this client
  created_at  timestamptz not null default now(),
  unique (customer_id, gear_id)
);
create index if not exists customer_gear_gear_idx on public.customer_gear(gear_id);

create table if not exists public.modules (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  duration_min int,
  links        jsonb not null default '[]'::jsonb,  -- [{label, url}]
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.customer_modules (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  module_id   uuid not null references public.modules(id) on delete cascade,
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (customer_id, module_id)
);
create index if not exists customer_modules_module_idx on public.customer_modules(module_id);

-- Row level security: admins only
do $$
declare t text;
begin
  foreach t in array array['settings','categories','gear','customers','customer_gear','modules','customer_modules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

alter table public.admins enable row level security;
drop policy if exists admin_read on public.admins;
create policy admin_read on public.admins for select to authenticated using ((select public.is_admin()));

revoke execute on function public.is_admin() from anon;
