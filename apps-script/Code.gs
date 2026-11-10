/* ============================================================
   БЭКЕНД ИНТЕРАКТИВНЫХ УРОКОВ ИНФОРМАТИКИ
   Google Apps Script + Google Таблица

   Действия POST (JSON, Content-Type: text/plain):
     register   { name, className, track, password }
     login      { name, className, track?, password }
     saveResult { token, result: { lesson, variant, score, maxScore, grade, workType } }
     myResults  { token }

   Старый формат без action тоже поддерживается: строка просто
   дописывается в лист результатов (как раньше).

   Пароли хранятся как SHA-256(соль + пароль). Токен — HMAC-SHA256,
   срок действия 30 дней.
   ============================================================ */

var RESULTS_SHEET = 'Лист1';
var ACCOUNTS_SHEET = 'Аккаунты';
var TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var PROP_SECRET = 'ACCOUNT_TOKEN_SECRET';

var RESULT_HEADERS = [
  'timestamp', 'accountId', 'studentName', 'className',
  'lesson', 'variant', 'score', 'maxScore', 'grade', 'workType'
];

var ACCOUNT_HEADERS = [
  'id', 'name', 'className', 'track', 'loginKey',
  'salt', 'passwordHash', 'createdAt', 'updatedAt'
];

/* ============================================================
   ТОЧКИ ВХОДА
   ============================================================ */

function doGet() {
  return ContentService.createTextOutput('Скрипт работает. Используйте POST.');
}

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = String(body.action || '').trim();

    if (!action) {
      return json_(legacySave_(body));
    }

    switch (action) {
      case 'register':   return json_(register_(body));
      case 'login':      return json_(login_(body));
      case 'saveResult': return json_(saveResult_(body));
      case 'myResults':  return json_(myResults_(body));
      default:
        throwAppError_('UNKNOWN_ACTION', 'Неизвестное действие: ' + action);
    }
  } catch (err) {
    return json_(error_(err.code || 'SERVER_ERROR', err.message || String(err)));
  }
}

/* ============================================================
   УСТАНОВКА / ОБСЛУЖИВАНИЕ
   ============================================================ */

/**
 * Запустите один раз после вставки этого кода.
 * Создаёт лист «Аккаунты» и добавляет колонку accountId в «Лист1».
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Скрипт должен быть привязан к Google Таблице.');
  }

  var results = getOrCreateSheet_(ss, RESULTS_SHEET);
  ensureHeaders_(results, RESULT_HEADERS);

  var accounts = getOrCreateSheet_(ss, ACCOUNTS_SHEET);
  ensureHeaders_(accounts, ACCOUNT_HEADERS);

  var secret = getSecret_();

  var message =
    'Готово.\n' +
    'Лист результатов: ' + results.getName() + '\n' +
    'Лист аккаунтов: ' + accounts.getName() + '\n' +
    'Секрет токена: ' + (secret ? 'настроен' : 'не настроен');

  Logger.log(message);
  return message;
}

/**
 * Сброс пароля ученика. Запускать вручную из редактора Apps Script.
 * Пример: resetStudentPassword('Иванов Иван', '10 класс', 'новыйпароль')
 */
function resetStudentPassword(name, className, newPassword) {
  var pwd = String(newPassword || '');
  if (pwd.length < 6) {
    throw new Error('Пароль должен быть не короче 6 символов.');
  }

  var accounts = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), ACCOUNTS_SHEET);
  ensureHeaders_(accounts, ACCOUNT_HEADERS);

  var account = getAccountByLoginKey_(accounts, loginKey_(name, className));
  if (!account) {
    throw new Error('Аккаунт не найден: ' + normalizeName_(name) + ' · ' + String(className || '').trim());
  }

  var map = headerMap_(accounts);
  var salt = randomSalt_();
  accounts.getRange(account._row, map['salt']).setValue(salt);
  accounts.getRange(account._row, map['passwordHash']).setValue(hashPassword_(salt, pwd));
  accounts.getRange(account._row, map['updatedAt']).setValue(new Date());

  var message = 'Пароль обновлён для ' + account.name + ' · ' + account.className;
  Logger.log(message);
  return message;
}

/**
 * Список аккаунтов для учителя (без хешей и солей).
 */
