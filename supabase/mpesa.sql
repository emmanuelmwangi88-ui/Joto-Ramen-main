-- Run after staff-and-orders.sql. Adds the columns and helper used by the M-Pesa (Daraja) STK Push.
alter table public.orders add column if not exists mpesa_checkout_id text;
alter table public.orders add column if not exists mpesa_merchant_id text;
alter table public.orders add column if not exists payment_phone text;
alter table public.orders add column if not exists payment_note text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists last_stk_at timestamptz;
create index if not exists orders_mpesa_checkout_idx on public.orders (mpesa_checkout_id);

insert into public.settings (key, value) values ('mpesa_enabled', '0') on conflict (key) do nothing;

-- the customer's browser polls this (with its secret token) to see whether the payment went through
create or replace function public.order_payment_status(p_order bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from orders where id = p_order and cancel_token = p_token;
  if not found then raise exception 'Order not found'; end if;
  return jsonb_build_object('payment_status', o.payment_status, 'receipt', o.mpesa_receipt, 'note', o.payment_note, 'status', o.status);
end $$;
revoke all on function public.order_payment_status(bigint, uuid) from public;
grant execute on function public.order_payment_status(bigint, uuid) to anon, authenticated;
