-- 002: onboarding (household members), schedule (tasks), map (customer coordinates)
alter table public.customers
  add column if not exists address text,
  add column if not exists home text,
  add column if not exists vehicles text,
  add column if not exists pets text,
  add column if not exists emergency_contacts text,
  add column if not exists lat double precision,
  add column if not exists lng double precision;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null, relationship text, birth_year int, sex text,
  height text, weight text, size_top text, size_bottom text, size_shoe text, size_other text,
  blood_type text, allergies text, medical text, medications text, diet text, mobility text, notes text,
  sort int not null default 0,
  created_at timestamptz not null default now());
create index if not exists members_customer_idx on public.members(customer_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  kind text not null default 'Other', title text, due_date date not null,
  assignee text, notes text, done_at timestamptz,
  created_at timestamptz not null default now());
create index if not exists tasks_customer_idx on public.tasks(customer_id);
create index if not exists tasks_due_idx on public.tasks(due_date);

do $$ declare t text; begin
  foreach t in array array['members','tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop; end $$;