function listAccounts() {
  var accounts = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), ACCOUNTS_SHEET);
  ensureHeaders_(accounts, ACCOUNT_HEADERS);
  var map = headerMap_(accounts);
  var values = accounts.getDataRange().getValues();
  var out = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!String(cell_(row, map, 'id')).trim()) continue;
    out.push({
      id: String(cell_(row, map, 'id')),
      name: String(cell_(row, map, 'name')),
      className: String(cell_(row, map, 'className')),
      track: String(cell_(row, map, 'track')),
      createdAt: cell_(row, map, 'createdAt')
    });
  }

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* ============================================================
   РЕГИСТРАЦИЯ И ВХОД
   ============================================================ */

function register_(body) {
  var name = normalizeName_(body.name);
  var className = String(body.className || '').trim();
  var track = normalizeTrack_(body.track);
  var password = String(body.password || '');

  validateRegistration_(name, className, password);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var accounts = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), ACCOUNTS_SHEET);
    ensureHeaders_(accounts, ACCOUNT_HEADERS);

    var key = loginKey_(name, className);
    if (getAccountByLoginKey_(accounts, key)) {
      throwAppError_('ACCOUNT_EXISTS', 'Аккаунт с таким именем и классом уже существует. Войдите в него.');
    }

    var map = headerMap_(accounts);
    var now = new Date();
    var id = Utilities.getUuid();
    var salt = randomSalt_();
    var hash = hashPassword_(salt, password);

    var row = [];
    row[map['id'] - 1] = id;
    row[map['name'] - 1] = name;
    row[map['className'] - 1] = className;
    row[map['track'] - 1] = track;
    row[map['loginKey'] - 1] = key;
    row[map['salt'] - 1] = salt;
    row[map['passwordHash'] - 1] = hash;
    row[map['createdAt'] - 1] = now;
    row[map['updatedAt'] - 1] = now;

    accounts.appendRow(padRow_(row, accounts.getLastColumn()));

    var account = {
      id: id,
      name: name,
      className: className,
      track: track
    };

    return success_({
      token: issueToken_(account.id),
      account: account
    });
  } finally {
    lock.releaseLock();
  }
}

function login_(body) {
  var name = normalizeName_(body.name);
  var className = String(body.className || '').trim();
  var password = String(body.password || '');
  var requestedTrack = body.track ? normalizeTrack_(body.track) : '';

  if (!name || !className || !password) {
    throwAppError_('BAD_REQUEST', 'Введите имя, класс и пароль.');
  }

  var accounts = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), ACCOUNTS_SHEET);
  ensureHeaders_(accounts, ACCOUNT_HEADERS);

  var account = getAccountByLoginKey_(accounts, loginKey_(name, className));
  if (!account) {
    throwAppError_('NO_ACCOUNT', 'Аккаунт не найден. Зарегистрируйтесь.');
  }

  if (hashPassword_(account.salt, password) !== account.passwordHash) {
    throwAppError_('WRONG_PASSWORD', 'Неверный пароль.');
  }

  if (requestedTrack && requestedTrack !== account.track) {
    updateAccountTrack_(accounts, account, requestedTrack);
    account.track = requestedTrack;
  }

  return success_({
    token: issueToken_(account.id),
    account: {
      id: account.id,
      name: account.name,
      className: account.className,
      track: account.track
    }
  });
}

/* ============================================================
   РЕЗУЛЬТАТЫ
   ============================================================ */

function saveResult_(body) {
  var account = accountFromToken_(body.token);
  var result = body.result || {};

  var score = toNumber_(result.score);
  var maxScore = toNumber_(result.maxScore);
  var grade = normalizeGrade_(result.grade, score, maxScore);

  var row = {
    timestamp: new Date(),
    accountId: account.id,
    studentName: account.name,
    className: account.className,
    lesson: String(result.lesson || '').slice(0, 200),
    variant: String(result.variant || '').slice(0, 100),
    score: score,
    maxScore: maxScore,
    grade: grade,
    workType: String(result.workType || 'test').slice(0, 50)
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), RESULTS_SHEET);
    ensureHeaders_(sheet, RESULT_HEADERS);
    var rowNumber = appendByHeaders_(sheet, row);

    return success_({
      row: rowNumber,
      accountId: account.id
    });
  } finally {
    lock.releaseLock();
  }
}

