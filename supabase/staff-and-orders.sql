-- Run after schema.sql and locations-events.sql. Safe to re-run.
-- Adds: 2-minute customer cancellation, dine-in (QR table + waiter) orders, staff role, service requests.

alter table public.profiles add column if not exists is_staff boolean not null default false;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or is_staff from public.profiles where id = auth.uid()), false)
$$;

alter table public.orders add column if not exists cancel_token uuid not null default gen_random_uuid();
alter table public.orders add column if not exists table_label text;
alter table public.orders add column if not exists source text not null default 'web';
alter table public.orders add column if not exists placed_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists cancelled_by text;
alter table public.orders drop constraint if exists orders_order_type_check;
alter table public.orders add constraint orders_order_type_check check (order_type in ('pickup','delivery','dine_in'));
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending','confirmed','ready','completed','cancelled'));
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('web','qr','waiter'));

-- kitchen cannot confirm a customer-placed order while the customer can still cancel it
create or replace function public.enforce_cancel_window() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'confirmed' and old.status = 'pending' and old.source in ('web','qr')
     and old.created_at > now() - interval '2 minutes' then
    raise exception 'The customer can still cancel this order for another % seconds',
      ceil(extract(epoch from (old.created_at + interval '2 minutes' - now())));
  end if;
  return new;
end $$;
drop trigger if exists orders_cancel_window on public.orders;
create trigger orders_cancel_window before update of status on public.orders
  for each row execute function public.enforce_cancel_window();

-- place_order now also returns the cancel token and deadline
create or replace function public.place_order(
  p_name text, p_phone text, p_email text, p_type text,
  p_address text, p_notes text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_min int := coalesce((select value::int from settings where key = 'min_order'), 1500);
  v_fee int := coalesce((select value::int from settings where key = 'delivery_fee'), 200);
  v_subtotal int := 0; v_delivery int := 0; v_order_id bigint; v_token uuid; r record;
begin
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_phone),'') = '' or coalesce(trim(p_email),'') = '' then
    raise exception 'Name, phone and email are required';
  end if;
  if p_type not in ('pickup','delivery') then raise exception 'Invalid order type'; end if;
  if p_type = 'delivery' and coalesce(trim(p_address),'') = '' then raise exception 'Delivery address is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Too many different items in one order'; end if;

  select coalesce(sum(m.price * q.qty), 0) into v_subtotal
  from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
  join menu_items m on m.id = q.id and m.is_available;

  if v_subtotal < v_min then raise exception 'Minimum order is KSh %', v_min; end if;
  if p_type = 'delivery' then v_delivery := v_fee; end if;

  insert into orders (customer_id, name, phone, email, order_type, address, notes, subtotal, delivery_fee, total, source)
  values (auth.uid(), trim(p_name), trim(p_phone), trim(p_email), p_type, p_address, p_notes,
          v_subtotal, v_delivery, v_subtotal + v_delivery, 'web')
  returning id, cancel_token into v_order_id, v_token;

  for r in select m.id, m.name, m.price, q.qty
    from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
    join menu_items m on m.id = q.id and m.is_available
  loop
    insert into order_items (order_id, menu_item_id, name, unit_price, quantity) values (v_order_id, r.id, r.name, r.price, r.qty);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'cancel_token', v_token,
    'cancel_until', now() + interval '2 minutes', 'subtotal', v_subtotal,
    'delivery_fee', v_delivery, 'total', v_subtotal + v_delivery);
end $$;

