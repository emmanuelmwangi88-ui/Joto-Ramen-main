-- Run after multi-branch.sql. Adds restaurant MANAGERS: one login per restaurant that can only see and manage that restaurant.
--   owner   = profiles.is_admin   (sees every restaurant)
--   manager = profiles.is_manager (+ location_id): sees and manages ONLY their own restaurant, can add waiters for it
--   waiter  = profiles.is_staff   (+ location_id): works only inside the restaurant that registered them
-- Safe to re-run.

alter table public.profiles add column if not exists is_manager boolean not null default false;
alter table public.profiles add column if not exists is_active boolean not null default true;   -- false = deactivated waiter/manager (login also banned)

create or replace function public.is_manager() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_manager and is_active and location_id is not null from public.profiles where id = auth.uid()), false)
$$;
-- "staff" now means: owner, an active manager, or an active waiter (everyone allowed to use the staff functions)
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or ((is_staff or is_manager) and is_active and location_id is not null) from public.profiles where id = auth.uid()), false)
$$;
create or replace function public.is_boss() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_manager()
$$;
-- can this person manage data that belongs to restaurant p_loc? (owner: any; manager: only their own)
create or replace function public.can_access(p_loc bigint) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_manager() and p_loc is not null and p_loc = public.my_location())
$$;
revoke all on function public.is_manager(), public.is_boss(), public.can_access(bigint) from public;
grant execute on function public.is_manager(), public.is_boss(), public.can_access(bigint) to anon, authenticated;

-- ---------- row level security: branch data is limited to the branch's own manager ----------
drop policy if exists orders_own_read on public.orders;
create policy orders_own_read on public.orders for select to authenticated using (customer_id = auth.uid() or public.can_access(location_id));
drop policy if exists orders_admin_write on public.orders;
create policy orders_admin_write on public.orders for update to authenticated using (public.can_access(location_id)) with check (public.can_access(location_id));
-- deleting orders stays owner-only (orders_admin_delete)
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.can_access(o.location_id))));

drop policy if exists res_admin on public.reservations;
create policy res_admin on public.reservations for all to authenticated using (public.can_access(location_id)) with check (public.can_access(location_id));

drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to anon, authenticated using (status = 'approved' or public.can_access(location_id));
drop policy if exists reviews_admin on public.reviews;
create policy reviews_admin on public.reviews for update to authenticated using (public.can_access(location_id)) with check (public.can_access(location_id));
drop policy if exists reviews_admin_del on public.reviews;
create policy reviews_admin_del on public.reviews for delete to authenticated using (public.can_access(location_id));

drop policy if exists gallery_admin on public.gallery;
create policy gallery_admin on public.gallery for all to authenticated using (public.can_access(location_id)) with check (public.can_access(location_id));
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (is_published or public.can_access(location_id));
drop policy if exists events_admin on public.events;
create policy events_admin on public.events for all to authenticated using (public.can_access(location_id)) with check (public.can_access(location_id));

drop policy if exists payments_admin on public.payments;
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated using (public.can_access(location_id));
drop policy if exists payments_owner on public.payments;
create policy payments_owner on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists shifts_admin on public.shifts;
create policy shifts_admin on public.shifts for select to authenticated using (public.can_access(location_id));
drop policy if exists activity_admin on public.activity_log;
create policy activity_admin on public.activity_log for select to authenticated using (public.can_access(location_id));
drop policy if exists sr_staff_read on public.service_requests;
create policy sr_staff_read on public.service_requests for select to authenticated using (public.can_access(location_id) or (public.is_staff() and location_id = public.my_location()));

drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations for select to anon, authenticated using (is_active or public.can_access(id));
drop policy if exists locations_manager_update on public.locations;
create policy locations_manager_update on public.locations for update to authenticated using (public.can_access(id)) with check (public.can_access(id));
-- a manager may edit their restaurant's details but not switch it off, rename it or re-order it
create or replace function public.locations_manager_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if not public.is_admin() then new.is_active := old.is_active; new.slug := old.slug; new.sort_order := old.sort_order; new.name := old.name; end if;
  return new;
end $$;
drop trigger if exists locations_manager_guard on public.locations;
create trigger locations_manager_guard before update on public.locations for each row execute function public.locations_manager_guard();
revoke all on function public.locations_manager_guard() from public, anon, authenticated;

-- images: managers may upload (for their gallery and events); only the owner may replace or delete files
drop policy if exists media_admin_insert on storage.objects;
create policy media_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_boss());

