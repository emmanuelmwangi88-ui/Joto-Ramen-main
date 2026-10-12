-- Run after mpesa.sql. Makes the site work for several restaurants (branches) in one database:
-- each branch has its own orders, reservations, reviews, tables, staff, requests and payments.
-- Also adds payment tracking and staff monitoring (shifts, activity log). Safe to re-run.

-- ---------- branches ----------
alter table public.locations add column if not exists table_count integer not null default 20;
alter table public.locations add column if not exists slug text;
update public.locations set slug = 'alchemist' where slug is null and name ilike 'The Alchemist%';
update public.locations set slug = 'lavington'  where slug is null and name ilike 'Lavington%';
update public.locations set slug = 'kenrail'    where slug is null and (name ilike 'Ring Road%' or name ilike '%Kenrail%');
update public.locations set name = 'Joto Ramen Premium (Kenrail Towers)', address = 'M3 Floor, Kenrail Towers, Ring Road, Parklands, Nairobi',
  note = 'No pork is served at this branch.', is_active = true, map_query = 'Kenrail Towers Ring Road Parklands Nairobi',
  hours = 'Daily: 11am - 11pm' where slug = 'kenrail';
create unique index if not exists locations_slug_idx on public.locations (slug) where slug is not null;

-- ---------- branch columns ----------
alter table public.orders           add column if not exists location_id bigint references public.locations(id) on delete set null;
alter table public.reservations     add column if not exists location_id bigint references public.locations(id) on delete set null;
alter table public.reviews          add column if not exists location_id bigint references public.locations(id) on delete set null;
alter table public.gallery          add column if not exists location_id bigint references public.locations(id) on delete set null; -- null = every branch
alter table public.events           add column if not exists location_id bigint references public.locations(id) on delete set null; -- null = every branch
alter table public.service_requests add column if not exists location_id bigint references public.locations(id) on delete set null;
alter table public.profiles         add column if not exists location_id bigint references public.locations(id) on delete set null; -- staff branch
alter table public.profiles         add column if not exists last_seen_at timestamptz;
alter table public.menu_items       add column if not exists unavailable_at bigint[] not null default '{}'; -- branch ids that do NOT serve this dish
create index if not exists orders_location_idx on public.orders (location_id, created_at desc);
create index if not exists reservations_location_idx on public.reservations (location_id);
update public.reservations r set location_id = l.id from public.locations l where r.location_id is null and r.location = l.name;
-- the Kenrail branch does not serve pork
update public.menu_items m set unavailable_at = (select coalesce(array_agg(id),'{}') from public.locations where slug = 'kenrail')
  where 'pork' = any(m.tags) and cardinality(m.unavailable_at) = 0;

create or replace function public.my_location() returns bigint
language sql stable security definer set search_path = public as $$
  select location_id from public.profiles where id = auth.uid()
$$;

-- ---------- payments ----------
create table if not exists public.payments (
  id bigserial primary key,
  order_id bigint references public.orders(id) on delete set null,
  location_id bigint references public.locations(id) on delete set null,
  method text not null check (method in ('mpesa','cash','card','other')),
  amount integer not null check (amount >= 0),
  status text not null default 'success' check (status in ('pending','success','failed','refunded')),
  phone text, mpesa_receipt text, checkout_id text, note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), paid_at timestamptz);
create index if not exists payments_created_idx on public.payments (created_at desc);
create index if not exists payments_checkout_idx on public.payments (checkout_id);
alter table public.payments enable row level security;
drop policy if exists payments_admin on public.payments;
create policy payments_admin on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- staff monitoring ----------
create table if not exists public.shifts (
  id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade,
  location_id bigint references public.locations(id) on delete set null,
  started_at timestamptz not null default now(), ended_at timestamptz);
create table if not exists public.activity_log (
  id bigserial primary key, user_id uuid references auth.users(id) on delete set null, user_name text,
  location_id bigint references public.locations(id) on delete set null,
  action text not null, detail text, order_id bigint, created_at timestamptz not null default now());
