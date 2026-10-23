-- 004: intake planning fields
-- Members gain duration (how long to prepare each person for) and medicine_storage
-- (storage needs only, e.g. "Medicine A: refrigerated"). The intake no longer asks for
-- medical details: intake_get stops returning them, and intake_submit carries over any
-- the team entered in admin (matched by name) instead of wiping them on resubmit.
-- Extended family, dependencies and capability modules (with the client's cost guess)
-- live in customers.intake (jsonb), so they need no columns.
alter table public.members
  add column if not exists duration text,
  add column if not exists medicine_storage text;

create or replace function public.intake_get(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'customer', jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone, 'address', c.address,
      'home', c.home, 'vehicles', c.vehicles, 'pets', c.pets, 'emergency_contacts', c.emergency_contacts, 'intake', c.intake),
    'members', coalesce((select jsonb_agg(to_jsonb(m) - 'customer_id' - 'created_at' - 'blood_type' - 'allergies' - 'medical' - 'medications' order by m.sort)
      from public.members m where m.customer_id = c.id), '[]'::jsonb))
  from public.customers c where c.intake_token = p_token;
$$;

create or replace function public.intake_submit(p_token uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  cid uuid; c jsonb := coalesce(p->'customer', '{}'::jsonb); m jsonb; i int := 0; prev jsonb; o jsonb;
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

  -- keep team-entered medical details for people who are still listed
  select coalesce(jsonb_object_agg(lower(trim(x.name)), jsonb_build_object('blood_type', x.blood_type, 'allergies', x.allergies, 'medical', x.medical, 'medications', x.medications)), '{}'::jsonb)
    into prev from public.members x where x.customer_id = cid;

  delete from public.members where customer_id = cid;
  for m in select * from jsonb_array_elements(coalesce(p->'members', '[]'::jsonb)) loop
    if coalesce(trim(m->>'name'), '') <> '' then
      o := coalesce(prev->lower(trim(m->>'name')), '{}'::jsonb);
      insert into public.members (customer_id, sort, name, relationship, birth_year, sex, height, weight,
        size_top, size_bottom, size_shoe, size_other, blood_type, allergies, medical, medications, diet, mobility, notes, duration, medicine_storage)
      values (cid, i, left(trim(m->>'name'), 200), left(m->>'relationship', 100),
        case when (m->>'birth_year') ~ '^\d{4}$' then (m->>'birth_year')::int end,
        left(m->>'sex', 20), left(m->>'height', 40), left(m->>'weight', 40),
        left(m->>'size_top', 40), left(m->>'size_bottom', 40), left(m->>'size_shoe', 40), left(m->>'size_other', 80),
        o->>'blood_type', o->>'allergies', o->>'medical', o->>'medications',
        left(m->>'diet', 500), left(m->>'mobility', 500), left(m->>'notes', 2000),
        left(nullif(m->>'duration', ''), 40), left(nullif(m->>'medicine_storage', ''), 2000));
      i := i + 1;
    end if;
  end loop;
  return cid;
end $$;
