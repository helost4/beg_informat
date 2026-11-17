-- ============================================================
-- ИМПОРТ ДАННЫХ ИЗ GOOGLE ТАБЛИЦЫ (шаги 2 и 3 плана)
-- 1. Сначала выполните schema.sql.
-- 2. Выгрузите листы «Аккаунты» и «Лист1» в CSV.
-- 3. Импортируйте CSV в raw-таблицы ниже через Table Editor
--    (все колонки — text, заголовки должны совпадать с заголовками листа).
-- 4. Выполните этот файл целиком. Повторный запуск безопасен.
-- ============================================================

-- Названия колонок повторяют заголовки Apps Script, чтобы CSV вставлялся как есть.
create table if not exists public.import_accounts_raw (
  "id" text, "name" text, "className" text, "track" text, "loginKey" text,
  "salt" text, "passwordHash" text, "createdAt" text, "updatedAt" text,
  "role" text, "scope" text
);

create table if not exists public.import_results_raw (
  "timestamp" text, "accountId" text, "studentName" text, "className" text,
  "lesson" text, "variant" text, "score" text, "maxScore" text,
  "grade" text, "workType" text
);

-- Google Sheets экспортирует даты в зависимости от локали: ISO, ДД.ММ.ГГГГ
-- или ММ/ДД/ГГГГ. Пробуем несколько форматов, при неудаче — now().
create or replace function public.import_ts_(value text)
returns timestamptz language plpgsql as $$
begin
  if value is null or btrim(value) = '' then return now(); end if;
  begin return btrim(value)::timestamptz; exception when others then null; end;
  begin return to_timestamp(btrim(value), 'DD.MM.YYYY HH24:MI:SS'); exception when others then null; end;
  begin return to_timestamp(btrim(value), 'DD.MM.YYYY'); exception when others then null; end;
  begin return to_timestamp(btrim(value), 'MM/DD/YYYY HH24:MI:SS'); exception when others then null; end;
  begin return to_timestamp(btrim(value), 'MM/DD/YYYY'); exception when others then null; end;
  return now();
end; $$;

-- ---------- Шаг 2: аккаунты ----------
-- Идентификаторы, соли и хеши сохраняем как есть: старые пароли продолжают работать.
insert into public.users (
  id, name, class_name, track, login_key,
  password_salt, password_hash, role, scope, created_at, updated_at
)
select
  nullif(btrim(r."id"), '')                          as id,
  nullif(btrim(r."name"), '')                        as name,
  coalesce(btrim(r."className"), '')                 as class_name,
  case when lower(btrim(coalesce(r."track", ''))) = 'ege'
       then 'ege' else 'standard' end                as track,
  lower(btrim(coalesce(r."loginKey",
    btrim(coalesce(r."name", '')) || '|' || btrim(coalesce(r."className", ''))))) as login_key,
  coalesce(r."salt", '')                             as password_salt,
  coalesce(r."passwordHash", '')                     as password_hash,
  case when lower(btrim(coalesce(r."role", ''))) in ('student', 'teacher', 'parent', 'admin')
       then lower(btrim(r."role")) else 'student' end as role,
  coalesce(btrim(r."scope"), '')                     as scope,
  public.import_ts_(r."createdAt") as created_at,
  public.import_ts_(r."updatedAt") as updated_at
from public.import_accounts_raw r
where nullif(btrim(r."id"), '') is not null
  and nullif(btrim(r."name"), '') is not null
on conflict (id) do nothing;

-- ---------- Шаг 3: результаты ----------
-- legacy_row — номер строки CSV для сверки с Google Sheets.
-- user_id берём из accountId, а для старых строк без него — по loginKey(имя|класс).
with numbered as (
  select
    row_number() over (order by r.ctid) as legacy_row,
    r.*
  from public.import_results_raw r
)
insert into public.attempts (
  client_id, user_id, student_name, class_name, lesson, variant,
  score, max_score, grade, work_type, created_at, legacy_row
)
select
  'legacy:' || n.legacy_row                                  as client_id,
  coalesce(u2.id, u.id)                                      as user_id,
  coalesce(btrim(n."studentName"), '')                       as student_name,
  coalesce(btrim(n."className"), '')                         as class_name,
  coalesce(btrim(n."lesson"), '')                            as lesson,
  coalesce(btrim(n."variant"), '')                           as variant,
  coalesce(nullif(btrim(n."score"), '')::numeric, 0)         as score,
  coalesce(nullif(btrim(n."maxScore"), '')::numeric, 0)      as max_score,
  case
    when nullif(btrim(n."grade"), '')::numeric between 2 and 5
      then round(nullif(btrim(n."grade"), '')::numeric)::integer
    else 2
  end                                                        as grade,
  coalesce(nullif(btrim(n."workType"), ''), 'test')          as work_type,
  public.import_ts_(n."timestamp")                            as created_at,
  n.legacy_row                                               as legacy_row
from numbered n
left join public.users u
  on u.login_key = lower(btrim(n."studentName") || '|' || btrim(n."className"))
left join public.users u2
  on u2.id = nullif(btrim(n."accountId"), '')
on conflict (client_id) do nothing;

-- ---------- Проверка после импорта ----------
-- Количество аккаунтов и результатов должно совпасть с CSV.
-- select count(*) from public.users;
-- select count(*) from public.attempts;
-- select count(*) filter (where user_id is null) as без_привязки from public.attempts;
