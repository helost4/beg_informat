-- ============================================================
-- СХЕМА SUPABASE ДЛЯ ИНТЕРАКТИВНЫХ УРОКОВ ИНФОРМАТИКИ
-- Эквивалент двух листов Apps Script: «Аккаунты» и «Лист1».
-- Выполнить в SQL Editor Supabase перед деплоем Edge Function.
-- ============================================================

-- Уникальность ключа входа (имя|класс) гарантируется на уровне БД.
create table if not exists public.users (
  id             text primary key,
  name           text not null,
  class_name     text not null,
  track          text not null default 'standard',
  login_key      text not null unique,
  password_salt  text not null,
  password_hash  text not null,
  role           text not null default 'student'
                 check (role in ('student', 'teacher', 'parent', 'admin')),
  scope          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.users is
  'Аккаунты. Идентификаторы и хеши паролей переносятся из Apps Script без изменений.';

-- Append-only журнал попыток. Заменяет лист «Лист1».
create table if not exists public.attempts (
  id           bigint generated always as identity primary key,
  client_id    text unique,
  user_id      text references public.users(id) on delete set null,
  student_name text not null default '',
  class_name   text not null default '',
  lesson       text not null default '',
  variant      text not null default '',
  score        numeric not null default 0,
  max_score    numeric not null default 0,
  grade        integer not null default 2,
  work_type    text not null default 'test',
  created_at   timestamptz not null default now(),
  legacy_row   integer
);

comment on column public.attempts.client_id is
  'Ключ идемпотентности: _id/clientId из клиентской очереди. Повторная отправка не создаёт дубль.';
comment on column public.attempts.legacy_row is
  'Номер строки в старом листе Google Sheets — для сверки при миграции.';

create index if not exists attempts_user_created_idx
  on public.attempts (user_id, created_at desc);
create index if not exists attempts_lesson_type_idx
  on public.attempts (work_type, lesson);
create index if not exists attempts_legacy_name_idx
  on public.attempts (student_name, class_name)
  where user_id is null;

-- Текущее состояние урока. Раньше жило только в localStorage браузера.
create table if not exists public.progress (
  user_id     text not null references public.users(id) on delete cascade,
  lesson      text not null,
  scope       text not null,
  started_at  timestamptz,
  finished_at timestamptz,
  score       numeric,
  max_score   numeric,
  grade       integer,
  result_sent boolean not null default false,
  payload     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, lesson, scope)
);

comment on column public.progress.scope is
  'Например: variant:A, homework, exam:ege:13:block1.';

-- Edge Function работает от service_role и минует RLS. Прямой доступ
-- anon/authenticated намеренно запрещён: вся логика прав живёт в /api.
alter table public.users    enable row level security;
alter table public.attempts enable row level security;
alter table public.progress enable row level security;
