-- Run after simplify.sql. Adds: the customer cancel window as ONE setting (default 80 seconds = 1 minute 20 seconds),
-- pay-by-QR (customer scans the restaurant's M-Pesa QR, the admin confirms), and a claimed payment state. Safe to re-run.

insert into public.settings (key, value) values ('cancel_seconds', '80') on conflict (key) do nothing;
create or replace function public.cancel_seconds() returns integer language sql stable security definer set search_path = public as $$
  select least(300, greatest(15, coalesce((select value::int from public.settings where key = 'cancel_seconds'), 80)))
$$;
revoke all on function public.cancel_seconds() from public;
grant execute on function public.cancel_seconds() to anon, authenticated;

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (payment_status in ('unpaid','claimed','paid','failed'));
alter table public.orders add column if not exists payment_code text;           -- M-Pesa code the customer typed after paying by QR
alter table public.locations add column if not exists pay_qr_url text;          -- the restaurant's M-Pesa till or paybill QR image
alter table public.locations add column if not exists pay_note text;            -- e.g. "Till 123456, Joto Ramen"

-- the cancel window now follows the setting
create or replace function public.enforce_cancel_window() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'confirmed' and old.status = 'pending' and old.source in ('web','qr')
     and old.created_at > now() - make_interval(secs => public.cancel_seconds()) then
    raise exception 'The customer can still cancel this order for another % seconds',
      ceil(extract(epoch from (old.created_at + make_interval(secs => public.cancel_seconds()) - now())));
  end if;
  return new;
end $$;

create or replace function public.cancel_order(p_order bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from orders where id = p_order and cancel_token = p_token;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status <> 'pending' then raise exception 'This order is already being prepared. Please call us to change it.'; end if;
  if o.created_at < now() - make_interval(secs => public.cancel_seconds()) then raise exception 'The cancellation window has passed. Please call us.'; end if;
  update orders set status = 'cancelled', cancelled_by = 'customer' where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

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

  return jsonb_build_object('order_id', v_order_id, 'cancel_token', v_token, 'cancel_until', now() + make_interval(secs => public.cancel_seconds()),
    'subtotal', v_subtotal, 'delivery_fee', v_delivery, 'total', v_subtotal + v_delivery, 'location_id', v_loc);
end $$;

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

  return jsonb_build_object('order_id', v_id, 'cancel_token', v_token, 'total', v_sub, 'table', v_table, 'location_id', v_loc, 'cancel_until', now() + make_interval(secs => public.cancel_seconds()));
end $$;

-- recording a payment also settles a customer's "I have paid" claim
create or replace function public.record_payment(p_order bigint, p_method text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; n int;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_method not in ('cash','mpesa','card','other') then raise exception 'Invalid payment method'; end if;
  select * into o from orders where id = p_order;
  if not found or not (public.can_access(o.location_id) or o.location_id = public.my_location()) then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if o.payment_status = 'paid' then return; end if;
  update payments set status = 'success', method = p_method, paid_at = now(), recorded_by = auth.uid(), note = coalesce(p_note, note),
         mpesa_receipt = coalesce(mpesa_receipt, case when p_method = 'mpesa' then o.payment_code end)
   where order_id = o.id and status = 'pending' and checkout_id is null;
  get diagnostics n = row_count;
  if n = 0 then
    insert into payments (order_id, location_id, method, amount, status, note, mpesa_receipt, recorded_by, paid_at)
    values (o.id, o.location_id, p_method, o.total, 'success', p_note, case when p_method = 'mpesa' then o.payment_code end, auth.uid(), now());
  end if;
  update orders set payment_status = 'paid', paid_at = now(), mpesa_receipt = coalesce(mpesa_receipt, case when p_method = 'mpesa' then payment_code end) where id = o.id;
  perform public.log_activity('payment', 'KSh ' || o.total || ' ' || p_method || ' · #' || o.id, o.id, o.location_id);
end $$;

-- customer: "I paid by scanning the QR" (optionally with the M-Pesa code); the restaurant admin then confirms
create or replace function public.claim_payment(p_order bigint, p_token uuid, p_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; v_code text := nullif(upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')), '');
begin
  select * into o from orders where id = p_order and cancel_token = p_token;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if o.payment_status = 'paid' then raise exception 'This order is already paid'; end if;
  if v_code is not null and char_length(v_code) > 20 then raise exception 'That code looks too long'; end if;
  update orders set payment_status = 'claimed', payment_code = v_code, payment_note = null where id = o.id;
  delete from payments where order_id = o.id and status = 'pending' and checkout_id is null;
  insert into payments (order_id, location_id, method, amount, status, mpesa_receipt, note) values (o.id, o.location_id, 'mpesa', o.total, 'pending', v_code, 'Customer says they paid by QR code');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claim_payment(bigint, uuid, text) from public;
grant execute on function public.claim_payment(bigint, uuid, text) to anon, authenticated;

-- restaurant admin: the claimed payment never arrived
create or replace function public.reject_payment(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from orders where id = p_order;
  if not found or not public.can_access(o.location_id) then raise exception 'Order not found'; end if;
  update orders set payment_status = 'unpaid', payment_code = null, payment_note = 'The payment you reported was not received' where id = o.id and payment_status = 'claimed';
  update payments set status = 'failed', note = 'Payment not received' where order_id = o.id and status = 'pending' and checkout_id is null;
end $$;
revoke all on function public.reject_payment(bigint) from public, anon;
grant execute on function public.reject_payment(bigint) to authenticated;
