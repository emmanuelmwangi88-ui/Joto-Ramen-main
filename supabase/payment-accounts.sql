-- Run after uploads.sql. Prepares each restaurant to take real M-Pesa money with its OWN paybill or till.
-- Everything is switched OFF by default: payments keep using the shared test (sandbox) account until a restaurant's
-- number and Daraja credentials are saved in Admin > Payment accounts and "Live payments" is turned on. Safe to re-run.

alter table public.locations add column if not exists pay_kind text check (pay_kind in ('paybill','till'));
alter table public.locations add column if not exists pay_number text;                 -- paybill number, or the till number
alter table public.locations add column if not exists pay_store text;                  -- store / head-office number (tills only)
alter table public.locations add column if not exists pay_account_ref text default 'Order number';
alter table public.locations add column if not exists pay_live boolean not null default false;

-- the Daraja keys live here and nowhere else: no policies and no grants, so only the server functions can read or write them
create table if not exists public.payment_secrets (
  location_id bigint primary key references public.locations(id) on delete cascade,
  consumer_key text, consumer_secret text, passkey text, updated_at timestamptz not null default now());
alter table public.payment_secrets enable row level security;
revoke all on public.payment_secrets from anon, authenticated;

-- restaurant admins can edit their restaurant's hours, tables and QR, but never its payment account
create or replace function public.locations_manager_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.is_active := old.is_active; new.slug := old.slug; new.sort_order := old.sort_order; new.name := old.name;
    new.pay_kind := old.pay_kind; new.pay_number := old.pay_number; new.pay_store := old.pay_store;
    new.pay_account_ref := old.pay_account_ref; new.pay_live := old.pay_live;
  end if;
  return new;
end $$;
