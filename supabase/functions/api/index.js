/* ============================================================
   SUPABASE EDGE FUNCTION: /api

   Полная преемственность контракта apps-script/Code.gs:
   те же действия, поля запроса и формат ответа. Клиенту достаточно
   задать window.ACCOUNT_API_URL = '<url>/functions/v1/api'.

   Переменные окружения:
     SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY
     ACCOUNT_TOKEN_SECRET   — тот же секрет, что в Apps Script PropertiesService
   ============================================================ */

const VALID_ROLES = ['student', 'teacher', 'parent', 'admin'];
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class AppError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code || 'SERVER_ERROR';
  }
}

function fail(code, message) {
  throw new AppError(code, message);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, apikey, authorization, x-client-info',
    'access-control-max-age': '86400'
  };
}

function responseHeaders() {
  return Object.assign(
    { 'content-type': 'application/json; charset=utf-8' },
    corsHeaders()
  );
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders() });
}

function success(extra) {
  return Object.assign({ ok: true, result: 'success' }, extra || {});
}

function errorBody(err) {
  return {
    ok: false,
    result: 'error',
    error: err && err.code ? err.code : 'SERVER_ERROR',
    message: (err && err.message) || String(err)
  };
}

/* ---------------- ОКРУЖЕНИЕ И REST ---------------- */

function getEnv(name, deps) {
  if (deps.env && deps.env[name] !== undefined) return String(deps.env[name]);
  if (typeof Deno !== 'undefined' && Deno.env && Deno.env.get) {
    return Deno.env.get(name) || '';
  }
  return '';
}

function dbConfig(deps) {
  const url = getEnv('SUPABASE_URL', deps).replace(/\/+$/, '');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY', deps);
  if (!url || !key) {
    fail('SERVER_ERROR', 'SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не настроены.');
  }
  return { url, key };
}