-- dine-in orders: customers scanning a table QR code, or waiters on their phones
create or replace function public.place_table_order(p_table text, p_name text, p_notes text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table text := nullif(trim(p_table), ''); v_sub int := 0; v_id bigint; v_token uuid;
  v_staff boolean := public.is_staff(); r record;
begin
  if v_table is null or char_length(v_table) > 20 then raise exception 'Please choose a table'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your order is empty'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Too many different items in one order'; end if;
  if not v_staff and (select count(*) from orders where table_label = v_table and source = 'qr'
                      and created_at > now() - interval '10 minutes') >= 8 then
    raise exception 'Too many orders from this table. Please ask your waiter.';
  end if;

  select coalesce(sum(m.price * q.qty), 0) into v_sub
  from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
  join menu_items m on m.id = q.id and m.is_available;
  if v_sub <= 0 then raise exception 'Those items are not available right now'; end if;

  insert into orders (customer_id, name, phone, email, order_type, table_label, source, placed_by, notes, subtotal, delivery_fee, total)
  values (case when v_staff then null else auth.uid() end, coalesce(nullif(trim(p_name),''), 'Table ' || v_table), '', '', 'dine_in',
          v_table, case when v_staff then 'waiter' else 'qr' end, case when v_staff then auth.uid() end,
          p_notes, v_sub, 0, v_sub)
  returning id, cancel_token into v_id, v_token;

  for r in select m.id, m.name, m.price, q.qty
    from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
    join menu_items m on m.id = q.id and m.is_available
  loop
    insert into order_items (order_id, menu_item_id, name, unit_price, quantity) values (v_id, r.id, r.name, r.price, r.qty);
  end loop;

  return jsonb_build_object('order_id', v_id, 'cancel_token', v_token, 'total', v_sub, 'table', v_table,
    'cancel_until', case when v_staff then null else now() + interval '2 minutes' end);
end $$;

-- customer self-cancel within 2 minutes (guests use the secret token returned at checkout)
create or replace function public.cancel_order(p_order bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from orders where id = p_order and cancel_token = p_token;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status <> 'pending' then raise exception 'This order is already being prepared. Please call us to change it.'; end if;
  if o.created_at < now() - interval '2 minutes' then raise exception 'The 2-minute cancellation window has passed. Please call us.'; end if;
  update orders set status = 'cancelled', cancelled_by = 'customer' where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

-- staff actions (waiters can only touch dine-in orders)
create or replace function public.staff_set_order_status(p_order bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_status not in ('confirmed','ready','completed','cancelled') then raise exception 'Invalid status'; end if;
  update orders set status = p_status, cancelled_by = case when p_status = 'cancelled' then 'staff' else cancelled_by end
  where id = p_order and (order_type = 'dine_in' or public.is_admin());
  if not found then raise exception 'Order not found'; end if;
end $$;

create or replace function public.staff_pay_table(p_table text) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  update orders set payment_status = 'paid'
  where order_type = 'dine_in' and table_label = p_table and status <> 'cancelled' and payment_status = 'unpaid'
    and created_at > now() - interval '1 day';
  get diagnostics n = row_count; return n;
end $$;

-- service requests ("call waiter", "request bill") from the table menu
create table if not exists public.service_requests (
  id bigserial primary key, table_label text not null, kind text not null check (kind in ('waiter','bill')),
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(), done_at timestamptz);
alter table public.service_requests enable row level security;
drop policy if exists sr_staff_read on public.service_requests;
create policy sr_staff_read on public.service_requests for select to authenticated using (public.is_staff());

create or replace function public.request_service(p_table text, p_kind text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_t text := nullif(trim(p_table),''); v_id bigint;
begin
  if v_t is null or char_length(v_t) > 20 or p_kind not in ('waiter','bill') then raise exception 'Invalid request'; end if;
  select id into v_id from service_requests where table_label = v_t and kind = p_kind and status = 'open' and created_at > now() - interval '10 minutes' limit 1;
  if v_id is null then insert into service_requests (table_label, kind) values (v_t, p_kind) returning id into v_id; end if;
  return v_id;
end $$;

create or replace function public.resolve_service(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  update service_requests set status = 'done', done_at = now() where id = p_id;
end $$;

-- staff management (admin only)
create or replace function public.list_users() returns table(id uuid, email text, name text, is_admin boolean, is_staff boolean, created_at timestamptz)
language sql security definer set search_path = public, auth as $$
  select u.id, u.email::text, p.name, coalesce(p.is_admin,false), coalesce(p.is_staff,false), u.created_at
  from auth.users u left join public.profiles p on p.id = u.id
  where public.is_admin() order by u.created_at desc limit 200
$$;
create or replace function public.set_staff(p_user uuid, p_staff boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update profiles set is_staff = p_staff where id = p_user;
end $$;

-- RLS for staff
drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders for select to authenticated using (public.is_staff() and order_type = 'dine_in');
drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items for select to authenticated
  using (public.is_staff() and exists (select 1 from public.orders o where o.id = order_id and o.order_type = 'dine_in'));

-- grants
grant select on public.service_requests to authenticated;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;
revoke all on function public.place_order(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.place_order(text,text,text,text,text,text,jsonb) to anon, authenticated;
revoke all on function public.place_table_order(text,text,text,jsonb) from public;
grant execute on function public.place_table_order(text,text,text,jsonb) to anon, authenticated;
revoke all on function public.cancel_order(bigint,uuid) from public;
grant execute on function public.cancel_order(bigint,uuid) to anon, authenticated;
revoke all on function public.request_service(text,text) from public;
grant execute on function public.request_service(text,text) to anon, authenticated;
revoke all on function public.staff_set_order_status(bigint,text), public.staff_pay_table(text), public.resolve_service(bigint),
  public.list_users(), public.set_staff(uuid,boolean) from public, anon;
grant execute on function public.staff_set_order_status(bigint,text), public.staff_pay_table(text), public.resolve_service(bigint),
  public.list_users(), public.set_staff(uuid,boolean) to authenticated;
revoke all on function public.enforce_cancel_window() from public, anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- realtime (live order alerts)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then
      alter publication supabase_realtime add table public.orders; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='service_requests') then
      alter publication supabase_realtime add table public.service_requests; end if;
  end if;
end $$;
