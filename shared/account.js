/* ============================================================
   АККАУНТ УЧЕНИКА: ВХОД, РЕГИСТРАЦИЯ, СОХРАНЕНИЕ РЕЗУЛЬТАТОВ
   ============================================================
   Подключать перед shared/app.js и shared/nav-auth.js.
   Все запросы идут в один Apps Script (тот же, что у тренажёра).
   ============================================================ */
(function (global) {
  'use strict';

  var DEFAULT_API_URL =
    'https://script.google.com/macros/s/AKfycbydyCpASxZ026Vxr4aRhR1zgsxMWq9JUnwaVEvxpB0jeWD8Ww5mu53oY2CaHjfuck0e/exec';

  var TOKEN_KEY = 'accountToken';
  var STUDENT_KEY = 'student';
  var QUEUE_PREFIX = 'accountResultQueue:';
  var LEGACY_QUEUE_KEY = 'trainerResultQueue';

  /* ---------------- HTTP ---------------- */

  function apiUrl() {
    return global.ACCOUNT_API_URL || DEFAULT_API_URL;
  }

  function makeError(code, message) {
    var err = new Error(message || code);
    err.code = code || 'ERROR';
    return err;
  }

  function post(action, data) {
    var payload = Object.assign({ action: action }, data || {});

    return fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }

        if (!res.ok) {
          throw makeError('HTTP_' + res.status,
            'Сервер ответил ошибкой HTTP ' + res.status + '. Попробуйте позже.');
        }
        if (!data) {
          throw makeError('BAD_RESPONSE',
            'Сервер вернул некорректный ответ. Попробуйте позже.');
        }
        if (data.ok === false || data.result === 'error') {
          throw makeError(data.error || 'SERVER_ERROR',
            data.message || 'Сервер вернул ошибку.');
        }
        return data;
      });
    }).catch(function (err) {
      if (err && err.code) throw err;
      throw makeError('NETWORK_ERROR',
        'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.');
    });
  }

  /* ---------------- СЕССИЯ ---------------- */

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function readStudent() {
    try {
      var raw = localStorage.getItem(STUDENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeSession(newToken, account) {
    var student = {
      id: account.id,
      accountId: account.id,
      name: account.name,
      'class': account.className,
      track: account.track,
      // Роль приходит из ответа сервера. Она нужна только для навигации:
      // все права проверяются на сервере по записи в таблице.
      role: account.role || 'student',
      scope: account.scope || '',
      loginAt: new Date().toISOString()
    };

    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(STUDENT_KEY, JSON.stringify(student));
    return student;
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(STUDENT_KEY);
    } catch (e) {
      // ignore
    }
  }

  function currentStudent() {
    var student = readStudent();
    if (!token() || !student || !student.name) return null;
    return student;
  }

  var ROLE_LABELS = {
    student: 'Ученик',
    teacher: 'Учитель',
    parent: 'Родитель',
    admin: 'Администратор'
  };

  function currentRole() {
    var student = currentStudent();
    return student ? (student.role || 'student') : null;
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || ROLE_LABELS.student;
  }

  function hasRole(role) {
    return currentRole() === role;
  }

  function hasAnyRole(roles) {
    var role = currentRole();
    if (!role) return false;
    for (var i = 0; i < roles.length; i++) {
      if (roles[i] === role) return true;
    }
    return false;
  }

  function isPrivileged() {
    return hasAnyRole(['teacher', 'parent', 'admin']);
  }

  /** Главная страница для текущей роли. */
  function homeUrl() {
    switch (currentRole()) {
      case 'teacher': return 'teacher.html';
      case 'parent':  return 'parent.html';
      case 'admin':   return 'admin.html';
      default:        return 'lessons.html';
    }
  }

  /** Переход на страницу роли с учётом вложенности каталога. */
  function homeUrlFrom(prefix) {
    return (prefix || '') + homeUrl();
  }

  function requireRole(roles, redirectTo) {
    if (!isLoggedIn()) {
      global.location.href = redirectTo || loginUrl();
      return false;
    }
    if (!hasAnyRole(roles)) {
      global.location.href = redirectTo || homeUrl();
      return false;
    }
    return true;
  }

  function isLoggedIn() {
    return !!currentStudent();
  }

  function loginUrl() {
    var path = String(global.location && global.location.pathname || '');
    if (/\/[^/]*\.html$/.test(path)) {
      var file = path.split('/').pop();
      if (file === 'lessons.html' || file === 'login.html' || file === 'index.html') {
        return 'login.html';
      }
      return '../login.html';
    }
    return 'login.html';
  }

  function requireLogin(redirectTo) {
    if (isLoggedIn()) return true;
    global.location.href = redirectTo || loginUrl();
    return false;
  }

  function logout() {
    clearSession();
  }

  /* ---------------- РЕГИСТРАЦИЯ / ВХОД ---------------- */

  function authenticate(action, data) {
    return post(action, {
      name: data.name,
      className: data.className,
      track: data.track,
      password: data.password
    }).then(function (res) {
      if (!res.token || !res.account) {
        throw makeError('BAD_RESPONSE', 'Сервер не вернул данные аккаунта.');
      }
      var student = writeSession(res.token, res.account);
      migrateLegacyQueue();
      return student;
    });
  }

  function register(data) {
    return authenticate('register', data);
  }

  function login(data) {
    return authenticate('login', data);
  }

  /* ---------------- ОЧЕРЕДЬ РЕЗУЛЬТАТОВ ---------------- */

  function accountQueueKey() {
    var student = readStudent();
    var id = student && (student.accountId || student.id);
    return QUEUE_PREFIX + (id || 'anon');
  }

  function readQueue() {
    try {
      var raw = localStorage.getItem(accountQueueKey());
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(items) {
    try {
      localStorage.setItem(accountQueueKey(), JSON.stringify(items));
    } catch (e) {
      console.warn('Не удалось сохранить очередь результатов:', e);
    }
  }

  function resultId(result) {
    return result._id || result.clientId ||
      (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));
  }

  function queueResult(result) {
    var payload = Object.assign({}, result);
    payload._id = resultId(payload);

    var queue = readQueue();
    if (!queue.some(function (item) {
      return (item._id || item.clientId) === payload._id;
    })) {
      queue.push(payload);
      writeQueue(queue);
    }
    return payload._id;
  }

  function removeFromQueue(id) {
    writeQueue(readQueue().filter(function (item) {
      return (item._id || item.clientId) !== id;
    }));
  }

  function pendingCount() {
    return readQueue().length;
  }

  function migrateLegacyQueue() {
    try {
      var raw = localStorage.getItem(LEGACY_QUEUE_KEY);
      if (!raw) return 0;
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach(function (item) { queueResult(item); });
      }
      localStorage.removeItem(LEGACY_QUEUE_KEY);
      return Array.isArray(arr) ? arr.length : 0;
    } catch (e) {
      return 0;
    }
  }

  function sendQueuedItem(item) {
    var payload = Object.assign({}, item);
    var id = payload._id || payload.clientId;
    delete payload._id;

    return post('saveResult', { token: token(), result: payload })
      .then(function (data) {
        removeFromQueue(id);
        return data;
      });
  }

  function flushQueue() {
    if (!isLoggedIn()) return Promise.resolve(0);

    var queue = readQueue();
    if (!queue.length) return Promise.resolve(0);

    var sent = 0;
    var chain = Promise.resolve();

    queue.forEach(function (item) {
      chain = chain.then(function () {
        if (!isLoggedIn()) return null;
        return sendQueuedItem(item).then(function () {
          sent++;
        }).catch(function (err) {
          console.warn('Не удалось дослать результат:', err, item);
          if (err.code === 'AUTH_REQUIRED' || err.code === 'TOKEN_EXPIRED') {
            clearSession();
          }
          return null;
        });
      });
    });

    return chain.then(function () { return sent; });
  }

  /* ---------------- СОХРАНЕНИЕ / ИСТОРИЯ ---------------- */

  function saveResult(result) {
    if (!isLoggedIn()) {
      return Promise.reject(makeError('AUTH_REQUIRED', 'Нужно войти в аккаунт.'));
    }

    var payload = Object.assign({}, result);

    return post('saveResult', { token: token(), result: payload })
      .catch(function (err) {
        queueResult(payload);
        if (err.code === 'AUTH_REQUIRED' || err.code === 'TOKEN_EXPIRED') {
          clearSession();
        }
        throw err;
      });
  }

  function getMyResults() {
    if (!isLoggedIn()) {
      return Promise.reject(makeError('AUTH_REQUIRED', 'Нужно войти в аккаунт.'));
    }

    return post('myResults', { token: token() }).then(function (res) {
      return Array.isArray(res.results) ? res.results : [];
    });
  }

  /* ---------------- РОЛИ: ОТЧЁТЫ И УПРАВЛЕНИЕ ---------------- */

  function requireAuth() {
    if (!isLoggedIn()) {
      throw makeError('AUTH_REQUIRED', 'Нужно войти в аккаунт.');
    }
  }

  /** Результаты учеников для учителя, родителя или администратора. */
  function viewResults() {
    requireAuth();
    return post('viewResults', { token: token() }).then(function (res) {
      return {
        students: Array.isArray(res.students) ? res.students : [],
        results: Array.isArray(res.results) ? res.results : [],
        scope: res.scope || { classes: [], childKeys: [] }
      };
    });
  }

  function adminListAccounts() {
    requireAuth();
    return post('adminListAccounts', { token: token() }).then(function (res) {
      return Array.isArray(res.accounts) ? res.accounts : [];
    });
  }

  function adminCreateAccount(data) {
    requireAuth();
    return post('adminCreateAccount', Object.assign({ token: token() }, data || {}))
      .then(function (res) { return res.account; });
  }

  function adminSetRole(data) {
    requireAuth();
    return post('adminSetRole', Object.assign({ token: token() }, data || {}))
      .then(function (res) { return res.account; });
  }

  function adminResetPassword(data) {
    requireAuth();
    return post('adminResetPassword', Object.assign({ token: token() }, data || {}));
  }

  /* ---------------- ПОМОЩНИКИ ДЛЯ ИНТЕРФЕЙСА ---------------- */

  function percent(score, maxScore) {
    var s = Number(score) || 0;
    var m = Number(maxScore) || 0;
    return m ? Math.round(s / m * 100) : 0;
  }

  function gradeFor(pct) {
    if (pct >= 85) return 5;
    if (pct >= 65) return 4;
    if (pct >= 45) return 3;
    return 2;
  }

  /**
   * Из истории результатов достаёт лучший результат по каждому уровню
   * тренажёра: { 1: { correct, total, pct }, ... }
   */
  function bestTrainerLevels(results) {
    var best = {};

    (results || []).forEach(function (r) {
      if (String(r.workType) !== 'trainer-level') return;

      var match = /Trainer\s*L(\d+)/i.exec(String(r.variant || ''));
      if (!match) return;

      var level = Number(match[1]);
      var total = Number(r.maxScore) || 0;
      var correct = Number(r.score) || 0;
      if (!level || !total) return;

      var pct = percent(correct, total);
      var current = best[level];

      if (!current || pct > current.pct || (pct === current.pct && correct > current.correct)) {
        best[level] = { correct: correct, total: total, pct: pct };
      }
    });

    return best;
  }

  function formatDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }) + ' ' + d.toLocaleTimeString('ru-RU', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  function workTypeLabel(type) {
    switch (String(type || '')) {
      case 'homework': return 'Домашнее задание';
      case 'trainer-level': return 'Тренажёр · уровень';
      case 'trainer': return 'Тренажёр · итог';
      case 'exam-task': return 'Тренажёр · экзамен';
      case 'test': return 'Тест урока';
      default: return 'Работа';
    }
  }

  /* ---------------- ЭКСПОРТ ---------------- */

  var api = {
    apiUrl: apiUrl,
    token: token,
    currentStudent: currentStudent,
    currentRole: currentRole,
    roleLabel: roleLabel,
    hasRole: hasRole,
    hasAnyRole: hasAnyRole,
    isPrivileged: isPrivileged,
    homeUrl: homeUrl,
    homeUrlFrom: homeUrlFrom,
    requireRole: requireRole,
    isLoggedIn: isLoggedIn,
    requireLogin: requireLogin,
    loginUrl: loginUrl,
    register: register,
    login: login,
    logout: logout,
    saveResult: saveResult,
    getMyResults: getMyResults,
    viewResults: viewResults,
    adminListAccounts: adminListAccounts,
    adminCreateAccount: adminCreateAccount,
    adminSetRole: adminSetRole,
    adminResetPassword: adminResetPassword,
    queueResult: queueResult,
    flushQueue: flushQueue,
    pendingCount: pendingCount,
    migrateLegacyQueue: migrateLegacyQueue,
    percent: percent,
    gradeFor: gradeFor,
    bestTrainerLevels: bestTrainerLevels,
    formatDate: formatDate,
    workTypeLabel: workTypeLabel
  };

  global.Account = api;

  // При загрузке переносим старую очередь тренажёра в очередь аккаунта.
  if (isLoggedIn()) {
    try { migrateLegacyQueue(); } catch (e) { /* ignore */ }
  }
})(window);