function myResults_(body) {
  var account = accountFromToken_(body.token);

  var sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), RESULTS_SHEET);
  ensureHeaders_(sheet, RESULT_HEADERS);

  var map = headerMap_(sheet);
  var values = sheet.getDataRange().getValues();
  var ownKey = loginKey_(account.name, account.className);
  var results = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var rowAccountId = String(cell_(row, map, 'accountId') || '').trim();
    var belongs = false;

    if (rowAccountId) {
      belongs = rowAccountId === account.id;
    } else {
      // Старые строки без accountId подтягиваем по имени и классу.
      var rowKey = loginKey_(cell_(row, map, 'studentName'), cell_(row, map, 'className'));
      belongs = rowKey === ownKey;
    }

    if (!belongs) continue;

    var tsRaw = cell_(row, map, 'timestamp');
    var ts = tsRaw instanceof Date ? tsRaw.toISOString() : String(tsRaw || '');
    var tsMs = ts ? new Date(ts).getTime() : 0;

    results.push({
      timestamp: ts,
      lesson: String(cell_(row, map, 'lesson') || ''),
      variant: String(cell_(row, map, 'variant') || ''),
      score: toNumber_(cell_(row, map, 'score')),
      maxScore: toNumber_(cell_(row, map, 'maxScore')),
      grade: toNumber_(cell_(row, map, 'grade')),
      workType: String(cell_(row, map, 'workType') || ''),
      _tsMs: isFinite(tsMs) ? tsMs : 0
    });
  }

  results.sort(function (a, b) { return b._tsMs - a._tsMs; });
  results = results.slice(0, 500).map(function (r) {
    delete r._tsMs;
    return r;
  });

  return success_({ results: results });
}

/**
 * Старый POST без action: просто дописать строку в лист результатов.
 * Формат ответа сохранён для обратной совместимости.
 */
function legacySave_(body) {
  var row = {
    timestamp: new Date(),
    accountId: '',
    studentName: normalizeName_(body.studentName),
    className: String(body.className || '').trim(),
    lesson: String(body.lesson || ''),
    variant: String(body.variant || ''),
    score: toNumber_(body.score),
    maxScore: toNumber_(body.maxScore),
    grade: normalizeGrade_(body.grade, toNumber_(body.score), toNumber_(body.maxScore)),
    workType: String(body.workType || 'test')
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), RESULTS_SHEET);
    ensureHeaders_(sheet, RESULT_HEADERS);
    var rowNumber = appendByHeaders_(sheet, row);
    return {
      result: 'success',
      ok: true,
      row: rowNumber
    };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   ТОКЕНЫ
   ============================================================ */

function issueToken_(accountId) {
  var payload = {
    sub: accountId,
    exp: Date.now() + TOKEN_TTL_MS
  };
  var payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payloadB64, getSecret_())
  );
  return payloadB64 + '.' + signature;
}

function verifyToken_(token) {
  var raw = String(token || '');
  var parts = raw.split('.');
  if (parts.length !== 2) {
    throwAppError_('AUTH_REQUIRED', 'Нужно войти в аккаунт.');
  }

  var expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], getSecret_())
  );

  if (expected !== parts[1]) {
    throwAppError_('AUTH_REQUIRED', 'Сессия повреждена. Войдите заново.');
  }

  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()
    );
  } catch (e) {
    throwAppError_('AUTH_REQUIRED', 'Сессия повреждена. Войдите заново.');
  }

  if (!payload || !payload.sub || !payload.exp) {
    throwAppError_('AUTH_REQUIRED', 'Сессия повреждена. Войдите заново.');
  }

  if (Date.now() > Number(payload.exp)) {
    throwAppError_('TOKEN_EXPIRED', 'Сессия истекла. Войдите заново.');
  }

  return payload;
}

function accountFromToken_(token) {
  var payload = verifyToken_(token);
  var accounts = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), ACCOUNTS_SHEET);
  ensureHeaders_(accounts, ACCOUNT_HEADERS);

  var account = getAccountById_(accounts, payload.sub);
  if (!account) {
    throwAppError_('AUTH_REQUIRED', 'Аккаунт не найден. Войдите заново.');
  }
  return account;
}

/* ============================================================
   АККАУНТЫ
   ============================================================ */

function getAccountByLoginKey_(sheet, key) {
  var map = headerMap_(sheet);
  var values = sheet.getDataRange().getValues();

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (String(cell_(row, map, 'loginKey') || '').trim() === key) {
      return accountFromRow_(row, map, i + 1);
    }
  }
  return null;
}