create index if not exists activity_created_idx on public.activity_log (created_at desc);
create index if not exists shifts_user_idx on public.shifts (user_id, started_at desc);
alter table public.shifts enable row level security;
alter table public.activity_log enable row level security;
drop policy if exists shifts_admin on public.shifts;
create policy shifts_admin on public.shifts for select to authenticated using (public.is_admin());
drop policy if exists activity_admin on public.activity_log;
create policy activity_admin on public.activity_log for select to authenticated using (public.is_admin());

create or replace function public.log_activity(p_action text, p_detail text, p_order bigint, p_location bigint) returns void
language sql security definer set search_path = public as $$
  insert into public.activity_log (user_id, user_name, location_id, action, detail, order_id)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()), p_location, p_action, p_detail, p_order)
$$;
revoke all on function public.log_activity(text, text, bigint, bigint) from public, anon, authenticated;

-- ---------- staff-only policies, now limited to the staff member's branch ----------
drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders for select to authenticated
  using (public.is_staff() and order_type = 'dine_in' and location_id is not null and location_id = public.my_location());
drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items for select to authenticated
  using (public.is_staff() and exists (select 1 from public.orders o where o.id = order_id and o.order_type = 'dine_in' and o.location_id = public.my_location()));
drop policy if exists sr_staff_read on public.service_requests;
create policy sr_staff_read on public.service_requests for select to authenticated
  using (public.is_admin() or (public.is_staff() and location_id = public.my_location()));
drop policy if exists res_staff_read on public.reservations;
create policy res_staff_read on public.reservations for select to authenticated
  using (public.is_staff() and location_id = public.my_location());

-- ---------- ordering functions (now branch-aware) ----------
drop function if exists public.place_order(text,text,text,text,text,text,jsonb);
create or replace function public.place_order(
  p_name text, p_phone text, p_email text, p_type text, p_address text, p_notes text, p_items jsonb, p_location bigint default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_min int := coalesce((select value::int from settings where key = 'min_order'), 1500);
  v_fee int := coalesce((select value::int from settings where key = 'delivery_fee'), 200);
  v_subtotal int := 0; v_delivery int := 0; v_order_id bigint; v_token uuid; r record; v_loc bigint := p_location;
begin
  if v_loc is null then raise exception 'Please choose a branch'; end if;
  if not exists (select 1 from locations where id = v_loc and is_active) then raise exception 'That branch is not taking orders'; end if;
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_phone),'') = '' or coalesce(trim(p_email),'') = '' then raise exception 'Name, phone and email are required'; end if;
  if p_type not in ('pickup','delivery') then raise exception 'Invalid order type'; end if;
  if p_type = 'delivery' and coalesce(trim(p_address),'') = '' then raise exception 'Delivery address is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Too many different items in one order'; end if;

  select coalesce(sum(m.price * q.qty), 0) into v_subtotal
  from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
  join menu_items m on m.id = q.id and m.is_available and not (v_loc = any(m.unavailable_at));
  if v_subtotal < v_min then raise exception 'Minimum order is KSh %', v_min; end if;
  if p_type = 'delivery' then v_delivery := v_fee; end if;

  insert into orders (customer_id, name, phone, email, order_type, address, notes, subtotal, delivery_fee, total, source, location_id)
  values (auth.uid(), trim(p_name), trim(p_phone), trim(p_email), p_type, p_address, p_notes, v_subtotal, v_delivery, v_subtotal + v_delivery, 'web', v_loc)
  returning id, cancel_token into v_order_id, v_token;

  for r in select m.id, m.name, m.price, q.qty
    from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
    join menu_items m on m.id = q.id and m.is_available and not (v_loc = any(m.unavailable_at))
  loop insert into order_items (order_id, menu_item_id, name, unit_price, quantity) values (v_order_id, r.id, r.name, r.price, r.qty); end loop;

  return jsonb_build_object('order_id', v_order_id, 'cancel_token', v_token, 'cancel_until', now() + interval '2 minutes',
    'subtotal', v_subtotal, 'delivery_fee', v_delivery, 'total', v_subtotal + v_delivery, 'location_id', v_loc);