async function db(method, table, opts, deps) {
  const cfg = dbConfig(deps);
  const qs = opts && opts.query ? '?' + opts.query : '';
  const headers = {
    apikey: cfg.key,
    Authorization: 'Bearer ' + cfg.key,
    'Content-Type': 'application/json'
  };
  if (opts && opts.prefer) headers.Prefer = opts.prefer;

  const fetchImpl = deps.fetchImpl || fetch;
  const res = await fetchImpl(cfg.url + '/rest/v1/' + table + qs, {
    method,
    headers,
    body: opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }

  if (!res.ok) {
    const msg = data && (data.message || data.hint || data.details)
      ? data.message || data.hint || data.details
      : (text || 'HTTP ' + res.status);
    fail('DB_ERROR', String(msg));
  }
  return data;
}

const ATTEMPT_COLUMNS = [
  'id', 'client_id', 'user_id', 'student_name', 'class_name',
  'lesson', 'variant', 'score', 'max_score', 'grade',
  'work_type', 'created_at', 'legacy_row'
].join(',');

function eq(value) {
  return encodeURIComponent(String(value == null ? '' : value));
}

async function getAccountById(id, deps) {
  const rows = await db('GET', 'users', {
    query: 'id=eq.' + eq(id) + '&limit=1'
  }, deps);
  return rows && rows.length ? accountFromRow(rows[0]) : null;
}

async function getAccountByLoginKey(key, deps) {
  const rows = await db('GET', 'users', {
    query: 'login_key=eq.' + eq(key) + '&limit=1'
  }, deps);
  return rows && rows.length ? accountFromRow(rows[0]) : null;
}

async function listAccounts(deps) {
  const rows = await db('GET', 'users', { query: 'select=*' }, deps);
  return (rows || []).map(accountFromRow);
}

async function insertAccount(data, deps) {
  const rows = await db('POST', 'users', {
    prefer: 'return=representation',
    body: data
  }, deps);
  return accountFromRow(Array.isArray(rows) && rows[0] ? rows[0] : data);
}

async function updateAccount(id, patch, deps) {
  const rows = await db('PATCH', 'users', {
    query: 'id=eq.' + eq(id),
    prefer: 'return=representation',
    body: patch
  }, deps);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return row ? accountFromRow(row) : getAccountById(id, deps);
}

async function countAdmins(deps) {
  const rows = await db('GET', 'users', {
    query: 'role=eq.admin&select=id'
  }, deps);
  return rows ? rows.length : 0;
}

async function insertAttempt(row, deps) {
  let rows = await db('POST', 'attempts', {
    query: 'on_conflict=client_id',
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: row
  }, deps);

  if ((!Array.isArray(rows) || !rows.length) && row.client_id) {
    rows = await db('GET', 'attempts', {
      query: 'client_id=eq.' + eq(row.client_id) + '&select=' + ATTEMPT_COLUMNS + '&limit=1'
    }, deps);
  }
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/* ---------------- ПРЕОБРАЗОВАНИЯ ---------------- */

function accountFromRow(r) {
  return {
    id: String(r.id || ''),
    name: String(r.name || ''),
    className: String(r.class_name || ''),
    track: String(r.track || 'standard'),
    salt: String(r.password_salt || ''),
    passwordHash: String(r.password_hash || ''),
    role: normalizeRole(r.role),
    scope: String(r.scope || ''),
    loginKey: String(r.login_key || ''),
    createdAt: r.created_at || ''
  };
}

function accountPublic(account) {
  return {
    id: String(account.id || ''),
    name: String(account.name || ''),
    className: String(account.className || ''),
    track: String(account.track || 'standard'),
    role: normalizeRole(account.role),
    scope: String(account.scope || '')
  };
}

function attemptToResult(r, includeAccount) {
  const ts = r.created_at ? new Date(r.created_at) : null;
  const tsMs = ts && !isNaN(ts.getTime()) ? ts.getTime() : 0;
  const out = {
    score: Number(r.score) || 0,
    maxScore: Number(r.max_score) || 0,
    grade: Number(r.grade) || 2,
    workType: String(r.work_type || ''),
    timestamp: ts ? ts.toISOString() : '',
    _tsMs: tsMs
  };

  if (includeAccount) {
    out.accountId = String(r.user_id || '');
    out.studentName = String(r.student_name || '');
    out.className = String(r.class_name || '');
  }
  out.lesson = String(r.lesson || '');
  out.variant = String(r.variant || '');
  return out;
}

function stripTs(results) {
  return results.map(function (r) {
    const copy = Object.assign({}, r);
    delete copy._tsMs;
    return copy;
  });
}

function sortByTimeDesc(a, b) {
  return b._tsMs - a._tsMs;
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeTrack(value) {
  return String(value || '').trim().toLowerCase() === 'ege' ? 'ege' : 'standard';
}

/** «5 а», «5-а», «5А» → «5а»; «5 класс» остаётся как есть. */
function normalizeClassName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  const withLetter = /^(\d{1,2})\s*(?:класс)?\s*-?\s*([а-яa-z])\s*$/i.exec(text);
  if (withLetter) return withLetter[1] + withLetter[2].toLowerCase();
  const base = /^(\d{1,2})\s*класс$/i.exec(text);
  if (base) return base[1] + ' класс';
  return text;
}

/** «5а» → «5 класс». */
function baseClass(className) {
  const text = normalizeClassName(className);
  const m = /^(\d{1,2})(?: класс|[а-яa-z])$/i.exec(text);
  return m ? m[1] + ' класс' : text;
}

function isValidClassName(className) {
  return /^\d{1,2}(?: класс|[а-яa-z])$/i.test(normalizeClassName(className));
}

function classMatchesScope(className, scopePart) {
  const exact = normalizeClassName(className).toLowerCase() ===
    normalizeClassName(scopePart).toLowerCase();
  const covered = baseClass(className).toLowerCase() ===
    normalizeClassName(scopePart).toLowerCase();
  return exact || covered;
}

function classListMatchesScope(classes, className) {
  return classes.some(function (part) { return classMatchesScope(className, part); });
}

function classEquivalent(left, right) {
  return normalizeClassName(left).toLowerCase() === normalizeClassName(right).toLowerCase() ||
    baseClass(left).toLowerCase() === baseClass(right).toLowerCase();
}

/** Ключ ребёнка в scope родителя («имя|класс») с учётом смены подкласса. */
function parentScopeMatches(childKeys, name, className) {
  const person = normalizeName(name).toLowerCase();
  return childKeys.some(function (key) {
    const bar = String(key || '').indexOf('|');
    if (bar === -1) return false;
    return normalizeName(String(key).slice(0, bar)).toLowerCase() === person &&
      classEquivalent(String(key).slice(bar + 1), className);
  });
}

function loginKey(name, className) {
  return (normalizeName(name) + '|' + normalizeClassName(className)).toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return VALID_ROLES.indexOf(role) !== -1 ? role : 'student';
}

function normalizeRoleStrict(value) {
  const role = String(value || '').trim().toLowerCase();
  if (VALID_ROLES.indexOf(role) === -1) {
    fail('BAD_REQUEST', 'Недопустимая роль: ' + String(value || ''));
  }
  return role;
}

function sanitizeScope(value) {
  return String(value || '').trim().slice(0, 2000);
}

function splitScope(scope) {
  return String(scope || '')
    .split(/[;,]/)
    .map(function (part) { return String(part || '').trim().toLowerCase(); })
    .filter(function (part) { return !!part; });
}

function toNumber(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function normalizeGrade(grade, score, maxScore) {
  let g = Number(grade);
  if (!isFinite(g) || g < 2 || g > 5) {
    const pct = maxScore ? score / maxScore * 100 : 0;
    if (pct >= 85) g = 5;
    else if (pct >= 65) g = 4;
    else if (pct >= 45) g = 3;
    else g = 2;
  }
  return Math.round(g);
}

function roleFromClassLabel(className) {
  const label = String(className || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (['администратор', 'администрация', 'админ', 'admin'].indexOf(label) !== -1) return 'admin';
  if (['учитель', 'учителя', 'педагог', 'teacher'].indexOf(label) !== -1) return 'teacher';
  if (['родитель', 'родители', 'parent'].indexOf(label) !== -1) return 'parent';
  return '';
}

function validateRegistration(name, className, password) {
  if (name.length < 3) fail('BAD_REQUEST', 'Введите фамилию и имя (минимум 3 символа).');
  if (!className) fail('BAD_REQUEST', 'Выберите класс.');
  if (password.length < 6) fail('BAD_REQUEST', 'Пароль должен быть не короче 6 символов.');
}

/* ---------------- КРИПТОГРАФИЯ (Web Crypto) ---------------- */

const webCrypto = globalThis.crypto;

function bytesToB64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // Apps Script Utilities.base64EncodeWebSafe сохраняет паддинг '=' (см. документацию).
  // Подпись HMAC считается по этой строке, поэтому формат должен совпадать побайтово.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlToBytes(text) {
  const padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256Hex(text) {
  const digest = await webCrypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(String(text))
  );
  return Array.from(new Uint8Array(digest))
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}

function randomSalt() {
  return webCrypto.randomUUID().replace(/-/g, '') +
    webCrypto.randomUUID().replace(/-/g, '');
}

async function hmacB64url(message, secret) {
  const key = await webCrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await webCrypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(message)
  );
  return bytesToB64url(new Uint8Array(signature));
}

async function hashPassword(salt, password) {
  return sha256Hex(String(salt) + String(password));
}

async function issueToken(accountId, deps) {
  const secret = getEnv('ACCOUNT_TOKEN_SECRET', deps);
  if (!secret) fail('SERVER_ERROR', 'ACCOUNT_TOKEN_SECRET не настроен.');
  const payload = { sub: accountId, exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = bytesToB64url(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signature = await hmacB64url(payloadB64, secret);
  return payloadB64 + '.' + signature;
}

async function verifyToken(token, deps) {
  const raw = String(token || '');
  const parts = raw.split('.');
  if (parts.length !== 2) fail('AUTH_REQUIRED', 'Нужно войти в аккаунт.');

  const secret = getEnv('ACCOUNT_TOKEN_SECRET', deps);
  if (!secret) fail('SERVER_ERROR', 'ACCOUNT_TOKEN_SECRET не настроен.');
  const expected = await hmacB64url(parts[0], secret);
  if (expected !== parts[1]) {
    fail('AUTH_REQUIRED', 'Сессия повреждена. Войдите заново.');
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  } catch (_) {
    fail('AUTH_REQUIRED', 'Сессия повреждена. Войдите заново.');
  }
  if (!payload || !payload.sub || !payload.exp) {
    fail('AUTH_REQUIRED', 'Сессия повреждена. Войдите заново.');
  }
  if (Date.now() > Number(payload.exp)) {
    fail('TOKEN_EXPIRED', 'Сессия истекла. Войдите заново.');
  }
  return payload;
}

async function accountFromToken(token, deps) {
  const payload = await verifyToken(token, deps);
  const account = await getAccountById(payload.sub, deps);
  if (!account) {
    fail('AUTH_REQUIRED', 'Аккаунт не найден. Войдите заново.');
  }
  return account;
}

function requireRole(account, roles) {
  const role = normalizeRole(account.role);
  if (roles.indexOf(role) === -1) {
    fail('FORBIDDEN', 'У вас нет доступа к этому разделу.');
  }
  return role;
}

/* ---------------- ДЕЙСТВИЯ ---------------- */

async function register(body, deps) {
  const name = normalizeName(body.name);
  const className = normalizeClassName(body.className);
  const track = normalizeTrack(body.track);
  const password = String(body.password || '');

  validateRegistration(name, className, password);

  const key = loginKey(name, className);
  if (await getAccountByLoginKey(key, deps)) {
    fail('ACCOUNT_EXISTS', 'Аккаунт с таким именем и классом уже существует. Войдите в него.');
  }

  const salt = randomSalt();
  const now = new Date().toISOString();
  const account = await insertAccount({
    id: webCrypto.randomUUID(),
    name: name,
    class_name: className,
    track: track,
    login_key: key,
    password_salt: salt,
    password_hash: await hashPassword(salt, password),
    role: 'student',
    scope: '',
    created_at: now,
    updated_at: now
  }, deps);

  return success({
    token: await issueToken(account.id, deps),
    account: accountPublic(account)
  });
}

async function login(body, deps) {
  const name = normalizeName(body.name);
  const className = normalizeClassName(body.className);
  const password = String(body.password || '');
  const requestedTrack = body.track ? normalizeTrack(body.track) : '';

  if (!name || !className || !password) {
    fail('BAD_REQUEST', 'Введите имя, класс и пароль.');
  }

  let account;
  const roleFromClass = roleFromClassLabel(className);

  if (roleFromClass) {
    const candidates = (await listAccounts(deps)).filter(function (a) {
      return a.name === name && a.role === roleFromClass;
    });
    if (!candidates.length) {
      const titles = { admin: 'Администратор', teacher: 'Учитель', parent: 'Родитель' };
      fail('NO_ACCOUNT',
        'Аккаунт «' + (titles[roleFromClass] || roleFromClass) +
        '» с таким именем не найден. Обратитесь к администратору.');
    }
    if (candidates.length > 1) {
      fail('BAD_REQUEST',
        'Найдено несколько аккаунтов с таким именем и ролью. Уточните имя или обратитесь к администратору.');
    }
    account = candidates[0];
  } else {
    account = await getAccountByLoginKey(loginKey(name, className), deps);
    if (!account) fail('NO_ACCOUNT', 'Аккаунт не найден. Зарегистрируйтесь.');
  }

  if (await hashPassword(account.salt, password) !== account.passwordHash) {
    fail('WRONG_PASSWORD', 'Неверный пароль.');
  }

  if (requestedTrack && requestedTrack !== account.track) {
    account = await updateAccount(account.id, {
      track: requestedTrack,
      updated_at: new Date().toISOString()
    }, deps);
  }

  return success({
    token: await issueToken(account.id, deps),
    account: accountPublic(account)
  });
}

async function saveResult(body, deps) {
  const account = await accountFromToken(body.token, deps);
  const result = body.result || {};

  const score = toNumber(result.score);
  const maxScore = toNumber(result.maxScore);
  const grade = normalizeGrade(result.grade, score, maxScore);
  const clientId = String(result.clientId || result.client_id || result._id || '')
    .trim() || null;

  const row = await insertAttempt({
    client_id: clientId,
    user_id: account.id,
    student_name: account.name,
    class_name: account.className,
    lesson: String(result.lesson || '').slice(0, 200),
    variant: String(result.variant || '').slice(0, 100),
    score: score,
    max_score: maxScore,
    grade: grade,
    work_type: String(result.workType || 'test').slice(0, 50),
    created_at: new Date().toISOString(),
    legacy_row: null
  }, deps);

  return success({
    row: row ? (row.legacy_row || row.id) : 0,
    accountId: account.id
  });
}

async function myResults(body, deps) {
  const account = await accountFromToken(body.token, deps);
  const select = '&select=' + ATTEMPT_COLUMNS;

  const own = await db('GET', 'attempts', {
    query: 'user_id=eq.' + eq(account.id) + select + '&order=created_at.desc&limit=500'
  }, deps);

  // Старые строки без user_id искали по «имя|класс». После смены «5 класс» → «5а»
  // строки старого потока тоже должны остаться в истории ученика.
  const legacy = await db('GET', 'attempts', {
    query: 'user_id=is.null' +
      '&student_name=eq.' + eq(account.name) +
      select + '&order=created_at.desc&limit=1000'
  }, deps);

  const seen = {};
  const results = [];
  (own || []).concat(legacy || []).forEach(function (row) {
    if (seen[row.id]) return;
    if (!row.user_id && !classEquivalent(row.class_name, account.className)) return;
    seen[row.id] = true;
    results.push(attemptToResult(row, false));
  });

  results.sort(sortByTimeDesc);
  return success({ results: stripTs(results.slice(0, 500)) });
}

async function viewResults(body, deps) {
  const caller = await accountFromToken(body.token, deps);
  const role = requireRole(caller, ['teacher', 'parent', 'admin']);

  let classes = [];
  let childKeys = [];
  if (role === 'teacher') classes = splitScope(caller.scope);
  if (role === 'parent') childKeys = splitScope(caller.scope);

  if ((role === 'teacher' && !classes.length) ||
      (role === 'parent' && !childKeys.length)) {
    return success({
      students: [], results: [],
      scope: { classes: classes, childKeys: childKeys }
    });
  }

  const rows = await db('GET', 'attempts', {
    query: 'select=' + ATTEMPT_COLUMNS + '&order=created_at.desc&limit=2000'
  }, deps);
  const accounts = await listAccounts(deps);

  const accountById = {};
  const accountByKey = {};
  accounts.forEach(function (acc) {
    if (!acc.id) return;
    accountById[acc.id] = acc;
    accountByKey[loginKey(acc.name, acc.className)] = acc;
  });

  const results = [];
  (rows || []).forEach(function (row) {
    const userId = String(row.user_id || '');
    const studentName = String(row.student_name || '');
    const className = String(row.class_name || '');
    const key = loginKey(studentName, className);
    const acc = accountById[userId] || accountByKey[key] || null;

    // Служебные аккаунты не ученики — в отчёты не попадают.
    if (acc && acc.role !== 'student') return;

    // Для привязанных строк берём текущий класс ученика, а не старый снимок.
    const effectiveName = acc ? acc.name : studentName;
    const effectiveClass = acc ? acc.className : className;

    let allowed = false;
    if (role === 'admin') allowed = true;
    else if (role === 'teacher') allowed = classListMatchesScope(classes, effectiveClass);
    else if (role === 'parent') {
      allowed = parentScopeMatches(childKeys, effectiveName, effectiveClass) ||
        childKeys.indexOf(key) !== -1;
    }
    if (!allowed) return;

    const r = attemptToResult(row, true);
    r.accountId = userId || (acc ? acc.id : '');
    r.studentName = effectiveName;
    r.className = effectiveClass;
    results.push(r);
  });

  results.sort(sortByTimeDesc);
  const limited = results.slice(0, 2000);

  const byStudent = {};
  limited.forEach(function (r) {
    const key = r.accountId || loginKey(r.studentName, r.className);
    if (!byStudent[key]) {
      byStudent[key] = {
        key: key,
        accountId: r.accountId,
        name: r.studentName,
        className: r.className,
        results: [],
        bestByLesson: {}
      };
    }

    const s = byStudent[key];
    s.results.push(r);

    const lessonKey = r.lesson || 'Без урока';
    const pct = r.maxScore ? Math.round(r.score / r.maxScore * 100) : 0;
    const prev = s.bestByLesson[lessonKey];
    if (!prev || pct > prev.pct || (pct === prev.pct && r._tsMs > prev._tsMs)) {
      s.bestByLesson[lessonKey] = {
        lesson: lessonKey,
        score: r.score,
        maxScore: r.maxScore,
        pct: pct,
        grade: r.grade,
        timestamp: r.timestamp,
        _tsMs: r._tsMs
      };
    }
  });

  const students = Object.keys(byStudent).map(function (key) {
    const s = byStudent[key];
    const best = Object.keys(s.bestByLesson).map(function (k) {
      const b = Object.assign({}, s.bestByLesson[k]);
      delete b._tsMs;
      return b;
    });
    const sum = best.reduce(function (acc, b) { return acc + b.pct; }, 0);

    return {
      key: s.key,
      accountId: s.accountId,
      name: s.name,
      className: s.className,
      avgPct: best.length ? Math.round(sum / best.length) : 0,
      lessonsCount: best.length,
      resultsCount: s.results.length,
      lastActive: s.results.length ? s.results[0].timestamp : '',
      lessons: best,
      results: stripTs(s.results.slice(0, 30))
    };
  });

  students.sort(function (a, b) {
    return String(a.className).localeCompare(String(b.className), 'ru') ||
      String(a.name).localeCompare(String(b.name), 'ru');
  });

  return success({
    students: students,
    results: stripTs(limited),
    scope: { classes: classes, childKeys: childKeys }
  });
}

async function adminListAccounts(body, deps) {
  await requireRole(await accountFromToken(body.token, deps), ['admin']);
  const accounts = await listAccounts(deps);
  const out = accounts.filter(function (a) { return !!a.id; }).map(function (a) {
    const item = accountPublic(a);
    item.childKey = loginKey(a.name, a.className);
    item.createdAt = a.createdAt;
    return item;
  });

  const order = { admin: 0, teacher: 1, parent: 2, student: 3 };
  out.sort(function (a, b) {
    if (a.role !== b.role) return (order[a.role] || 9) - (order[b.role] || 9);
    return String(a.className).localeCompare(String(b.className), 'ru') ||
      String(a.name).localeCompare(String(b.name), 'ru');
  });

  return success({ accounts: out });
}

async function adminCreateAccount(body, deps) {
  await requireRole(await accountFromToken(body.token, deps), ['admin']);

  const name = normalizeName(body.name);
  const className = normalizeClassName(body.className);
  const password = String(body.password || '');
  const role = normalizeRoleStrict(body.role);
  const scope = sanitizeScope(body.scope);

  validateRegistration(name, className, password);

  const key = loginKey(name, className);
  if (await getAccountByLoginKey(key, deps)) {
    fail('ACCOUNT_EXISTS', 'Аккаунт с таким именем и классом уже существует.');
  }

  const salt = randomSalt();
  const now = new Date().toISOString();
  const account = await insertAccount({
    id: webCrypto.randomUUID(),
    name: name,
    class_name: className,
    track: 'standard',
    login_key: key,
    password_salt: salt,
    password_hash: await hashPassword(salt, password),
    role: role,
    scope: scope,
    created_at: now,
    updated_at: now
  }, deps);

  return success({ account: accountPublic(account) });
}

async function adminSetRole(body, deps) {
  await requireRole(await accountFromToken(body.token, deps), ['admin']);

  const accountId = String(body.accountId || '').trim();
  const role = normalizeRoleStrict(body.role);
  const scope = sanitizeScope(body.scope);

  const account = await getAccountById(accountId, deps);
  if (!account) fail('NOT_FOUND', 'Аккаунт не найден.');

  if (account.role === 'admin' && role !== 'admin' && await countAdmins(deps) <= 1) {
    fail('LAST_ADMIN', 'Нельзя снять роль администратора с последнего администратора.');
  }

  const updated = await updateAccount(account.id, {
    role: role,
    scope: scope,
    updated_at: new Date().toISOString()
  }, deps);

  return success({ account: accountPublic(updated) });
}

async function adminResetPassword(body, deps) {
  await requireRole(await accountFromToken(body.token, deps), ['admin']);

  const accountId = String(body.accountId || '').trim();
  const password = String(body.newPassword || '');
  if (password.length < 6) {
    fail('BAD_REQUEST', 'Пароль должен быть не короче 6 символов.');
  }

  const account = await getAccountById(accountId, deps);
  if (!account) fail('NOT_FOUND', 'Аккаунт не найден.');

  const salt = randomSalt();
  await updateAccount(account.id, {
    password_salt: salt,
    password_hash: await hashPassword(salt, password),
    updated_at: new Date().toISOString()
  }, deps);

  return success({ accountId: account.id });
}

async function setStudentClass(body, deps) {
  const caller = await accountFromToken(body.token, deps);
  requireRole(caller, ['teacher', 'admin']);

  const accountId = String(body.accountId || '').trim();
  const className = normalizeClassName(body.className);

  if (!accountId) fail('BAD_REQUEST', 'Не выбран ученик.');
  if (!isValidClassName(className)) {
    fail('BAD_REQUEST', 'Некорректный класс. Используйте например «5 класс» или «5а».');
  }

  const account = await getAccountById(accountId, deps);
  if (!account) fail('NOT_FOUND', 'Аккаунт не найден.');
  if (account.role !== 'student') {
    fail('FORBIDDEN', 'Подкласс можно менять только у учеников.');
  }

  if (caller.role === 'teacher') {
    const classes = splitScope(caller.scope);
    if (!classListMatchesScope(classes, account.className) ||
        !classListMatchesScope(classes, className)) {
      fail('FORBIDDEN', 'Этот ученик или класс вне вашей области доступа.');
    }
  }

  const oldKey = loginKey(account.name, account.className);
  const newKey = loginKey(account.name, className);
  if (oldKey !== newKey) {
    const other = await getAccountByLoginKey(newKey, deps);
    if (other && other.id !== account.id) {
      fail('ACCOUNT_EXISTS', 'Аккаунт с таким именем и классом уже существует.');
    }
  }

  const updated = await updateAccount(account.id, {
    class_name: className,
    login_key: newKey,
    updated_at: new Date().toISOString()
  }, deps);

  if (oldKey !== newKey) {
    await updateParentScopesForClassChange(oldKey, newKey, deps);
  }

  return success({ account: accountPublic(updated) });
}

async function updateParentScopesForClassChange(oldKey, newKey, deps) {
  const accounts = await listAccounts(deps);
  for (const acc of accounts) {
    if (acc.role !== 'parent' || !acc.scope) continue;
    const keys = splitScope(acc.scope);
    if (keys.indexOf(oldKey) === -1) continue;
    const scope = keys.map(function (key) { return key === oldKey ? newKey : key; }).join(';');
    await updateAccount(acc.id, {
      scope: scope,
      updated_at: new Date().toISOString()
    }, deps);
  }
}

async function legacySave(body, deps) {
  const row = await insertAttempt({
    client_id: String(body.clientId || body._id || '').trim() || null,
    user_id: null,
    student_name: normalizeName(body.studentName),
    class_name: normalizeClassName(body.className),
    lesson: String(body.lesson || ''),
    variant: String(body.variant || ''),
    score: toNumber(body.score),
    max_score: toNumber(body.maxScore),
    grade: normalizeGrade(body.grade, toNumber(body.score), toNumber(body.maxScore)),
    work_type: String(body.workType || 'test'),
    created_at: new Date().toISOString(),
    legacy_row: null
  }, deps);

  return { result: 'success', ok: true, row: row ? (row.legacy_row || row.id) : 0 };
}

const ACTIONS = {
  register: register,
  login: login,
  saveResult: saveResult,
  myResults: myResults,
  viewResults: viewResults,
  adminListAccounts: adminListAccounts,
  adminCreateAccount: adminCreateAccount,
  adminSetRole: adminSetRole,
  adminResetPassword: adminResetPassword,
  setStudentClass: setStudentClass
};

async function parseBody(request) {
  const text = await request.text();
  if (!text || !text.trim()) fail('BAD_REQUEST', 'Пустой или некорректный запрос.');
  try {
    return JSON.parse(text);
  } catch (_) {
    const params = new URLSearchParams(text);
    const body = {};
    params.forEach(function (value, key) { body[key] = value; });
    if (Object.keys(body).length) return body;
    fail('BAD_REQUEST', 'Пустой или некорректный запрос.');
  }
}

/* ---------------- ТОЧКА ВХОДА ---------------- */

export async function handleRequest(request, deps) {
  const options = deps || {};
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      fail('BAD_REQUEST', 'Используйте POST.');
    }

    const body = await parseBody(request);
    const action = String(body.action || '').trim();

    if (!action) return jsonResponse(await legacySave(body, options));

    const handler = ACTIONS[action];
    if (!handler) {
      fail('UNKNOWN_ACTION', 'Неизвестное действие: ' + action);
    }
    return jsonResponse(await handler(body, options));
  } catch (err) {
    return jsonResponse(errorBody(err), 200);
  }
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(function (request) { return handleRequest(request); });
}
