-- Run after schema.sql. Adds branch locations, events and the editable promo banner. Safe to re-run.
create table if not exists public.locations (
  id bigserial primary key, name text not null, address text not null, phone text, hours text, note text,
  map_query text, is_active boolean not null default true, sort_order integer not null default 0,
  created_at timestamptz not null default now());
create table if not exists public.events (
  id bigserial primary key, title text not null check (char_length(title) <= 120), description text,
  event_date date not null, event_time text, location_name text, image_url text,
  is_published boolean not null default true, created_at timestamptz not null default now());
alter table public.locations enable row level security;
alter table public.events enable row level security;
drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations for select to anon, authenticated using (is_active or public.is_admin());
drop policy if exists locations_admin on public.locations;
create policy locations_admin on public.locations for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (is_published or public.is_admin());
drop policy if exists events_admin on public.events;
create policy events_admin on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.locations, public.events to anon;
grant select, insert, update, delete on public.locations, public.events to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

insert into public.locations (name, address, phone, hours, note, map_query, is_active, sort_order)
select * from (values
 ('The Alchemist, Westlands','The Alchemist, Parklands Road, Westlands, Nairobi','+254726652586',E'Mon-Thu & Sun: 12pm - 11:30pm\nFri & Sat: 12pm - 3:30am',null,'The Alchemist Parklands Road Nairobi',true,1),
 ('Lavington Mall','1st Floor, Lavington Mall, James Gichuru Road, Lavington, Nairobi',null,E'Mon-Thu & Sun: 12pm - 11:30pm\nFri & Sat: 12pm - 3:30am','Pork dishes are available at this branch.','Lavington Mall James Gichuru Road Nairobi',true,2),
 ('Ring Road (Kenrail Towers)','Kenrail Towers, Ring Road, Parklands, Nairobi',null,'Daily: 11am - 11pm (delivery hours)','No pork is served at this branch. NEEDS CONFIRMATION: may be the same kitchen as The Alchemist.','Kenrail Towers Ring Road Parklands Nairobi',false,3)
) as v(name,address,phone,hours,note,map_query,is_active,sort_order)
where not exists (select 1 from public.locations);
insert into public.settings (key, value) values ('promo_text','🎉 Special Offer: Free ice cream scoop for every KSh 1,000 spent! 🍦')
on conflict (key) do nothing;
