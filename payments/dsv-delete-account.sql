-- =========================================================
--  DSV-Zombi — удаление аккаунта игрока (пример: Pivxv)
-- ---------------------------------------------------------
--  Как применить:
--   1) Открой проект на https://supabase.com
--   2) SQL Editor -> New query
--   3) Вставь весь файл и нажми Run
--  Удаление необратимо: пропадёт вход, профиль, участие в командах.
-- =========================================================

begin;

-- 1. Убрать из состава команд
delete from public.team_members
where lower(nick) = lower('Pivxv');

-- 2. Убрать голоса, которые он оставлял
delete from public.votes
where lower(voter) = lower('Pivxv');

-- 3. Снять лидерство / заместительство (сами команды остаются)
update public.teams set leader_nick = null where lower(leader_nick) = lower('Pivxv');
update public.teams set deputy_nick = null where lower(deputy_nick) = lower('Pivxv');

-- 4. Удалить профиль
delete from public.profiles
where lower(nick) = lower('Pivxv');

-- 5. Удалить сам аккаунт входа (email вида ник@players.dsv-zombi.local)
delete from auth.users
where lower(email) = 'pivxv@players.dsv-zombi.local';

commit;

-- Проверка: должно вернуть 0 строк
select count(*) as left_profiles
from public.profiles
where lower(nick) = lower('Pivxv');
