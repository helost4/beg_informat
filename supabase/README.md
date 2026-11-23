# Supabase: миграция аккаунтов и результатов

Этот каталог содержит заготовку для перехода с Google Apps Script (`apps-script/Code.gs`) на Supabase **без изменения клиентского контракта**.

## Что уже готово

| Файл | Назначение |
|------|------------|
| `schema.sql` | Таблицы `users`, `attempts`, `progress`, индексы, RLS. |
| `import.sql` | Импорт CSV-выгрузок листов «Аккаунты» и «Лист1». |
| `functions/api/index.ts` | Точка входа Edge Function (CLI ожидает `index.ts`). |
| `functions/api/index.js` | Логика `/functions/v1/api` — drop-in замена `/exec`. |
| `functions/api/test.mjs` | 71 проверка контракта API на моке Supabase REST. |
| `tests/clientid-test.js` | 15 проверок `clientId`, офлайн-очереди и подклассов. |
| `../shared/account.js` | Клиент теперь всегда шлёт `clientId` (идемпотентность). |

**Важно:** dual-write/тень (шаг 4 плана) ещё не реализован. Сейчас Edge Function пишет только в Supabase. Переключать трафик следует после импорта и сверки.

## Схема данных

- `users.id` — прежний UUID из Apps Script. Соли и хеши паролей переносятся без изменений, поэтому старые пароли работают.
- `users.login_key` — уникальный ключ `имя|класс` в нижнем регистре; при смене подкласса пересчитывается;
- `users.class_name` — базовый (`5 класс`) или подкласс (`5а`, `5б`).
- `attempts.client_id` — ключ идемпотентности из `_id`/`clientId` клиента. Повторная отправка после потери ответа не создаёт дубль.
- `attempts.legacy_row` — номер строки CSV для сверки со старым листом.
- `progress` — материализованное состояние урока; сейчас клиент по-прежнему хранит черновик в `localStorage`.
- RLS включён, политик нет: весь доступ идёт через Edge Function с `service_role`. Прямой anon-доступ запрещён.

## 1. Создание проекта и секретов

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase secrets set \
  SUPABASE_URL=https://<PROJECT_REF>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
  ACCOUNT_TOKEN_SECRET=<секрет из Apps Script>
```

`ACCOUNT_TOKEN_SECRET` должен быть **тем же самым**, что лежит в Script Properties Apps Script под ключом `ACCOUNT_TOKEN_SECRET` (см. `PROP_SECRET` в `Code.gs`). Иначе старые токены перестанут проходить проверку.

С service_role ключом нужно обращаться осторожно: он обходит RLS и не должен попадать в браузер.

## 2. Схема

Выполните `supabase/schema.sql` в SQL Editor или через CLI:

```bash
supabase db push
```

(если файл лежит в `supabase/migrations`, либо просто вставьте содержимое в SQL Editor).

## 3. Выгрузка и импорт данных

1. В Google Таблице скачайте листы «Аккаунты» и «Лист1» как CSV.
2. В Supabase: Table Editor → создайте таблицы `import_accounts_raw` и `import_results_raw` (DDL есть в начале `import.sql`) → Import data из CSV. Все колонки должны быть `text`, заголовки — как в листе (`className`, `passwordHash`, `maxScore` и т. д.).
3. Выполните `import.sql` целиком. Повторный запуск безопасен (`on conflict do nothing`).
4. Сверьте счётчики:

```sql
select count(*) from public.users;
select count(*) from public.attempts;
select count(*) filter (where user_id is null) as без_привязки from public.attempts;
```

Перед срезом дождитесь, пока клиенты вызовут `Account.flushQueue()` (открыть `lessons.html`), иначе офлайн-результаты не попадут в выгрузку.

## 4. Деплой API

```bash
supabase functions deploy api --no-verify-jwt
```

`--no-verify-jwt` нужен, потому что клиент использует собственный HMAC-токен из `localStorage`, а не Supabase Auth.

Проверка:

```bash
curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/api' \
  -H 'Content-Type: text/plain;charset=utf-8' \
  -d '{"action":"login","name":"...","className":"6 класс","password":"..."}'
```

В ответе должен быть тот же формат, что у Apps Script: `{ok, result, token, account}` или `{ok:false, result:'error', error, message}`.

### Первый администратор

Публичная регистрация отключена. Если аккаунты ещё не импортированы из Apps
Script, создайте первого администратора в Supabase SQL Editor:

```sql
-- если расширение ещё не включено
create extension if not exists pgcrypto with schema extensions;

