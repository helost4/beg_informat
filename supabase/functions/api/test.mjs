/* Тест Edge Function без Supabase: мок REST + проверка контракта Apps Script.
   Запуск: node supabase/functions/api/test.mjs                         */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
const { handleRequest } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(name + (detail ? ': ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'получено ' + JSON.stringify(actual) + ', ожидалось ' + JSON.stringify(expected));
}

/* ---------------- МОК SUPABASE REST ---------------- */

function createDb() {
  return { users: [], attempts: [], nextAttemptId: 1, nextUserId: 1 };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeFetch(db) {
  return async function fetchImpl(url, options) {
    const u = new URL(String(url));
    const parts = u.pathname.split('/');
    const table = parts[parts.length - 1];
    const method = options.method || 'GET';
    const q = u.searchParams;
    const prefer = String((options.headers && options.headers.Prefer) || '');

    if (table === 'users') {
      if (method === 'GET') {
        let rows = db.users.slice();
        if (q.has('id')) rows = rows.filter(r => r.id === q.get('id').replace(/^eq\./, ''));
        if (q.has('login_key')) rows = rows.filter(r => r.login_key === q.get('login_key').replace(/^eq\./, ''));
        if (q.has('role')) rows = rows.filter(r => r.role === q.get('role').replace(/^eq\./, ''));
        if (q.has('limit')) rows = rows.slice(0, Number(q.get('limit')));
        return json(rows);
      }
      if (method === 'POST') {
        const body = JSON.parse(options.body);
        if (db.users.some(r => r.login_key === body.login_key)) {
          return json({ message: 'duplicate key value violates unique constraint', code: '23505' }, 409);
        }
        const row = Object.assign({}, body);
        db.users.push(row);
        return json(prefer.includes('representation') ? [row] : []);
      }
      if (method === 'PATCH') {
        const id = q.get('id').replace(/^eq\./, '');
        const body = JSON.parse(options.body);
        const row = db.users.find(r => r.id === id);
        if (!row) return json([]);
        Object.assign(row, body);
        return json(prefer.includes('representation') ? [row] : []);
      }
    }

    if (table === 'attempts') {
      if (method === 'GET') {
        let rows = db.attempts.slice();
        const filters = ['user_id', 'client_id', 'student_name', 'class_name'];
        filters.forEach(key => {
          if (!q.has(key)) return;
          const raw = q.get(key);
          if (raw === 'is.null') rows = rows.filter(r => r[key] == null);
          else {
            const value = raw.replace(/^eq\./, '');
            rows = rows.filter(r => String(r[key] ?? '') === value);
          }
        });
        const order = q.get('order') || '';
        if (order.includes('created_at.desc')) {
          rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        }
        if (q.has('limit')) rows = rows.slice(0, Number(q.get('limit')));
        return json(rows);
      }
      if (method === 'POST') {
        const body = JSON.parse(options.body);
        if (body.client_id && db.attempts.some(r => r.client_id === body.client_id)) {
          // Supabase с resolution=ignore-duplicates возвращает пустой массив.
          return json([]);
        }
        const row = Object.assign({ id: db.nextAttemptId++ }, body);
        db.attempts.push(row);
        return json(prefer.includes('representation') ? [row] : []);
      }
    }

    return json({ message: 'unexpected request ' + method + ' ' + url }, 404);
  };
}

const TEST_SECRET = 'test-token-secret-123';
const deps = db => ({
  env: {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    ACCOUNT_TOKEN_SECRET: TEST_SECRET
  },
  fetchImpl: makeFetch(db)
});

function post(body, db) {
  return handleRequest(new Request('https://example.supabase.co/functions/v1/api', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }), deps(db)).then(r => r.json());
}

/* ---------------- КРИПТО КАК В APPS SCRIPT ---------------- */

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacB64(message, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
async function legacyToken(accountId, exp) {
  const payload = b64url(Buffer.from(JSON.stringify({ sub: accountId, exp })));
  return payload + '.' + await hmacB64(payload, TEST_SECRET);
}
function legacyAccount(db, overrides) {
  const acc = Object.assign({
    id: 'u-' + db.nextUserId++,
    name: 'Иванов Иван',
    class_name: '6 класс',
    track: 'standard',
    login_key: 'иванов иван|6 класс',
    password_salt: 'oldsalt',
    password_hash: '', // заполняется await below
    role: 'student',
    scope: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  }, overrides || {});
  db.users.push(acc);
  return acc;
}
async function legacyPassword(acc, password) {
  acc.password_hash = await sha256Hex(acc.password_salt + password);
}

/* ---------------- ТЕСТЫ ---------------- */

const run = async () => {
  // 1. Регистрация: роль student, формат токена с паддингом как в Apps Script.
  {
    const db = createDb();
    const res = await post({ action: 'register', name: 'Петров Пётр', className: '5 класс',
      password: 'secret123', track: 'ege', role: 'admin' }, db);
    check('register ok', res.ok === true, JSON.stringify(res));
    eq('register role всегда student', res.account.role, 'student');
    eq('register account fields', Object.keys(res.account).sort(),
      ['className', 'id', 'name', 'role', 'scope', 'track']);
    check('токен из двух частей', String(res.token).split('.').length === 2);
    const [payload, signature] = res.token.split('.');
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    eq('payload побайтово как в Apps Script', payload, b64url(Buffer.from(JSON.stringify(decoded))));
    eq('подпись побайтово как в Apps Script', signature, await hmacB64(payload, TEST_SECRET));
    check('exp ~ 30 дней', decoded.exp - Date.now() > 29 * 864e5, String(decoded.exp - Date.now()));
  }

  // 2. Вход по старому хешу и старому токену.
  {
    const db = createDb();
    const acc = legacyAccount(db);
    await legacyPassword(acc, 'qwerty1');
    const res = await post({ action: 'login', name: acc.name, className: acc.class_name,
      password: 'qwerty1' }, db);
    check('login по legacy-хешу', res.ok === true, JSON.stringify(res));
    eq('login account id', res.account.id, acc.id);

    const oldToken = await legacyToken(acc.id, Date.now() + 864e5);
    const withOldToken = await post({ action: 'myResults', token: oldToken }, db);
    check('старый токен принят', withOldToken.ok === true, JSON.stringify(withOldToken));
  }

  // 3. Вход по роли (метка в поле className).
  {
    const db = createDb();
    const teacher = legacyAccount(db, { name: 'Сидорова Анна', class_name: '11 класс', role: 'teacher', scope: '6 класс;5 класс' });
    await legacyPassword(teacher, 'teacher1');
    const res = await post({ action: 'login', name: teacher.name, className: 'Учитель', password: 'teacher1' }, db);
    check('login по роли Учитель', res.ok === true && res.account.role === 'teacher', JSON.stringify(res));

    const bad = await post({ action: 'login', name: 'Нет Такого', className: 'Администратор', password: 'x' }, db);
    eq('нет аккаунта по роли', bad.error, 'NO_ACCOUNT');
  }

  // 4. saveResult идемпотентен по clientId.
  {
    const db = createDb();
    const acc = legacyAccount(db);
    await legacyPassword(acc, 'qwerty1');
    const login = await post({ action: 'login', name: acc.name, className: acc.class_name, password: 'qwerty1' }, db);
    const token = login.token;
    const result = { lesson: 'Тренажер Сети', variant: 'Trainer L1', score: 4, maxScore: 5,
      grade: 4, workType: 'trainer-level', clientId: 'offline-abc' };

    const r1 = await post({ action: 'saveResult', token, result }, db);
    const r2 = await post({ action: 'saveResult', token, result }, db);
    check('saveResult ok', r1.ok && r2.ok, JSON.stringify([r1, r2]));
    eq('saveResult row', r1.row, 1);
    eq('нет дубля по clientId', db.attempts.length, 1);
    eq('row совпадает при повторе', r2.row, r1.row);
    eq('workType сохранён', db.attempts[0].work_type, 'trainer-level');
    eq('user_id сохранён', db.attempts[0].user_id, acc.id);
  }

  // 5. myResults: свои + legacy по имя|класс, сортировка и лимит полей.
  {
    const db = createDb();
    const acc = legacyAccount(db);
    await legacyPassword(acc, 'qwerty1');
    db.attempts.push(
      { id: 1, user_id: acc.id, student_name: acc.name, class_name: acc.class_name,
        lesson: 'A', variant: '1', score: 1, max_score: 2, grade: 3, work_type: 'test',
        created_at: '2026-01-01T00:00:00.000Z' },
      { id: 2, user_id: null, student_name: acc.name, class_name: acc.class_name,
        lesson: 'B', variant: '2', score: 2, max_score: 2, grade: 5, work_type: 'test',
        created_at: '2026-02-01T00:00:00.000Z' },
      { id: 3, user_id: 'other', student_name: 'Другой', class_name: '6 класс',
        lesson: 'C', variant: '3', score: 0, max_score: 2, grade: 2, work_type: 'test',
        created_at: '2026-03-01T00:00:00.000Z' }
    );
    const res = await post({ action: 'myResults', token: await legacyToken(acc.id, Date.now() + 864e5) }, db);
    check('myResults ok', res.ok === true, JSON.stringify(res));
    eq('myResults count', res.results.length, 2);
    eq('myResults sort desc', res.results.map(r => r.lesson), ['B', 'A']);
    eq('myResults поля', Object.keys(res.results[0]).sort(),
      ['grade', 'lesson', 'maxScore', 'score', 'timestamp', 'variant', 'workType']);
  }

  // 6. viewResults: teacher/parent/admin и исключение служебных аккаунтов.
  {
    const db = createDb();
    const admin = legacyAccount(db, { id: 'admin', name: 'Админ', class_name: 'Администратор', role: 'admin' });
    const teacher = legacyAccount(db, { id: 'teacher', name: 'Учитель', class_name: 'Учитель', role: 'teacher', scope: '6 класс' });
    const parent = legacyAccount(db, { id: 'parent', name: 'Родитель', class_name: 'Родитель', role: 'parent', scope: 'иванов иван|6 класс' });
    const student = legacyAccount(db, { id: 'student', name: 'Иванов Иван', class_name: '6 класс', role: 'student' });
    const other = legacyAccount(db, { id: 'other', name: 'Петров Пётр', class_name: '5 класс', role: 'student' });
    [admin, teacher, parent, student, other].forEach(a => { a.password_hash = 'x'; });
    const mkRow = (id, user, lesson, cls) => ({ id, user_id: user.id, student_name: user.name,
      class_name: cls, lesson, variant: 'A', score: 4, max_score: 5, grade: 4,
      work_type: 'test', created_at: '2026-0' + id + '-01T00:00:00.000Z' });
    db.attempts.push(mkRow(1, student, 'Урок6', '6 класс'), mkRow(2, other, 'Урок5', '5 класс'),
      mkRow(3, admin, 'Служебный', 'Администратор'));

    const asTeacher = await post({ action: 'viewResults', token: await legacyToken('teacher', Date.now() + 864e5) }, db);
    eq('teacher видит только свой класс', asTeacher.results.map(r => r.lesson), ['Урок6']);
    eq('teacher scope', asTeacher.scope.classes, ['6 класс']);

    const asParent = await post({ action: 'viewResults', token: await legacyToken('parent', Date.now() + 864e5) }, db);
    eq('parent видит только ребёнка', asParent.results.map(r => r.lesson), ['Урок6']);
    eq('parent scope', asParent.scope.childKeys, ['иванов иван|6 класс']);

    const asAdmin = await post({ action: 'viewResults', token: await legacyToken('admin', Date.now() + 864e5) }, db);
    eq('admin видит все ученические строки', asAdmin.results.map(r => r.lesson).sort(), ['Урок5', 'Урок6']);
    eq('студенты aggregated', asAdmin.students.length, 2);
    check('нет _tsMs в ответе', !JSON.stringify(asAdmin).includes('_tsMs'));
  }

  // 7. Админ-действия.
  {
    const db = createDb();
    const admin = legacyAccount(db, { id: 'admin', name: 'Админ', class_name: 'Администратор', role: 'admin' });
    admin.password_hash = 'x';
    const token = await legacyToken('admin', Date.now() + 864e5);

    const created = await post({ action: 'adminCreateAccount', token, name: 'Новый Учитель',
      className: 'Учитель', password: 'pass123', role: 'teacher', scope: '6 класс' }, db);
    check('adminCreateAccount ok', created.ok === true, JSON.stringify(created));
    eq('созданная роль', created.account.role, 'teacher');
    eq('создан scope', created.account.scope, '6 класс');

    const set = await post({ action: 'adminSetRole', token, accountId: created.account.id,
      role: 'parent', scope: 'Иванов Иван|6 класс' }, db);
    eq('adminSetRole роль', set.account.role, 'parent');

    const reset = await post({ action: 'adminResetPassword', token,
      accountId: created.account.id, newPassword: 'newpass1' }, db);
    eq('adminResetPassword ok', reset.ok, true);
    const acc = db.users.find(u => u.id === created.account.id);
    eq('пароль перехеширован', acc.password_hash, await sha256Hex(acc.password_salt + 'newpass1'));

    const last = await post({ action: 'adminSetRole', token, accountId: 'admin', role: 'student', scope: '' }, db);
    eq('защита последнего админа', last.error, 'LAST_ADMIN');

    const forbidden = await post({ action: 'adminListAccounts', token: await legacyToken('student', Date.now() + 864e5) }, db);
    eq('не админ не проходит', forbidden.error, 'AUTH_REQUIRED');
  }

  // 8. Legacy POST без action и ошибки.
  {
    const db = createDb();
    const legacy = await post({ studentName: 'Иванов Иван', className: '6 класс',
      lesson: 'Старый', score: 3, maxScore: 4 }, db);
    eq('legacy POST result', legacy.result, 'success');
    eq('legacy POST row', legacy.row, 1);
    eq('legacy client_id', db.attempts[0].client_id, null);

    const unknown = await post({ action: 'noSuchAction' }, db);
    eq('unknown action', unknown.error, 'UNKNOWN_ACTION');
    const badToken = await post({ action: 'myResults', token: 'broken' }, db);
    eq('bad token', badToken.error, 'AUTH_REQUIRED');
    const expired = await post({ action: 'myResults', token: await legacyToken('u', Date.now() - 1000) }, db);
    eq('expired token', expired.error, 'TOKEN_EXPIRED');
  }

  // 9. Подклассы: смена класса, охват базовым классом и обновление scope родителя.
  {
    const db = createDb();
    const admin = legacyAccount(db, { id: 'admin', name: 'Админ', class_name: 'Администратор', role: 'admin' });
    const teacher = legacyAccount(db, { id: 'teacher', name: 'Учитель', class_name: 'Учитель',
      role: 'teacher', scope: '5 класс' });
    const parent = legacyAccount(db, { id: 'parent', name: 'Родитель', class_name: 'Родитель',
      role: 'parent', scope: 'иванов иван|5 класс' });
    const student = legacyAccount(db, { id: 'student', name: 'Иванов Иван', class_name: '5 класс', role: 'student' });
    [admin, teacher, parent, student].forEach(a => { a.password_hash = 'x'; });

    const adminToken = await legacyToken('admin', Date.now() + 864e5);
    const teacherToken = await legacyToken('teacher', Date.now() + 864e5);
    const studentToken = await legacyToken('student', Date.now() + 864e5);

    db.attempts.push({ id: 1, user_id: null, student_name: 'Иванов Иван', class_name: '5 класс',
      lesson: 'Старый урок', variant: 'A', score: 4, max_score: 5, grade: 4,
      work_type: 'test', created_at: '2026-01-01T00:00:00.000Z' });

    const bad = await post({ action: 'setStudentClass', token: adminToken,
      accountId: 'student', className: 'пять а' }, db);
    eq('некорректный подкласс отклонён', bad.error, 'BAD_REQUEST');

    const byStudent = await post({ action: 'setStudentClass', token: studentToken,
      accountId: 'student', className: '5а' }, db);
    eq('ученик не может менять подкласс', byStudent.error, 'FORBIDDEN');

    const outside = await post({ action: 'setStudentClass', token: teacherToken,
      accountId: 'student', className: '6а' }, db);
    eq('учитель не может выйти за scope', outside.error, 'FORBIDDEN');

    const changed = await post({ action: 'setStudentClass', token: adminToken,
      accountId: 'student', className: '5-а' }, db);
    eq('админ перевёл в 5а', changed.account.className, '5а');
    eq('login_key обновлён', db.users.find(u => u.id === 'student').login_key, 'иванов иван|5а');
    eq('scope родителя обновлён', db.users.find(u => u.id === 'parent').scope, 'иванов иван|5а');

    const own = await post({ action: 'myResults', token: studentToken }, db);
    eq('старая история видна после смены', own.results.map(r => r.lesson), ['Старый урок']);

    const parentView = await post({ action: 'viewResults',
      token: await legacyToken('parent', Date.now() + 864e5) }, db);
    eq('родитель видит старую работу', parentView.results.map(r => r.lesson), ['Старый урок']);

    const teacherView = await post({ action: 'viewResults', token: teacherToken }, db);
    eq('учитель видит 5а через базовый класс', teacherView.students.length, 1);

    const teacherChanged = await post({ action: 'setStudentClass', token: teacherToken,
      accountId: 'student', className: '5б' }, db);
    eq('учитель сменил букву', teacherChanged.account.className, '5б');

    await post({ action: 'register', name: 'Иванов Иван', className: '5в', password: 'secret123' }, db);
    const conflict = await post({ action: 'setStudentClass', token: adminToken,
      accountId: 'student', className: '5в' }, db);
    eq('конфликт подкласса', conflict.error, 'ACCOUNT_EXISTS');
  }

  const ok = failures.length === 0;
  console.log((ok ? '✅' : '❌') + ' Supabase API: ' + passed + ' проверок пройдено' +
    (failures.length ? ', ошибок ' + failures.length : ''));
  failures.forEach(f => console.log('  - ' + f));
  if (!ok) process.exitCode = 1;
};

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
