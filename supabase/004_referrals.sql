-- 004: referrals (one free membership year per referred customer who signs on)
alter table public.customers add column if not exists referred_by uuid references public.customers(id) on delete set null;
create index if not exists customers_referred_by_idx on public.customers(referred_by);
