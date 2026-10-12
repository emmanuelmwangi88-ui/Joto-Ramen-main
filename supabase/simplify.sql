-- Run after managers.sql. Removes the waiter/staff platform: restaurant admins see the orders and decide.
-- Customers choose dine in (with a table number), pickup or delivery. Safe to re-run.

-- waiter-only functions and data
drop function if exists public.staff_ping();
drop function if exists public.staff_login_event();
drop function if exists public.shift_start();
drop function if exists public.shift_end();
drop function if exists public.my_shift();
drop function if exists public.staff_overview(integer);
drop function if exists public.staff_pay_table(text, text);
drop function if exists public.set_staff(uuid, boolean, bigint);
drop table if exists public.shifts;
update public.profiles set is_staff = false where is_staff;

drop policy if exists orders_staff_read on public.orders;
drop policy if exists order_items_staff_read on public.order_items;
drop policy if exists res_staff_read on public.reservations;
drop policy if exists sr_staff_read on public.service_requests;
create policy sr_staff_read on public.service_requests for select to authenticated using (public.can_access(location_id));

-- "staff" now just means the owner or an active restaurant admin
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or (is_manager and is_active and location_id is not null) from public.profiles where id = auth.uid()), false)
$$;

-- dine-in orders: placed by the customer (website or table QR code), always for a chosen restaurant and table
drop function if exists public.place_table_order(text, text, text, jsonb, bigint);
create or replace function public.place_table_order(p_table text, p_name text, p_notes text, p_items jsonb, p_location bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_table text := nullif(trim(p_table), ''); v_sub int := 0; v_id bigint; v_token uuid; v_loc bigint := p_location; r record;
begin
  if v_loc is null then raise exception 'Please choose a restaurant'; end if;
  if not exists (select 1 from locations where id = v_loc and is_active) then raise exception 'That restaurant is not taking orders'; end if;
  if v_table is null or char_length(v_table) > 20 then raise exception 'Please enter your table number'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your order is empty'; end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Too many different items in one order'; end if;
  if (select count(*) from orders where table_label = v_table and source = 'qr' and location_id = v_loc and created_at > now() - interval '10 minutes') >= 8 then
    raise exception 'Too many orders from this table. Please ask a member of staff.'; end if;

  select coalesce(sum(m.price * q.qty), 0) into v_sub
  from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
  join menu_items m on m.id = q.id and m.is_available and not (v_loc = any(m.unavailable_at));
  if v_sub <= 0 then raise exception 'Those items are not available right now'; end if;

  insert into orders (customer_id, name, phone, email, order_type, table_label, source, notes, subtotal, delivery_fee, total, location_id)
  values (auth.uid(), coalesce(nullif(trim(p_name),''), 'Table ' || v_table), '', '', 'dine_in', v_table, 'qr', p_notes, v_sub, 0, v_sub, v_loc)
  returning id, cancel_token into v_id, v_token;

  for r in select m.id, m.name, m.price, q.qty
    from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty from jsonb_array_elements(p_items) e) q
    join menu_items m on m.id = q.id and m.is_available and not (v_loc = any(m.unavailable_at))
  loop insert into order_items (order_id, menu_item_id, name, unit_price, quantity) values (v_id, r.id, r.name, r.price, r.qty); end loop;

  return jsonb_build_object('order_id', v_id, 'cancel_token', v_token, 'total', v_sub, 'table', v_table, 'location_id', v_loc, 'cancel_until', now() + interval '2 minutes');
end $$;
revoke all on function public.place_table_order(text,text,text,jsonb,bigint) from public;
grant execute on function public.place_table_order(text,text,text,jsonb,bigint) to anon, authenticated;

-- the dashboard lets a restaurant admin close a table: pay every open order of that table in one go
create or replace function public.pay_table(p_table text, p_method text default 'cash', p_location bigint default null) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_loc bigint;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_method not in ('cash','mpesa','card','other') then raise exception 'Invalid payment method'; end if;
  v_loc := case when public.is_admin() then p_location else public.my_location() end;
  if v_loc is null then raise exception 'Choose a restaurant'; end if;
  for r in select * from orders where order_type = 'dine_in' and table_label = p_table and location_id = v_loc and status <> 'cancelled' and payment_status <> 'paid' and created_at > now() - interval '1 day'
  loop
    insert into payments (order_id, location_id, method, amount, status, recorded_by, paid_at) values (r.id, r.location_id, p_method, r.total, 'success', auth.uid(), now());
    update orders set payment_status = 'paid', paid_at = now() where id = r.id; n := n + 1;
  end loop;
  if n > 0 then perform public.log_activity('table_paid', 'Table ' || p_table || ' · ' || n || ' order(s) · ' || p_method, null, v_loc); end if;
  return n;
end $$;
revoke all on function public.pay_table(text,text,bigint) from public, anon;
grant execute on function public.pay_table(text,text,bigint) to authenticated;