function getAccountById_(sheet, id) {
  var map = headerMap_(sheet);
  var values = sheet.getDataRange().getValues();

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (String(cell_(row, map, 'id') || '').trim() === String(id)) {
      return accountFromRow_(row, map, i + 1);
    }
  }
  return null;
}

function accountFromRow_(row, map, rowNumber) {
  return {
    id: String(cell_(row, map, 'id') || '').trim(),
    name: String(cell_(row, map, 'name') || ''),
    className: String(cell_(row, map, 'className') || ''),
    track: String(cell_(row, map, 'track') || 'standard'),
    salt: String(cell_(row, map, 'salt') || ''),
    passwordHash: String(cell_(row, map, 'passwordHash') || ''),
    _row: rowNumber
  };
}

function updateAccountTrack_(sheet, account, track) {
  var map = headerMap_(sheet);
  sheet.getRange(account._row, map['track']).setValue(track);
  sheet.getRange(account._row, map['updatedAt']).setValue(new Date());
}

/* ============================================================
   ХЕШИРОВАНИЕ ПАРОЛЕЙ
   ============================================================ */

function randomSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function hashPassword_(salt, password) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + String(password),
    Utilities.Charset.UTF_8
  );
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function getSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty(PROP_SECRET);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(PROP_SECRET, secret);
  }
  return secret;
}

/* ============================================================
   ВСПОМОГАТЕЛЬНОЕ
   ============================================================ */

function parseBody_(e) {
  if (!e) return {};

  var raw = e.postData && e.postData.contents ? e.postData.contents : '';
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      // Ниже попробуем параметры формы.
    }
  }

  if (e.parameter && Object.keys(e.parameter).length) {
    return e.parameter;
  }

  throwAppError_('BAD_REQUEST', 'Пустой или некорректный запрос.');
}

function normalizeName_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeTrack_(value) {
  var track = String(value || '').trim().toLowerCase();
  return track === 'ege' ? 'ege' : 'standard';
}

function loginKey_(name, className) {
  return (normalizeName_(name) + '|' + String(className || '').trim()).toLowerCase();
}

function validateRegistration_(name, className, password) {
  if (name.length < 3) {
    throwAppError_('BAD_REQUEST', 'Введите фамилию и имя (минимум 3 символа).');
  }
  if (!className) {
    throwAppError_('BAD_REQUEST', 'Выберите класс.');
  }
  if (password.length < 6) {
    throwAppError_('BAD_REQUEST', 'Пароль должен быть не короче 6 символов.');
  }
}

function toNumber_(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

function normalizeGrade_(grade, score, maxScore) {
  var g = Number(grade);
  if (!isFinite(g) || g < 2 || g > 5) {
    var pct = maxScore ? score / maxScore * 100 : 0;
    if (pct >= 85) g = 5;
    else if (pct >= 65) g = 4;
    else if (pct >= 45) g = 3;
    else g = 2;
  }
  return Math.round(g);
}

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureHeaders_(sheet, required) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    sheet.setFrozenRows(1);
    return;
  }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });

  var missing = required.filter(function (h) { return headers.indexOf(h) === -1; });
  if (!missing.length) return;

  sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  sheet.setFrozenRows(1);
}

function headerMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  var map = {};
  if (!lastCol) return map;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').trim();
    if (key) map[key] = i + 1;
  }
  return map;
}

function appendByHeaders_(sheet, values) {
  var map = headerMap_(sheet);
  var width = sheet.getLastColumn();
  var row = [];

  for (var i = 0; i < width; i++) row.push('');

  Object.keys(values).forEach(function (key) {
    if (map[key]) row[map[key] - 1] = values[key];
  });

  sheet.appendRow(row);
  return sheet.getLastRow();
}

function cell_(row, map, name) {
  var index = map[name];
  if (!index) return '';
  return row[index - 1];
}

function padRow_(row, width) {
  var out = [];
  for (var i = 0; i < width; i++) {
    out.push(row[i] === undefined ? '' : row[i]);
  }
  return out;
}

function success_(extra) {
  var result = {
    ok: true,
    result: 'success'
  };
  Object.keys(extra || {}).forEach(function (key) {
    result[key] = extra[key];
  });
  return result;
}

function error_(code, message) {
  return {
    ok: false,
    result: 'error',
    error: code,
    message: message
  };
}

function throwAppError_(code, message) {
  var err = new Error(message);
  err.code = code;
  throw err;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