-- ЗАМЕНИТЕ три значения: имя, соль и пароль
insert into public.users
  (id, name, class_name, track, login_key, password_salt, password_hash,
   role, scope, created_at, updated_at)
values
  (gen_random_uuid()::text,
   'Иванов Иван',
   'Администратор',
   'standard',
   'иванов иван|администратор',
   'замените-на-длинную-случайную-соль',
   encode(digest('замените-на-длинную-случайную-соль' || 'сложныйпароль', 'sha256'), 'hex'),
   'admin',
   '',
   now(),
   now());
```

Соль и пароль в примере обязательно замените. Пароль в таблице не хранится:
сохраняется только `SHA-256(соль || пароль)`. Вход выполняйте, выбрав в форме
класс «Администратор» и введя те же имя и пароль. Если функция `digest` не
найдена, используйте `extensions.digest(...)`.

### Подклассы

Логика полностью совпадает с Apps Script (версия `2026-11-23-admin-delete-v1`):

```
setStudentClass       { token, accountId, className } → { ok, result, account }
createStudentAccount  { token, name, className } → { ok, result, created[], errors[] }
                      { token, students: [{name, className}] }
adminUpdateAccount    { token, accountId, name?, className?, newPassword?, generatePassword? }
                                                → { ok, result, account, credentials? }
adminDeleteAccount    { token, accountId }        → { ok, result, account, deleted }
```

Публичная регистрация (`register`) отключена: сервер возвращает
`REGISTRATION_DISABLED`. Учеников создаёт учитель (только в своём `scope`) или
администратор; пароль генерируется на сервере и показывается один раз.
`adminUpdateAccount` доступен только администратору и только для роли `student`.
`adminDeleteAccount` тоже доступен только администратору: он удаляет аккаунт,
все результаты ученика (включая старые строки без `user_id`) и ключ ребёнка
в `scope` родителей. Ответ содержит `deleted.results` и `deleted.parentLinks`.
Последнего администратора удалить нельзя (`LAST_ADMIN`).

- доступно `teacher` и `admin`; учитель ограничен своим `scope`, где `5 класс` включает `5а`, `5б`, …;
- `className` нормализуется (`5 а` / `5-а` / `5А` → `5а`), некорректные значения — `BAD_REQUEST`, занятые — `ACCOUNT_EXISTS`;
- обновляются `login_key` ученика и ключи детей в `scope` родителей;
- каталог уроков и экзаменов работает по базовому классу: `5а` видит материалы `5 класс`;
- старые строки без `user_id` сопоставляются по имени и базовому классу, поэтому история сохраняется;
- ответы `viewResults` для привязанных строк показывают текущий класс ученика.

## 5. Переключение клиента

В `shared/account.js` уже есть переопределение URL:

```js
window.ACCOUNT_API_URL = 'https://<PROJECT_REF>.supabase.co/functions/v1/api';
```

Настройте его **до подключения** `shared/account.js` (например, inline-скриптом в `<head>` на всех страницах или через общий сниппет). Менять сами страницы не нужно.

Откат — удалить эту строку: клиент снова пойдёт на старый `/exec`.

## 6. Тесты

```bash
node supabase/functions/api/test.mjs           # 71 проверка
node supabase/tests/clientid-test.js           # 15 проверок
```

## Порядок включения (рекомендуемый)

1. Импортировать `users` и проверить вход старых пользователей и роли.
2. Импортировать `attempts`, сверить количество строк и истории учеников.
3. Включить `window.ACCOUNT_API_URL` на тестовом аккаунте, проверить `lessons.html`, `teacher.html`, `parent.html`, `admin.html` и «Сети» (там отображается `row` из ответа).
4. После успешной сверки — переключить всех. Apps Script оставить архивом только для чтения.

## Ограничения первой итерации

- Токен остаётся самодельным HMAC с 30-дневным TTL, Supabase Auth не используется.
- `progress` ещё не читается с сервера; `localStorage` остаётся рабочим хранилищем черновика.
- Старые дубли в таблице при импорте не удаляются: у них `client_id = legacy:<row>`.
- dual-write в Apps Script не включён, поэтому окно переключения лучше делать коротким.
