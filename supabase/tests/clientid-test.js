/* Проверка: клиент всегда шлёт clientId и не теряет его в офлайн-очереди.
   Запуск: node supabase/tests/clientid-test.js                        */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'account.js'), 'utf8');
const store = new Map();
const sent = [];
let fail = false;

const localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const fetchMock = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sent.push(body);
  if (fail) {
    return new Response(JSON.stringify({ ok: false, result: 'error', error: 'NETWORK', message: 'offline' }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, result: 'success', row: sent.length }), { status: 200 });
};

const win = { ACCOUNT_API_URL: 'https://test.local/api' };
const ctx = vm.createContext({
  window: win, localStorage, fetch: fetchMock, console,
  Response, URLSearchParams, Date, Math, JSON, Object, Array, String, Number, Error, setTimeout
});
vm.runInContext(src, ctx, { filename: 'account.js' });

store.set('accountToken', 'tok');
store.set('student', JSON.stringify({ id: 'u1', accountId: 'u1', name: 'Иван', 'class': '6 класс' }));
const Account = win.Account;

(async () => {
  let pass = 0, bad = 0;
  const ok = (n, c) => { if (c) { pass++; console.log('  OK  ' + n); } else { bad++; console.log('FAIL  ' + n); } };

  await Account.saveResult({ lesson: 'Урок', score: 4, maxScore: 5, workType: 'test' });
  ok('saveResult отправляет clientId', !!sent[0].result.clientId);
  ok('saveResult отправляет _id = clientId', sent[0].result._id === sent[0].result.clientId);

  fail = true;
  try { await Account.saveResult({ lesson: 'Офлайн', score: 2 }); } catch (e) { /* ожидаемо */ }
  fail = false;
  const queue = JSON.parse(store.get('accountResultQueue:u1') || '[]');
  ok('ошибка кладёт в очередь', queue.length === 1);
  ok('в очереди есть clientId', !!queue[0].clientId);

  const flushed = await Account.flushQueue();
  ok('flushQueue отправил 1', flushed === 1);
  ok('из очереди clientId не потерян', sent[sent.length - 1].result.clientId === queue[0].clientId);
  ok('очередь пуста', Account.pendingCount() === 0);

  await Account.setStudentClass({ accountId: 'u2', className: '5а' });
  const classReq = sent[sent.length - 1];
  ok('setStudentClass отправляет действие', classReq.action === 'setStudentClass');
  ok('setStudentClass отправляет токен', classReq.token === 'tok');
  ok('setStudentClass отправляет accountId', classReq.accountId === 'u2');
  ok('setStudentClass отправляет className', classReq.className === '5а');

  const delRes = await Account.adminDeleteAccount({ accountId: 'u3' });
  const delReq = sent[sent.length - 1];
  ok('adminDeleteAccount отправляет действие', delReq.action === 'adminDeleteAccount');
  ok('adminDeleteAccount отправляет токен', delReq.token === 'tok');
  ok('adminDeleteAccount отправляет accountId', delReq.accountId === 'u3');
  ok('adminDeleteAccount возвращает deleted', !!delRes.deleted && delRes.deleted.results === 0);

  ok('normalizeClassName: «5 а» → «5а»', Account.normalizeClassName('5 а') === '5а');
  ok('baseClass: «5а» → «5 класс»', Account.baseClass('5а') === '5 класс');
  ok('subclassOf: «5а» → «а»', Account.subclassOf('5а') === 'а');
  ok('composeClassName: «5 класс» + «а» → «5а»',
    Account.composeClassName('5 класс', 'а') === '5а');

  console.log('\nИТОГ: ' + pass + ' пройдено, ' + bad + ' провалено');
  if (bad) process.exitCode = 1;
})();