-- ---------- functions that were owner-or-branch-staff, now manager-aware ----------
create or replace function public.staff_set_order_status(p_order bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; v_act text;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_status not in ('confirmed','ready','completed','cancelled') then raise exception 'Invalid status'; end if;
  select * into o from orders where id = p_order;
  if not found or not (public.can_access(o.location_id) or (o.order_type = 'dine_in' and o.location_id = public.my_location())) then raise exception 'Order not found'; end if;
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
  if not found or not (public.can_access(o.location_id) or o.location_id = public.my_location()) then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if o.payment_status = 'paid' then return; end if;
  insert into payments (order_id, location_id, method, amount, status, note, recorded_by, paid_at) values (o.id, o.location_id, p_method, o.total, 'success', p_note, auth.uid(), now());
  update orders set payment_status = 'paid', paid_at = now() where id = o.id;
  perform public.log_activity('payment', 'KSh ' || o.total || ' ' || p_method || ' · #' || o.id, o.id, o.location_id);
end $$;

create or replace function public.resolve_service(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.service_requests;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  select * into s from service_requests where id = p_id;
  if not found or not (public.can_access(s.location_id) or s.location_id = public.my_location()) then raise exception 'Request not found'; end if;
  update service_requests set status = 'done', done_at = now() where id = p_id;
  perform public.log_activity('request_done', (case s.kind when 'bill' then 'Bill' else 'Waiter' end) || ' · Table ' || s.table_label, null, s.location_id);
end $$;

-- a manager switches a dish on or off for THEIR restaurant only (the shared menu and prices stay with the owner)
create or replace function public.set_branch_dish(p_item bigint, p_available boolean, p_location bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_loc bigint;
begin
  if not public.is_boss() then raise exception 'Not allowed'; end if;
  v_loc := case when public.is_admin() then p_location else public.my_location() end;
  if v_loc is null then raise exception 'Choose a branch'; end if;
  update menu_items set unavailable_at = case when p_available then array_remove(unavailable_at, v_loc) else array_append(array_remove(unavailable_at, v_loc), v_loc) end where id = p_item;
  if not found then raise exception 'Dish not found'; end if;
end $$;

create or replace function public.staff_overview(p_days integer default 7) returns table(
  id uuid, email text, name text, location_id bigint, active boolean, last_seen_at timestamptz, on_shift boolean,
  orders_taken bigint, sales_value bigint, served bigint, tables_paid bigint, hours_worked numeric)
language sql security definer set search_path = public, auth as $$
  select p.id, u.email::text, p.name, p.location_id, p.is_active, p.last_seen_at,
    exists (select 1 from shifts s where s.user_id = p.id and s.ended_at is null),
    (select count(*) from orders o where o.placed_by = p.id and o.created_at >= now() - make_interval(days => p_days)),
    (select coalesce(sum(o.total),0)::bigint from orders o where o.placed_by = p.id and o.status <> 'cancelled' and o.created_at >= now() - make_interval(days => p_days)),
    (select count(*) from activity_log a where a.user_id = p.id and a.action = 'order_served' and a.created_at >= now() - make_interval(days => p_days)),
    (select count(*) from activity_log a where a.user_id = p.id and a.action = 'table_paid' and a.created_at >= now() - make_interval(days => p_days)),
    (select coalesce(round(sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))) / 3600.0, 1), 0) from shifts s where s.user_id = p.id and s.started_at >= now() - make_interval(days => p_days))
  from profiles p join auth.users u on u.id = p.id
  where public.is_boss() and not p.is_admin and (p.is_staff or p.is_manager)
    and (public.is_admin() or (p.location_id = public.my_location() and not p.is_manager))
  order by p.is_manager desc, p.name
$$;

drop function if exists public.list_users();
create or replace function public.list_users() returns table(id uuid, email text, name text, is_admin boolean, is_staff boolean, is_manager boolean, is_active boolean, location_id bigint, last_seen_at timestamptz, created_at timestamptz)
language sql security definer set search_path = public, auth as $$
  select u.id, u.email::text, p.name, coalesce(p.is_admin,false), coalesce(p.is_staff,false), coalesce(p.is_manager,false), coalesce(p.is_active,true), p.location_id, p.last_seen_at, u.created_at
  from auth.users u left join public.profiles p on p.id = u.id where public.is_admin() order by u.created_at desc limit 300
$$;
drop function if exists public.set_staff(uuid, boolean, bigint);
create or replace function public.set_staff(p_user uuid, p_staff boolean, p_location bigint default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_staff and p_location is null then raise exception 'Choose the restaurant this person works at'; end if;
  update profiles set is_staff = p_staff, is_active = true, location_id = case when p_staff then p_location else location_id end where id = p_user and not is_admin and not is_manager;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.set_branch_dish(bigint,boolean,bigint)','public.staff_overview(integer)','public.list_users()','public.set_staff(uuid,boolean,bigint)'] loop
    execute format('revoke all on function %s from public, anon', f); end loop; end $$;
grant execute on function public.set_branch_dish(bigint,boolean,bigint), public.staff_overview(integer), public.list_users(), public.set_staff(uuid,boolean,bigint) to authenticated;
