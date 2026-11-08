-- 005: shipping box size and weight per gear item (for packing and pallets)
alter table public.gear
  add column if not exists length_cm numeric(8,1),
  add column if not exists width_cm numeric(8,1),
  add column if not exists height_cm numeric(8,1),
  add column if not exists weight_kg numeric(8,2);
