-- JOTO RAMEN: Supabase schema (run once in the SQL editor, or apply as a migration)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.

-- ---------- profiles (one row per auth user) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, phone)
  values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end $$;

-- trigger-only function: must not be callable through the API
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- ---------- menu ----------
create table if not exists public.menu_items (
  id bigserial primary key,
  name text not null,
  name_jp text,
  description text,
  price integer not null check (price >= 0),
  category text not null check (category in ('ramen','starters','sides','drinks','desserts','toppings')),
  tags text[] not null default '{}',
  spicy smallint not null default 0 check (spicy between 0 and 5),
  image_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- orders ----------
create table if not exists public.orders (
  id bigserial primary key,
  customer_id uuid references auth.users(id) on delete set null,
  name text not null,
  phone text not null,
  email text not null,
  order_type text not null check (order_type in ('pickup','delivery')),
  address text,
  notes text,
  subtotal integer not null,
  delivery_fee integer not null default 0,
  total integer not null,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','failed')),
  mpesa_receipt text,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  menu_item_id bigint references public.menu_items(id) on delete set null,
  name text not null,
  unit_price integer not null,
  quantity integer not null check (quantity between 1 and 50)
);

-- ---------- reservations / reviews / gallery / newsletter / settings ----------
create table if not exists public.reservations (
  id bigserial primary key,
  name text not null,
  email text not null,
  phone text not null,
  date date not null,
  time time not null,
  guests integer not null check (guests between 1 and 20),
  location text not null,
  requests text,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id bigserial primary key,
  name text not null check (char_length(name) <= 80),
  email text not null,
  rating smallint not null check (rating between 1 and 5),
  text text not null check (char_length(text) <= 1000),
  dish text,
  status text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now()
);

create table if not exists public.gallery (
  id bigserial primary key,
  src text not null,
  alt text,
  created_at timestamptz not null default now()
);

create table if not exists public.newsletter_subscribers (
  id bigserial primary key,
  email text unique not null,
  subscribed_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value text not null
);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reservations enable row level security;
alter table public.reviews enable row level security;
alter table public.gallery enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.settings enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- users may only change name/phone, never is_admin
revoke update on public.profiles from authenticated, anon;
grant update (name, phone) on public.profiles to authenticated;

drop policy if exists menu_read on public.menu_items;
create policy menu_read on public.menu_items for select to anon, authenticated
  using (is_available or public.is_admin());
drop policy if exists menu_admin on public.menu_items;
create policy menu_admin on public.menu_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- orders: created only through place_order(); customers read their own; admin manages all
drop policy if exists orders_own_read on public.orders;
create policy orders_own_read on public.orders for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());
drop policy if exists orders_admin_write on public.orders;
create policy orders_admin_write on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists orders_admin_delete on public.orders;
create policy orders_admin_delete on public.orders for delete to authenticated
  using (public.is_admin());

drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select to authenticated
  using (public.is_admin() or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));

drop policy if exists res_insert on public.reservations;
create policy res_insert on public.reservations for insert to anon, authenticated
  with check (status = 'pending');
drop policy if exists res_admin on public.reservations;
create policy res_admin on public.reservations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to anon, authenticated
  with check (status = 'pending');
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to anon, authenticated
  using (status = 'approved' or public.is_admin());
drop policy if exists reviews_admin on public.reviews;
create policy reviews_admin on public.reviews for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists reviews_admin_del on public.reviews;
create policy reviews_admin_del on public.reviews for delete to authenticated
  using (public.is_admin());

drop policy if exists gallery_read on public.gallery;
create policy gallery_read on public.gallery for select to anon, authenticated using (true);
drop policy if exists gallery_admin on public.gallery;
create policy gallery_admin on public.gallery for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists news_insert on public.newsletter_subscribers;
create policy news_insert on public.newsletter_subscribers for insert to anon, authenticated with check (true);
drop policy if exists news_admin on public.newsletter_subscribers;
create policy news_admin on public.newsletter_subscribers for select to authenticated using (public.is_admin());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to anon, authenticated using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- API grants (needed when "Automatically expose new tables" is OFF) ----------
-- RLS above still decides which rows each role can touch.
grant usage on schema public to anon, authenticated;

grant select on public.menu_items, public.gallery, public.settings, public.reviews to anon;
grant insert on public.reservations, public.reviews, public.newsletter_subscribers to anon;

grant select, insert, update, delete on public.menu_items, public.gallery, public.settings,
  public.reviews, public.reservations to authenticated;
