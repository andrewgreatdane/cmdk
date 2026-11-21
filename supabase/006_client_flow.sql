-- 006: client flow. Pipeline stage and milestone dates, packing list tracking and sign-off,
-- training completion per person, assessment notes. All additive.
alter table public.customers
  add column if not exists stage text not null default 'Lead'
    check (stage in ('Lead','Call','Assessment','Spec sent','Accepted','Building','Delivered','Trained','Member')),
  add column if not exists called_on date,
  add column if not exists assessed_on date,
  add column if not exists spec_sent_on date,
  add column if not exists spec_accepted_on date,
  add column if not exists deposit_paid_on date,
  add column if not exists build_signed_off_by text,
  add column if not exists build_signed_off_at timestamptz,
  add column if not exists delivered_on date,
  add column if not exists accepted_by text,
  add column if not exists final_paid_on date,
  add column if not exists trained_on date,
  add column if not exists renewal_due date generated always as ((delivered_on + interval '1 year')::date) stored;

alter table public.customer_gear
  add column if not exists member_id uuid references public.members(id) on delete set null,
  add column if not exists ordered_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists packed_at timestamptz,
  add column if not exists checked_by text,
  add column if not exists checked_at timestamptz;
create index if not exists customer_gear_member_id_idx on public.customer_gear(member_id);

create table if not exists public.customer_module_completions (
  id uuid primary key default gen_random_uuid(),
  customer_module_id uuid not null references public.customer_modules(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  completed_at timestamptz not null default now(),
  signed_off_by text,
  created_at timestamptz not null default now(),
  unique (customer_module_id, member_id)
);
create index if not exists customer_module_completions_member_id_idx on public.customer_module_completions(member_id);
alter table public.customer_module_completions enable row level security;
drop policy if exists admin_all on public.customer_module_completions;
create policy admin_all on public.customer_module_completions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create table if not exists public.assessment_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  area text,
  need text not null,
  reason text,
  sort integer not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists assessment_notes_customer_id_idx on public.assessment_notes(customer_id);
alter table public.assessment_notes enable row level security;
drop policy if exists admin_all on public.assessment_notes;
create policy admin_all on public.assessment_notes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
