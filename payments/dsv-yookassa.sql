-- ЮKassa для доната DSV-Zombi: колонки под счёт платежа.
-- Запускать ПОСЛЕ dsv-donate.sql, в SQL Editor Supabase.

alter table public.dsv_donate_orders
  add column if not exists payment_id text,
  add column if not exists payment_url text,
  add column if not exists paid_at timestamptz;

-- Статус «ждёт платёж» уже есть ('new'). ЮKassa проставит 'paid' через уведомление,
-- 'issued' (привилегия выдана) остаётся ручной кнопкой в админке.

-- Настройки включения платёжного шлюза (значение 'true'/'false').
insert into public.dsv_donate_settings (key, value)
values ('yookassa_enabled', 'false')
on conflict (key) do nothing;

-- Правка RLS: основатель может обновлять payment_* вместе со статусом (политика уже есть),
-- игроку разрешаем прочитать свой payment_url, чтобы показать кнопку «доплатить».
drop policy if exists "dsv_orders_read" on public.dsv_donate_orders;
create policy "dsv_orders_read" on public.dsv_donate_orders
  for select to authenticated
  using (
    buyer_nick = (select p.nick from public.profiles p where p.id = auth.uid())
    or public.dsv_is_founder()
  );