grant insert on public.newsletter_subscribers to authenticated;
grant select on public.newsletter_subscribers to authenticated;
grant select, update, delete on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.profiles to authenticated;
grant update (name, phone) on public.profiles to authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- ---------- place_order(): server-side pricing and rules ----------
create or replace function public.place_order(
  p_name text, p_phone text, p_email text, p_type text,
  p_address text, p_notes text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_min int := coalesce((select value::int from settings where key = 'min_order'), 1500);
  v_fee int := coalesce((select value::int from settings where key = 'delivery_fee'), 200);
  v_subtotal int := 0;
  v_delivery int := 0;
  v_order_id bigint;
  r record;
begin
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_phone),'') = '' or coalesce(trim(p_email),'') = '' then
    raise exception 'Name, phone and email are required';
  end if;
  if p_type not in ('pickup','delivery') then raise exception 'Invalid order type'; end if;
  if p_type = 'delivery' and coalesce(trim(p_address),'') = '' then
    raise exception 'Delivery address is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;

  select coalesce(sum(m.price * q.qty), 0) into v_subtotal
  from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty
        from jsonb_array_elements(p_items) e) q
  join menu_items m on m.id = q.id and m.is_available;

  if v_subtotal < v_min then
    raise exception 'Minimum order is KSh %', v_min;
  end if;
  if p_type = 'delivery' then v_delivery := v_fee; end if;

  insert into orders (customer_id, name, phone, email, order_type, address, notes, subtotal, delivery_fee, total)
  values (auth.uid(), trim(p_name), trim(p_phone), trim(p_email), p_type, p_address, p_notes,
          v_subtotal, v_delivery, v_subtotal + v_delivery)
  returning id into v_order_id;

  for r in
    select m.id, m.name, m.price, q.qty
    from (select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int,1),50) as qty
          from jsonb_array_elements(p_items) e) q
    join menu_items m on m.id = q.id and m.is_available
  loop
    insert into order_items (order_id, menu_item_id, name, unit_price, quantity)
    values (v_order_id, r.id, r.name, r.price, r.qty);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'subtotal', v_subtotal,
                            'delivery_fee', v_delivery, 'total', v_subtotal + v_delivery);
end $$;

revoke all on function public.place_order(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.place_order(text,text,text,text,text,text,jsonb) to anon, authenticated;

-- ---------- storage bucket for images ----------
insert into storage.buckets (id, name, public) values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists media_admin_insert on storage.objects;
create policy media_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());
drop policy if exists media_admin_update on storage.objects;
create policy media_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_admin());
drop policy if exists media_admin_delete on storage.objects;
create policy media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());

-- ---------- seed ----------
insert into public.settings (key, value) values
  ('restaurant_name','Joto Ramen'), ('phone','+254726652586'), ('whatsapp','254726652586'),
  ('email','info@jotoramen.com'), ('instagram','joto_ramen_nairobi'), ('facebook',''),
  ('min_order','1500'), ('delivery_fee','200')
on conflict (key) do nothing;

with seed(name,name_jp,description,price,category,tags,spicy,image_url) as (values
 ('Special Shoyu','特製醤油','Clean soy-based broth with gentle smokiness, pulled chicken, pork belly, and seaweed.',1850,'ramen',array['signature'],0,null),
 ('Special Miso','特製味噌','Rich and bold: miso paste, corn, ground meat, seared chashu pork, and spring onions.',1850,'ramen',array['signature','popular'],0,null),
 ('Special Vegan Ramen','ビーガンラーメン','Joto''s original vegan ramen: a creamy mushroom and soy-milk broth with deep flavour and handmade noodles.',1650,'ramen',array['vegan'],0,null),
 ('Spicy Miso','辛味噌','Our signature miso with an extra kick of chili oil and spicy ground pork.',1950,'ramen',array['spicy'],3,null),
 ('Karaage','唐揚げ','Japanese fried chicken, crispy outside and juicy inside.',698,'starters',array[]::text[],0,null),
 ('Edamame','枝豆','Steamed soybeans with sea salt.',398,'starters',array['vegan'],0,null),
 ('Gyoza','餃子','Pan-fried pork dumplings with crispy bottoms.',750,'starters',array[]::text[],0,null),
 ('Tornado Potatoes','トルネードポテト','Crispy spiral-cut potatoes on a stick.',650,'sides',array['vegan'],0,null),
 ('Japanese Green Tea','緑茶','Authentic sencha green tea, hot or iced.',350,'drinks',array['vegan'],0,null),
 ('Ramune','ラムネ','Classic Japanese soda in several flavours.',400,'drinks',array['vegan'],0,null)
)
insert into public.menu_items (name,name_jp,description,price,category,tags,spicy,image_url)
select name,name_jp,description,price,category,tags,spicy,image_url from seed
where not exists (select 1 from public.menu_items);
