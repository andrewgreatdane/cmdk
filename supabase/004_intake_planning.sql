-- 004: intake planning fields
-- Per-person resilience duration lives on members. Extended family, dependencies and
-- capability modules (with the client's own cost guess) live in customers.intake (jsonb).
alter table public.members add column if not exists duration text;

create or replace function public.intake_submit(p_token uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  cid uuid; c jsonb := coalesce(p->'customer', '{}'::jsonb); m jsonb; i int := 0;
begin
  if p_token is not null then
    select id into cid from public.customers where intake_token = p_token;
    if cid is null then raise exception 'invalid link'; end if;
  end if;
  if coalesce(trim(c->>'name'), '') = '' then raise exception 'name required'; end if;
  if jsonb_array_length(coalesce(p->'members', '[]'::jsonb)) > 25 then raise exception 'too many people'; end if;

  if cid is null then
    insert into public.customers (name, status, intake_token) values (left(trim(c->>'name'), 200), 'Intake', gen_random_uuid()) returning id into cid;
  end if;

  update public.customers set
    name = left(trim(c->>'name'), 200),
    email = left(nullif(trim(c->>'email'), ''), 200),
    phone = left(nullif(trim(c->>'phone'), ''), 60),
    address = left(nullif(trim(c->>'address'), ''), 400),
    location = coalesce(location, left(nullif(trim(c->>'city'), ''), 120)),
    home = left(nullif(trim(c->>'home'), ''), 2000),
    vehicles = left(nullif(trim(c->>'vehicles'), ''), 2000),
    pets = left(nullif(trim(c->>'pets'), ''), 2000),
    emergency_contacts = left(nullif(trim(c->>'emergency_contacts'), ''), 2000),
    household = left(nullif(trim(c->>'household'), ''), 200),
    intake = p->'intake',
    intake_submitted_at = now(),
    lat = null, lng = null
  where id = cid;

  delete from public.members where customer_id = cid;
  for m in select * from jsonb_array_elements(coalesce(p->'members', '[]'::jsonb)) loop
    if coalesce(trim(m->>'name'), '') <> '' then
      insert into public.members (customer_id, sort, name, relationship, birth_year, sex, height, weight,
        size_top, size_bottom, size_shoe, size_other, blood_type, allergies, medical, medications, diet, mobility, notes, duration)
      values (cid, i, left(trim(m->>'name'), 200), left(m->>'relationship', 100),
        case when (m->>'birth_year') ~ '^\d{4}$' then (m->>'birth_year')::int end,
        left(m->>'sex', 20), left(m->>'height', 40), left(m->>'weight', 40),
        left(m->>'size_top', 40), left(m->>'size_bottom', 40), left(m->>'size_shoe', 40), left(m->>'size_other', 80),
        left(m->>'blood_type', 10), left(m->>'allergies', 1000), left(m->>'medical', 2000), left(m->>'medications', 2000),
        left(m->>'diet', 500), left(m->>'mobility', 500), left(m->>'notes', 2000), left(nullif(m->>'duration', ''), 40));
      i := i + 1;
    end if;
  end loop;
  return cid;
end $$;
