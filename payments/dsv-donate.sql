-- ============================================================
-- ДОНАТ для DSV-Zombi (Supabase, проект tgleohmsmwqlvndxfykv)
-- Запустить целиком в SQL Editor. После этого на сайте
-- появятся витрина лотов и панель основателя «Донат: лоты».
-- ============================================================

create table if not exists public.dsv_donate_rewards (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  description text not null default '',
  perks text[] not null default '{}',
  price int not null check (price > 0 and price < 10000000),
  badge text,
  color text not null default '#4cd137',
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists public.dsv_donate_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reward_id uuid references public.dsv_donate_rewards (id) on delete set null,
  reward_title text not null,
  price int not null,
  buyer_nick text not null,
  contact text,
  comment text,
  status text not null default 'new'
    check (status in ('new', 'paid', 'issued', 'canceled'))
);

create table if not exists public.dsv_donate_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists dsv_donate_orders_buyer_idx
  on public.dsv_donate_orders (buyer_nick, created_at desc);
create index if not exists dsv_donate_orders_status_idx
  on public.dsv_donate_orders (status);
create index if not exists dsv_donate_rewards_active_idx
  on public.dsv_donate_rewards (active, sort);

-- ---------------------------------------------------------
-- Помощник: текущий пользователь — основатель сети?
-- ---------------------------------------------------------
create or replace function public.dsv_is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'founder' or lower(p.nick) = 'faranatic')
  );
$$;

alter function public.dsv_is_founder() owner to postgres;

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table public.dsv_donate_rewards enable row level security;
alter table public.dsv_donate_orders  enable row level security;
alter table public.dsv_donate_settings enable row level security;

-- Лоты: все видят активные, основатель видит и скрытые.
drop policy if exists "dsv_rewards_read" on public.dsv_donate_rewards;
create policy "dsv_rewards_read" on public.dsv_donate_rewards
  for select to anon, authenticated
  using (active or public.dsv_is_founder());

drop policy if exists "dsv_rewards_insert" on public.dsv_donate_rewards;
create policy "dsv_rewards_insert" on public.dsv_donate_rewards
  for insert to authenticated
  with check (public.dsv_is_founder());

drop policy if exists "dsv_rewards_update" on public.dsv_donate_rewards;
create policy "dsv_rewards_update" on public.dsv_donate_rewards
  for update to authenticated
  using (public.dsv_is_founder()) with check (public.dsv_is_founder());

drop policy if exists "dsv_rewards_delete" on public.dsv_donate_rewards;
create policy "dsv_rewards_delete" on public.dsv_donate_rewards
  for delete to authenticated
  using (public.dsv_is_founder());

-- Заявки: игрок создаёт на себя и видит свои; основатель видит и правит все.
drop policy if exists "dsv_orders_insert" on public.dsv_donate_orders;
create policy "dsv_orders_insert" on public.dsv_donate_orders
  for insert to authenticated
  with check (
    buyer_nick = (select p.nick from public.profiles p where p.id = auth.uid())
    or public.dsv_is_founder()
  );

drop policy if exists "dsv_orders_read" on public.dsv_donate_orders;
create policy "dsv_orders_read" on public.dsv_donate_orders
  for select to authenticated
  using (
    buyer_nick = (select p.nick from public.profiles p where p.id = auth.uid())
    or public.dsv_is_founder()
  );

drop policy if exists "dsv_orders_update" on public.dsv_donate_orders;
create policy "dsv_orders_update" on public.dsv_donate_orders
  for update to authenticated
  using (public.dsv_is_founder()) with check (public.dsv_is_founder());

drop policy if exists "dsv_orders_delete" on public.dsv_donate_orders;
create policy "dsv_orders_delete" on public.dsv_donate_orders
  for delete to authenticated
  using (public.dsv_is_founder());

-- Настройки приёма платежей: читают все, пишет основатель.
drop policy if exists "dsv_settings_read" on public.dsv_donate_settings;
create policy "dsv_settings_read" on public.dsv_donate_settings
  for select to anon, authenticated
  using (true);

drop policy if exists "dsv_settings_write" on public.dsv_donate_settings;
create policy "dsv_settings_write" on public.dsv_donate_settings
  for insert to authenticated
  with check (public.dsv_is_founder());

drop policy if exists "dsv_settings_update" on public.dsv_donate_settings;
create policy "dsv_settings_update" on public.dsv_donate_settings
  for update to authenticated
  using (public.dsv_is_founder()) with check (public.dsv_is_founder());

-- ---------------------------------------------------------
-- Realtime (чтобы заявки и лоты обновлялись без перезагрузки)
-- ---------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.dsv_donate_rewards;
exception when duplicate_object then null; when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.dsv_donate_orders;
exception when duplicate_object then null; when undefined_object then null;
end;
$$;

-- ---------------------------------------------------------
-- Примеры лотов (можно удалить или поменять через сайт)
-- ---------------------------------------------------------
insert into public.dsv_donate_rewards (title, description, perks, price, badge, color, sort)
select
  v.title,
  v.description,
  v.perks,
  v.price,
  v.badge,
  v.color,
  v.sort
from (
  values
    ('Спасибо',
     'Просто поддержка проекта: хостинг, домены и защита от DDoS.',
     array['Благодарность в игровом чате', 'Плашка «Спасибо» в Discord'],
     100, 'СПАСИБО', '#4cd137', 10),
    ('ХАЙП',
     'Приоритетный вход и отметки в чатах. Боевых и ресурсных преимуществ не даёт.',
     array['Вход поверх очереди', 'Цветной ник в чате', 'Плашка «ХАЙП» в списке игроков и в Discord'],
     249, 'ХАЙП', '#fbc531', 20),
    ('СТРОИТЕЛЬ',
     'Удобства для стройки без влияния на баланс PvP и добычу.',
     array['Личный контейнер для хранения', 'Телепорт к своей базе', 'Плашка «СТРОИТЕЛЬ»'],
     599, 'СТРОИТЕЛЬ', '#7bf55f', 30)
) as v(title, description, perks, price, badge, color, sort)
where not exists (select 1 from public.dsv_donate_rewards);
