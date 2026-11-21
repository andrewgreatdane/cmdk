-- 007: editable questionnaire. Questions live in a table the admin edits; the public intake form
-- reads them. Per-person answers that are not fixed columns are kept in members.answers.
-- No medical conditions, medication names, allergies or blood type are collected or stored.
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'household' check (scope in ('household','person')),
  section text,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  label text not null,
  help text,
  kind text not null default 'text' check (kind in ('text','longtext','choice','multi','yesno')),
  options jsonb not null default '[]'::jsonb,
  show_if_key text,
  show_if_value text,
  sort integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (scope, key)
);
alter table public.questions enable row level security;
drop policy if exists admin_all on public.questions;
create policy admin_all on public.questions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- the public form needs to read the current questions; they hold no client data
drop policy if exists public_read on public.questions;
create policy public_read on public.questions for select to anon using (not archived);

alter table public.members add column if not exists answers jsonb not null default '{}'::jsonb;

-- Save a submitted questionnaire. Replaces intake_submit for the question-driven form.
create or replace function public.intake_submit_v2(p_token uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  cid uuid; c jsonb := coalesce(p->'customer', '{}'::jsonb); m jsonb; i int := 0;
  fixed text[] := array['name','relationship','birth_year','sex','height','weight','size_top','size_bottom','size_shoe','size_other','diet','mobility','notes'];
  never text[] := array['blood_type','allergies','medical','medications','id','customer_id','sort','created_at','answers'];
begin
  if octet_length(p::text) > 200000 then raise exception 'too large'; end if;
  if p_token is not null then
    select id into cid from public.customers where intake_token = p_token;
    if cid is null then raise exception 'invalid link'; end if;
  end if;
  if coalesce(trim(c->>'name'), '') = '' then raise exception 'name required'; end if;
  if jsonb_array_length(coalesce(p->'members', '[]'::jsonb)) > 25 then raise exception 'too many people'; end if;

  if cid is null then
    insert into public.customers (name, status, intake_token) values (left(trim(c->>'name'), 200), 'Intake', gen_random_uuid()) returning id into cid;
  end if;

  -- a question that is no longer asked leaves whatever the team already recorded untouched
  update public.customers set
    name = left(trim(c->>'name'), 200),
    email = left(nullif(trim(c->>'email'), ''), 200),
    phone = left(nullif(trim(c->>'phone'), ''), 60),
    address = case when c ? 'address' then left(nullif(trim(c->>'address'), ''), 400) else address end,
    location = coalesce(location, left(nullif(trim(c->>'city'), ''), 120)),
    home = case when c ? 'home' then left(nullif(trim(c->>'home'), ''), 2000) else home end,
    vehicles = case when c ? 'vehicles' then left(nullif(trim(c->>'vehicles'), ''), 2000) else vehicles end,
    pets = case when c ? 'pets' then left(nullif(trim(c->>'pets'), ''), 2000) else pets end,
    emergency_contacts = case when c ? 'emergency_contacts' then left(nullif(trim(c->>'emergency_contacts'), ''), 2000) else emergency_contacts end,
    household = left(nullif(trim(c->>'household'), ''), 200),
    intake = coalesce(p->'intake', '{}'::jsonb),
    intake_submitted_at = now(),
    lat = case when c ? 'address' then null else lat end,
    lng = case when c ? 'address' then null else lng end
  where id = cid;

  delete from public.members where customer_id = cid;
  for m in select * from jsonb_array_elements(coalesce(p->'members', '[]'::jsonb)) loop
    if coalesce(trim(m->>'name'), '') <> '' then
      insert into public.members (customer_id, sort, name, relationship, birth_year, sex, height, weight,
        size_top, size_bottom, size_shoe, size_other, diet, mobility, notes, answers)
      values (cid, i, left(trim(m->>'name'), 200), left(m->>'relationship', 100),
        case when (m->>'birth_year') ~ '^\d{4}$' then (m->>'birth_year')::int end,
        left(m->>'sex', 20), left(m->>'height', 40), left(m->>'weight', 40),
        left(m->>'size_top', 40), left(m->>'size_bottom', 40), left(m->>'size_shoe', 40), left(m->>'size_other', 80),
        left(m->>'diet', 500), left(m->>'mobility', 500), left(m->>'notes', 2000),
        (m - fixed) - never);
      i := i + 1;
    end if;
  end loop;
  return cid;
end $$;
revoke all on function public.intake_submit_v2(uuid, jsonb) from public;
grant execute on function public.intake_submit_v2(uuid, jsonb) to anon, authenticated;

insert into public.questions (scope,section,key,label,kind,help,options,show_if_key,show_if_value,sort) values
('household','Contact','address','Home address','text','Street, city, province','[]'::jsonb,null,null,0),
('household','Contact','city','City','text',null,'[]'::jsonb,null,null,1),
('household','Contact','contact_pref','Best way to reach you','choice',null,'["Phone", "Text", "Email"]'::jsonb,null,null,2),
('household','Home & logistics','home','Home','longtext','Type of home, floors, basement, generator, where things could be stored','[]'::jsonb,null,null,3),
('household','Home & logistics','vehicles','Vehicles','text','Make, model, year','[]'::jsonb,null,null,4),
('household','Home & logistics','has_pets','Do you have pets?','yesno',null,'[]'::jsonb,null,null,5),
('household','Home & logistics','pets','Pets','text','Type, size, any needs','[]'::jsonb,'has_pets','Yes',6),
('household','Home & logistics','has_children','Do children under 18 live with you?','yesno',null,'[]'::jsonb,null,null,7),
('household','Home & logistics','children_weekday','Where are the children on a weekday?','longtext','School or daycare, and the area it is in','[]'::jsonb,'has_children','Yes',8),
('household','Home & logistics','other_locations','Other locations','text','Office, cabin, a parent''s home','[]'::jsonb,null,null,9),
('household','Home & logistics','emergency_contacts','Emergency contacts outside the household','longtext','Name, relationship, phone. One per line.','[]'::jsonb,null,null,10),
('household','What concerns you most','concerns','What concerns you most','multi','Choose any that apply.','["Earthquake", "Extended power outage", "Wildfire or smoke", "Flooding or storms", "Civil unrest", "Evacuating quickly", "Staying in place for weeks", "Medical emergency", "Losing phone and internet", "Security at home", "Being apart when it happens", "Pandemic"]'::jsonb,null,null,11),
('household','What concerns you most','timeline','When would you like to be ready?','choice',null,'["As soon as possible", "Within 3 months", "Within 6 months", "No fixed timeline"]'::jsonb,null,null,12),
('household','What concerns you most','referral','How did you hear about us?','text',null,'[]'::jsonb,null,null,13),
('household','What concerns you most','notes','Anything else we should know','longtext','Past emergencies, skills in the household, travel, anything that matters to you','[]'::jsonb,null,null,14),
('person',null,'relationship','Relationship to you','text','Self, spouse, son…','[]'::jsonb,null,null,15),
('person',null,'birth_year','Year born','text','1984','[]'::jsonb,null,null,16),
('person',null,'sex','Sex','choice',null,'["Female", "Male", "Other"]'::jsonb,null,null,17),
('person',null,'lives','Where they live','choice',null,'["Same house", "Same city", "Different city"]'::jsonb,null,null,18),
('person',null,'distance','Approximate distance from the main home','text','e.g. 4 km, 2 hours by car','[]'::jsonb,'lives','Same city|Different city',19),
('person',null,'height','Height','text',null,'[]'::jsonb,null,null,20),
('person',null,'weight','Weight','text',null,'[]'::jsonb,null,null,21),
('person',null,'size_top','Top / jacket size','text',null,'[]'::jsonb,null,null,22),
('person',null,'size_bottom','Pants size (waist × inseam)','text',null,'[]'::jsonb,null,null,23),
('person',null,'size_shoe','Shoe size','text',null,'[]'::jsonb,null,null,24),
('person',null,'size_other','Gloves / hat size','text',null,'[]'::jsonb,null,null,25),
('person',null,'diet','Diet','text','Restrictions, infant formula…','[]'::jsonb,null,null,26),
('person',null,'mobility','Mobility / other needs','text','Glasses, hearing aid, wheelchair…','[]'::jsonb,null,null,27),
('person',null,'med_storage','Medicine storage needs','text','Storage only, no names. e.g. Medicine A: refrigeration','[]'::jsonb,null,null,28),
('person',null,'notes','Skills & notes','longtext','First aid training, radio licence, anything useful','[]'::jsonb,null,null,29)
on conflict (scope, key) do nothing;