end $$;

drop function if exists public.place_table_order(text,text,text,jsonb);
create or replace function public.place_table_order(p_table text, p_name text, p_notes text, p_items jsonb, p_location bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table text := nullif(trim(p_table), ''); v_sub int := 0; v_id bigint; v_token uuid;
  v_staff boolean := public.is_staff(); v_loc bigint; r record;
begin
  v_loc := case when v_staff and not public.is_admin() then public.my_location() else coalesce(p_location, public.my_location()) end;
  if v_loc is null then raise exception 'Please choose a branch'; end if;
  if not exists (select 1 from locations where id = v_loc and is_active) then raise exception 'That branch is not taking orders'; end if;
  if v_table is null or char_length(v_table) > 20 then raise exception 'Please choose a table'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your order is empty'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Too many different items in one order'; end if;
  if not v_staff and (select count(*) from orders where table_label = v_table and source = 'qr' and location_id = v_loc and created_at > now() - interval '10 minutes') >= 8 then
    raise exception 'Too many orders from this table. Please ask your waiter.'; end if;

  select coalesce(sum(m.price * q.qty), 0) into v_sub
  from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
  join menu_items m on m.id = q.id and m.is_available and not (v_loc = any(m.unavailable_at));
  if v_sub <= 0 then raise exception 'Those items are not available right now'; end if;

  insert into orders (customer_id, name, phone, email, order_type, table_label, source, placed_by, notes, subtotal, delivery_fee, total, location_id)
  values (case when v_staff then null else auth.uid() end, coalesce(nullif(trim(p_name),''), 'Table ' || v_table), '', '', 'dine_in', v_table,
          case when v_staff then 'waiter' else 'qr' end, case when v_staff then auth.uid() end, p_notes, v_sub, 0, v_sub, v_loc)
  returning id, cancel_token into v_id, v_token;

  for r in select m.id, m.name, m.price, q.qty
    from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
    join menu_items m on m.id = q.id and m.is_available and not (v_loc = any(m.unavailable_at))
  loop insert into order_items (order_id, menu_item_id, name, unit_price, quantity) values (v_id, r.id, r.name, r.price, r.qty); end loop;

  if v_staff then perform public.log_activity('order_placed', 'Table ' || v_table || ' · KSh ' || v_sub || ' · #' || v_id, v_id, v_loc); end if;
  return jsonb_build_object('order_id', v_id, 'cancel_token', v_token, 'total', v_sub, 'table', v_table, 'location_id', v_loc,
    'cancel_until', case when v_staff then null else now() + interval '2 minutes' end);
end $$;

create or replace function public.staff_set_order_status(p_order bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; v_act text;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_status not in ('confirmed','ready','completed','cancelled') then raise exception 'Invalid status'; end if;
  select * into o from orders where id = p_order;
  if not found or not (public.is_admin() or (o.order_type = 'dine_in' and o.location_id = public.my_location())) then raise exception 'Order not found'; end if;
  update orders set status = p_status, cancelled_by = case when p_status = 'cancelled' then 'staff' else cancelled_by end where id = p_order;
  v_act := case p_status when 'confirmed' then 'order_accepted' when 'ready' then 'order_ready' when 'completed' then 'order_served' else 'order_cancelled' end;
  perform public.log_activity(v_act, 'Table ' || coalesce(o.table_label,'-') || ' · #' || o.id, o.id, o.location_id);
end $$;

create or replace function public.record_payment(p_order bigint, p_method text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_method not in ('cash','mpesa','card','other') then raise exception 'Invalid payment method'; end if;
  select * into o from orders where id = p_order;
  if not found or not (public.is_admin() or o.location_id = public.my_location()) then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if o.payment_status = 'paid' then return; end if;
  insert into payments (order_id, location_id, method, amount, status, note, recorded_by, paid_at) values (o.id, o.location_id, p_method, o.total, 'success', p_note, auth.uid(), now());
  update orders set payment_status = 'paid', paid_at = now() where id = o.id;
  perform public.log_activity('payment', 'KSh ' || o.total || ' ' || p_method || ' · #' || o.id, o.id, o.location_id);
end $$;

drop function if exists public.staff_pay_table(text);
create or replace function public.staff_pay_table(p_table text, p_method text default 'cash') returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_loc bigint := public.my_location();
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_method not in ('cash','mpesa','card','other') then raise exception 'Invalid payment method'; end if;
  for r in select * from orders where order_type = 'dine_in' and table_label = p_table and location_id = v_loc and status <> 'cancelled'
           and payment_status <> 'paid' and created_at > now() - interval '1 day'
  loop
    insert into payments (order_id, location_id, method, amount, status, recorded_by, paid_at) values (r.id, r.location_id, p_method, r.total, 'success', auth.uid(), now());
    update orders set payment_status = 'paid', paid_at = now() where id = r.id; n := n + 1;
  end loop;
  if n > 0 then perform public.log_activity('table_paid', 'Table ' || p_table || ' · ' || n || ' order(s) · ' || p_method, null, v_loc); end if;
  return n;
end $$;

drop function if exists public.request_service(text, text);
create or replace function public.request_service(p_table text, p_kind text, p_location bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_t text := nullif(trim(p_table),''); v_id bigint;
begin
  if v_t is null or char_length(v_t) > 20 or p_kind not in ('waiter','bill') then raise exception 'Invalid request'; end if;
  if p_location is null or not exists (select 1 from locations where id = p_location and is_active) then raise exception 'Please choose a branch'; end if;
  select id into v_id from service_requests where table_label = v_t and kind = p_kind and status = 'open' and location_id = p_location and created_at > now() - interval '10 minutes' limit 1;
  if v_id is null then insert into service_requests (table_label, kind, location_id) values (v_t, p_kind, p_location) returning id into v_id; end if;
  return v_id;
end $$;

create or replace function public.resolve_service(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.service_requests;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  select * into s from service_requests where id = p_id;
  if not found or not (public.is_admin() or s.location_id = public.my_location()) then raise exception 'Request not found'; end if;
  update service_requests set status = 'done', done_at = now() where id = p_id;
  perform public.log_activity('request_done', (case s.kind when 'bill' then 'Bill' else 'Waiter' end) || ' · Table ' || s.table_label, null, s.location_id);
end $$;

-- ---------- shifts + presence ----------
create or replace function public.staff_ping() returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_staff() then update profiles set last_seen_at = now() where id = auth.uid(); end if;
end $$;
create or replace function public.shift_start() returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_loc bigint := public.my_location();
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  select started_at into v_start from shifts where user_id = auth.uid() and ended_at is null order by started_at desc limit 1;
  if v_start is null then
    insert into shifts (user_id, location_id) values (auth.uid(), v_loc) returning started_at into v_start;
    perform public.log_activity('shift_start', 'Started shift', null, v_loc);
  end if;
  update profiles set last_seen_at = now() where id = auth.uid();
  return v_start;
end $$;
create or replace function public.shift_end() returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  update shifts set ended_at = now() where user_id = auth.uid() and ended_at is null; get diagnostics n = row_count;
  if n > 0 then perform public.log_activity('shift_end', 'Ended shift', null, public.my_location()); end if;
end $$;
create or replace function public.my_shift() returns timestamptz language sql stable security definer set search_path = public as $$
  select started_at from shifts where user_id = auth.uid() and ended_at is null order by started_at desc limit 1
$$;
create or replace function public.staff_login_event() returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_staff() then perform public.log_activity('login', 'Signed in', null, public.my_location()); update profiles set last_seen_at = now() where id = auth.uid(); end if;
end $$;

-- admin: one row per staff member with their numbers for the last p_days days
create or replace function public.staff_overview(p_days integer default 7) returns table(
  id uuid, email text, name text, location_id bigint, active boolean, last_seen_at timestamptz, on_shift boolean,
  orders_taken bigint, sales_value bigint, served bigint, tables_paid bigint, hours_worked numeric)
language sql security definer set search_path = public, auth as $$
  select p.id, u.email::text, p.name, p.location_id, p.is_staff, p.last_seen_at,
    exists (select 1 from shifts s where s.user_id = p.id and s.ended_at is null),
    (select count(*) from orders o where o.placed_by = p.id and o.created_at >= now() - make_interval(days => p_days)),
    (select coalesce(sum(o.total),0)::bigint from orders o where o.placed_by = p.id and o.status <> 'cancelled' and o.created_at >= now() - make_interval(days => p_days)),
    (select count(*) from activity_log a where a.user_id = p.id and a.action = 'order_served' and a.created_at >= now() - make_interval(days => p_days)),
    (select count(*) from activity_log a where a.user_id = p.id and a.action = 'table_paid' and a.created_at >= now() - make_interval(days => p_days)),
    (select coalesce(round(sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))) / 3600.0, 1), 0) from shifts s where s.user_id = p.id and s.started_at >= now() - make_interval(days => p_days))
  from profiles p join auth.users u on u.id = p.id
  where public.is_admin() and (p.is_staff or exists (select 1 from activity_log a where a.user_id = p.id))
  order by p.is_staff desc, p.name
$$;

-- admin: people list with branch, and staff assignment
drop function if exists public.list_users();
create or replace function public.list_users() returns table(id uuid, email text, name text, is_admin boolean, is_staff boolean, location_id bigint, last_seen_at timestamptz, created_at timestamptz)
language sql security definer set search_path = public, auth as $$
  select u.id, u.email::text, p.name, coalesce(p.is_admin,false), coalesce(p.is_staff,false), p.location_id, p.last_seen_at, u.created_at
  from auth.users u left join public.profiles p on p.id = u.id where public.is_admin() order by u.created_at desc limit 300
$$;
drop function if exists public.set_staff(uuid, boolean);
create or replace function public.set_staff(p_user uuid, p_staff boolean, p_location bigint default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_staff and p_location is null then raise exception 'Choose the branch this person works at'; end if;
  update profiles set is_staff = p_staff, location_id = case when p_staff then p_location else location_id end where id = p_user;
end $$;

-- ---------- grants ----------
do $$ declare f text; begin
  foreach f in array array[
    'public.my_location()','public.place_order(text,text,text,text,text,text,jsonb,bigint)','public.place_table_order(text,text,text,jsonb,bigint)',
    'public.staff_set_order_status(bigint,text)','public.record_payment(bigint,text,text)','public.staff_pay_table(text,text)',
    'public.request_service(text,text,bigint)','public.resolve_service(bigint)','public.staff_ping()','public.shift_start()','public.shift_end()',
    'public.my_shift()','public.staff_login_event()','public.staff_overview(integer)','public.list_users()','public.set_staff(uuid,boolean,bigint)']
  loop execute format('revoke all on function %s from public, anon', f); end loop;
end $$;
grant execute on function public.my_location() to authenticated;
grant execute on function public.place_order(text,text,text,text,text,text,jsonb,bigint) to anon, authenticated;
grant execute on function public.place_table_order(text,text,text,jsonb,bigint) to anon, authenticated;
grant execute on function public.request_service(text,text,bigint) to anon, authenticated;
grant execute on function public.staff_set_order_status(bigint,text), public.record_payment(bigint,text,text), public.staff_pay_table(text,text),
  public.resolve_service(bigint), public.staff_ping(), public.shift_start(), public.shift_end(), public.my_shift(), public.staff_login_event(),
  public.staff_overview(integer), public.list_users(), public.set_staff(uuid,boolean,bigint) to authenticated;
grant select on public.payments, public.shifts, public.activity_log to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='payments') then
      alter publication supabase_realtime add table public.payments; end if;
  end if;
end $$;
