/* ============================================================
   ПЛАВАЮЩАЯ НАВИГАЦИЯ (Главная и Выйти)
   ============================================================ */
(function injectNav() {
  if (window.location.pathname.includes('login.html') || window.location.pathname.includes('lessons.html')) {
    return;
  }

  const nav = document.createElement('div');
  nav.className = 'floating-nav';

  const homeBtn = document.createElement('a');
  homeBtn.className = 'floating-btn home';
  homeBtn.href = '../lessons.html';
  homeBtn.innerHTML = '🏠 Главная';

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'floating-btn logout';
  logoutBtn.innerHTML = '🚪 Выйти';
  logoutBtn.onclick = function() {
    if (window.Account) Account.logout();
    else localStorage.removeItem('student');
    window.location.href = '../login.html';
  };

  nav.appendChild(homeBtn);
  nav.appendChild(logoutBtn);
  document.body.appendChild(nav);
})();

/* ============================================================
   АВТОРИЗАЦИЯ И ЗАЩИТА
   ============================================================ */
(function checkAccess(){
  const student = (window.Account && Account.currentStudent())
    ? Account.currentStudent()
    : null;

  if (!student) {
    window.location.href = '../login.html';
    throw new Error('Не выполнен вход');
  }

  window.__student = student;

  // 1. Проверка класса
  if (LESSON_DATA.className && student.class !== LESSON_DATA.className) {
    alert(`Этот урок предназначен для ${LESSON_DATA.className}. Вы вошли как ${student.class}.`);
    window.location.href = '../lessons.html';
    throw new Error('Класс не совпадает');
  }
})();

/* ============================================================
   ОБЩАЯ ФУНКЦИЯ СОХРАНЕНИЯ РЕЗУЛЬТАТА
   ============================================================ */
function sendToSheet(payload){
  if (!window.Account || !Account.isLoggedIn()) {
    console.warn('Нет активного аккаунта — результат не сохранён:', payload);
    return Promise.resolve(false);
  }

  return Account.saveResult(payload).then(function(data) {
    console.log('Результат сохранён в аккаунт:', payload, data);
    return true;
  }).catch(function(err) {
    console.error('Не удалось сохранить результат (поставлен в очередь):', err, payload);
    return false;
  });
}

/* ============================================================
   РАЗБОР ЗАДАЧ ПО ШАБЛОНУ
   ============================================================ */
(function initSolutions(){
  const data = LESSON_DATA.solutions;
  if (!data || !data.length) return;

  const container = document.getElementById('solutionsList');
  if (!container) return;

  data.forEach(function(item, i){
    const card = document.createElement('div');
    card.className = 'solution-card' + (i === 0 ? ' open' : '');

    const stepsHTML = item.template.map(function(s){ return `<li>${s}</li>`; }).join('');

    card.innerHTML = `
      <div class="solution-head">
        <span>${item.title}</span>
        <span class="arrow">▾</span>
      </div>
      <div class="solution-body">
        <div class="solution-task"><b>Условие:</b> ${item.task}</div>

        <button class="solution-reveal-btn" data-reveal="${i}">
          👁 Показать решение
        </button>

        <div class="solution-steps" id="solSteps${i}">
          <div class="solution-template">
            <b>Шаблон решения:</b>
            <ol>${stepsHTML}</ol>
          </div>
          <div class="solution-answer">
            <span class="icon">✅</span>
            <span>Ответ: ${item.answer}</span>
          </div>
          <div class="solution-hint">${item.hint}</div>
        </div>
      </div>`;

    container.appendChild(card);

    // Раскрытие/сворачивание карточки
    card.querySelector('.solution-head').addEventListener('click', function(){
      card.classList.toggle('open');
    });

    // Кнопка «Показать решение»
    card.querySelector('[data-reveal]').addEventListener('click', function(){
      const steps = document.getElementById('solSteps' + i);
      steps.classList.add('revealed');
      this.style.display = 'none';
    });
  });
})();

/* ============================================================
   ГЕЙМИФИКАЦИЯ: уровни, XP, значки
   ============================================================ */
const DEFAULT_GAME_LEVELS = [
  { name: '🥉 Новичок',        threshold: 0,  badge: 'badgeBronze' },
  { name: '🥈 Писарь',          threshold: 40, badge: 'badgeSilver' },
  { name: '🥇 Мастер текста',   threshold: 75, badge: 'badgeGold'   }
];

const GAME = {
  xp: 0,
  maxXP: 100,
  levels: (LESSON_DATA.gameLevels && LESSON_DATA.gameLevels.length === 3)
    ? LESSON_DATA.gameLevels
    : DEFAULT_GAME_LEVELS,
  currentLevel: 0
};

function updateGameUI(){
  const xpFill = document.getElementById('xpBarFill');
  const xpPoints = document.getElementById('xpPoints');
  const xpLevelName = document.getElementById('xpLevelName');
  if (!xpFill) return;

  let level = 0;
  for (let i = GAME.levels.length - 1; i >= 0; i--) {
    if (GAME.xp >= GAME.levels[i].threshold) { level = i; break; }
  }

  if (level > GAME.currentLevel) {
    GAME.currentLevel = level;
    showLevelUp(GAME.levels[level].name);
    launchConfetti(document.getElementById('xpPanel'));
  }

  const pct = Math.min(100, (GAME.xp / GAME.maxXP) * 100);
  xpFill.style.width = pct + '%';
  xpPoints.textContent = `${GAME.xp} / ${GAME.maxXP} XP`;
  xpLevelName.textContent = GAME.levels[level].name;

  GAME.levels.forEach((lvl, i) => {
    const el = document.getElementById(lvl.badge);
    if (el) {
      if (i <= level) el.classList.add('unlocked');
      else el.classList.remove('unlocked');
    }
  });
}

function showLevelUp(levelName){
  const toast = document.createElement('div');
  toast.className = 'levelup-toast';
  toast.innerHTML = `🎉 Новый уровень!<div class="sub">${levelName}</div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 600);
  }, 3000);
}

function addXP(points){
  GAME.xp = Math.min(GAME.maxXP, GAME.xp + points);
  updateGameUI();
}

/* ============================================================
   ОБЩАЯ ЛОГИКА ИНТЕРАКТИВНОГО УРОКА
   ============================================================ */
const LEVEL_LABEL = {
  easy:  "🟢 Простое · 1 балл",
  medium:"🟡 Среднее · 2 балла",
  hard:  "🔴 Сложное · 3 балла"
};

/* Мягкое сравнение текстовых ответов: регистр, «ё», лишние пробелы, запятая */
function normalizeAnswer(value){
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.');
}

const variantKeys = Object.keys(LESSON_DATA.variants);
let variantKey = null;
let TASKS = [];
let totalMax = 0;

const hwData = LESSON_DATA.homework || [];
const hwMax = hwData.length;

let progress = null;
let currentVariant = null;
let completedFromServer = [];
let serverTests = [];

/* ---------- ХРАНЕНИЕ ПОПЫТКИ ---------- */
const studentKey = (window.__student && (window.__student.accountId || window.__student.id)) || 'anonymous';
const PROGRESS_KEY = 'lessonProgress:v1:' + studentKey + ':' + encodeURIComponent(LESSON_DATA.title);
const NEXT_VARIANT_KEY = 'lessonNextVariant:v1:' + studentKey + ':' + encodeURIComponent(LESSON_DATA.title);
let memoryProgress = null;

function emptyProgress() {
  return { variants: {}, homework: null };
}

function readProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return emptyProgress();
    if (!data.variants || typeof data.variants !== 'object') data.variants = {};
    return data;
  } catch (e) {
    console.warn('Не удалось прочитать прогресс урока:', e);
    return memoryProgress || (memoryProgress = emptyProgress());
  }
}

function mergeRecord(target, source) {
  if (!source) return target;
  if (!target) return source;

  if (!target.tasks) target.tasks = {};
  Object.keys(source.tasks || {}).forEach(function (i) {
    if (!target.tasks[i]) target.tasks[i] = source.tasks[i];
  });

  target.startedAt = target.startedAt || source.startedAt;

  if (source.finished && !target.finished) {
    target.finished = true;
    target.finishedAt = source.finishedAt || target.finishedAt;
    target.score = source.score;
    target.maxScore = source.maxScore;
    target.grade = source.grade;
    target.resultSent = source.resultSent;
  }

  return target;
}

function writeProgress() {
  if (!progress) return;
  memoryProgress = progress;

  try {
    const stored = readProgress();
    Object.keys(stored.variants || {}).forEach(function (v) {
      progress.variants[v] = mergeRecord(progress.variants[v], stored.variants[v]);
    });
    if (stored.homework) {
      progress.homework = mergeRecord(progress.homework, stored.homework);
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {
    console.warn('Не удалось сохранить прогресс урока:', e);
  }
}

function ensureVariantRecord(key) {
  if (!progress.variants[key]) {
    progress.variants[key] = {
      startedAt: new Date().toISOString(),
      tasks: {},
      finished: false,
      finishedAt: null,
      score: null,
      maxScore: null,
      grade: null,
      resultSent: false
    };
  }
  if (!progress.variants[key].startedAt) {
    progress.variants[key].startedAt = new Date().toISOString();
  }
  if (!progress.variants[key].tasks) progress.variants[key].tasks = {};
  writeProgress();
  return progress.variants[key];
}

function ensureHomeworkRecord() {
  if (!progress.homework) {
    progress.homework = {
      tasks: {},
      finished: false,
      finishedAt: null,
      score: null,
      maxScore: null,
      grade: null,
      resultSent: false
    };
  }
  if (!progress.homework.tasks) progress.homework.tasks = {};
  writeProgress();
  return progress.homework;
}

/* ---------- ИСТОРИЯ ПРОХОЖДЕНИЙ С СЕРВЕРА ---------- */
function serverAttemptHistory() {
  if (!window.Account || !Account.isLoggedIn || !Account.isLoggedIn() || !Account.getMyResults) {
    return Promise.resolve({ tested: [], homework: null });
  }

  const timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve({ tested: [], tests: [], homework: null, timedOut: true });
    }, 4000);
  });

  const request = Account.getMyResults().then(function (results) {
    const testRows = [];
    let homework = null;

    (results || []).forEach(function (r) {
      if (String(r.lesson || '') !== LESSON_DATA.title) return;

      if (String(r.workType) === 'test') {
        testRows.push(r);
      }

      if (String(r.workType) === 'homework') {
        if (!homework || (Number(r.score) || 0) > (Number(homework.score) || 0)) {
          homework = r;
        }
      }
    });

    const best = {};
    testRows.forEach(function (r) {
      const v = String(r.variant || '');
      if (variantKeys.indexOf(v) === -1) return;
      const score = Number(r.score) || 0;
      if (!best[v] || score > best[v].score) {
        best[v] = {
          variant: v,
          score: score,
          maxScore: Number(r.maxScore) || 0
        };
      }
    });

    const tests = variantKeys.filter(function (v) { return !!best[v]; })
      .map(function (v) { return best[v]; });

    return {
      tested: tests.map(function (t) { return t.variant; }),
      tests: tests,
      homework: homework
    };
  }).catch(function (err) {
    console.warn('Не удалось загрузить историю попыток:', err);
    return { tested: [], tests: [], homework: null };
  });

  return Promise.race([request, timeout]);
}

function pickVariant(history, skipLastFinished) {
  const completed = {};

  (history.tested || []).forEach(function (v) { completed[v] = true; });
  variantKeys.forEach(function (v) {
    if (progress.variants[v] && progress.variants[v].finished) completed[v] = true;
  });

  for (let i = 0; i < variantKeys.length; i++) {
    const v = variantKeys[i];
    const rec = progress.variants[v];
    if (rec && rec.startedAt && !rec.finished && !completed[v]) return v;
  }

  const available = variantKeys.filter(function (v) { return !completed[v]; });
  if (!available.length) return null;

  // После завершения попытки обычная перезагрузка показывает тот же вариант
  // и его результат. Следующий вариант открывается только по кнопке.
  const last = progress.lastFinishedVariant;
  if (!skipLastFinished && last && progress.variants[last] && progress.variants[last].finished) {
    return last;
  }

  return available[Math.floor(Math.random() * available.length)];
}

/* ---------- ОЦЕНКИ ---------- */
function gradeInfo(pct) {
  if (pct >= 85) return { grade: 5, comment: 'Отлично! Материал усвоен.' };
  if (pct >= 65) return { grade: 4, comment: 'Хорошо! Повторите сложные задания.' };
  if (pct >= 45) return { grade: 3, comment: 'Удовлетворительно. Стоит повторить тему.' };
  return { grade: 2, comment: 'Попробуйте пройти урок ещё раз.' };
}

function homeworkGradeInfo(pct) {
  if (pct >= 85) return { grade: 5, comment: 'Отлично! Домашнее задание выполнено верно.' };
  if (pct >= 65) return { grade: 4, comment: 'Хорошо! Немного повторите материал.' };
  if (pct >= 45) return { grade: 3, comment: 'Удовлетворительно. Стоит перечитать теорию.' };
  return { grade: 2, comment: 'Попробуйте выполнить домашнее задание ещё раз.' };
}

document.getElementById('title').textContent    = LESSON_DATA.title;
document.getElementById('subtitle').textContent = LESSON_DATA.subtitle;

const nameDisplay = document.getElementById('studentNameDisplay');
if (nameDisplay && window.__student) {
  nameDisplay.textContent = window.__student.name + ' · ' + window.__student.class;
}

const goalEl = document.getElementById('goalText');
if (goalEl) goalEl.textContent = LESSON_DATA.goal || '';

const tasksUl = document.getElementById('tasksList');
if (tasksUl && LESSON_DATA.tasks) {
  LESSON_DATA.tasks.forEach(function(t){
    const li = document.createElement('li');
    li.textContent = t;
    tasksUl.appendChild(li);
  });
}

const theoryList = document.getElementById('theoryList');
LESSON_DATA.theory.forEach((item,i)=>{
  const el = document.createElement('div');
  el.className = 'theory-item' + (i===0?' open':'');

  const imgHTML = item.image
    ? `<div class="theory-illustration">${item.image.split(' ').map(e=>`<span class="emoji-big">${e}</span>`).join('')}</div>`
    : '';

  el.innerHTML = `
    <div class="theory-head"><span>${item.title}</span><span class="arrow">▾</span></div>
    <div class="theory-body">${imgHTML}${item.body}</div>`;
  el.querySelector('.theory-head').addEventListener('click',()=>el.classList.toggle('open'));
  theoryList.appendChild(el);
});

if (typeof renderMindMap === 'function') {
  renderMindMap(LESSON_DATA.mindmap, document.getElementById('mindmapBox'));
}

document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const t = tab.dataset.tab;

    document.getElementById('theorySection').classList.toggle('hidden',   t!=='theory');
    document.getElementById('mindmapSection').classList.toggle('hidden',  t!=='mindmap');
    document.getElementById('solutionsSection').classList.toggle('hidden', t!=='solutions');
    document.getElementById('testSection').classList.toggle('hidden',     t!=='test');
    document.getElementById('finishCard').classList.toggle('hidden',      t!=='test');
    document.getElementById('homeworkSection').classList.toggle('hidden', t!=='homework');

    window.scrollTo({top:0,behavior:'smooth'});
  });
});

function launchConfetti(anchorEl) {
  const colors = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#22c55e','#ef4444'];
  const rect = anchorEl.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;

  for (let i = 0; i < 22; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.left = (startX + (Math.random() - 0.5) * 120) + 'px';
    c.style.top = (startY + (Math.random() - 0.5) * 30) + 'px';
    c.style.animationDelay = (Math.random() * 0.2) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1500);
  }
}

/* ---------- ОТРИСОВКА И ПРОВЕРКА ТЕСТА ---------- */
const tasksEl = document.getElementById('tasks');
const finishBtn = document.getElementById('finish');
const scoreBox = document.getElementById('scoreBox');

function completedVariants() {
  const completed = {};
  (completedFromServer || []).forEach(function (v) { completed[v] = true; });
  variantKeys.forEach(function (v) {
    if (progress && progress.variants[v] && progress.variants[v].finished) completed[v] = true;
  });
  return completed;
}

function remainingVariantsCount() {
  const completed = completedVariants();
  return variantKeys.filter(function (v) { return !completed[v]; }).length;
}

function maxForVariant(v) {
  return (LESSON_DATA.variants[v] || []).reduce(function (s, t) { return s + t.weight; }, 0);
}

function variantScore(rec) {
  if (!rec || !rec.tasks) return 0;
  let got = 0;
  TASKS.forEach(function (t, i) {
    if (rec.tasks[i] && rec.tasks[i].correct) got += t.weight;
  });
  return got;
}

function taskElByIndex(i) {
  return tasksEl.querySelector('.task[data-task="' + i + '"]');
}

function lockTaskControls(i, rec, lockedText) {
  const taskEl = taskElByIndex(i);
  if (!taskEl) return;
  taskEl.classList.add('locked');

  const btn = taskEl.querySelector('[data-check]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = lockedText || '🔒 Ответ принят';
    btn.classList.add('locked-btn');
  }

  const t = TASKS[i];
  if (t.type === 'choice') {
    taskEl.querySelectorAll('input[type="radio"]').forEach(function (inp) {
      inp.disabled = true;
      if (rec && rec.answer !== undefined && inp.value === String(rec.answer)) {
        inp.checked = true;
      }
    });
  } else {
    const input = document.getElementById('txt' + i);
    if (input) {
      if (rec && rec.answer !== undefined) input.value = rec.answer;
      input.readOnly = true;
      input.disabled = true;
    }
  }
}

function applyTaskRecord(i, rec, animate) {
  if (!rec) return;
  const t = TASKS[i];
  const res = document.getElementById('res' + i);
  if (!res) return;

  if (rec.correct) {
    res.className = 'result ok' + (animate ? ' pop-in' : '');
    res.innerHTML = `✔ Верно! +${t.weight} балл(ов).<div class="exp">${t.exp}</div>`;
  } else {
    res.className = 'result bad';
    res.innerHTML = `✖ Неверно.<div class="exp">${t.exp}</div>`;
  }

  lockTaskControls(i, rec, '🔒 Ответ принят');
}

function updateProgress(){
  const rec = currentVariant;
  const tasks = (rec && rec.tasks) || {};
  const done = Object.keys(tasks).length;
  const got = variantScore(rec);
  document.getElementById('bar').style.width =
    (TASKS.length ? done / TASKS.length * 100 : 0) + '%';
  document.getElementById('progTxt').textContent =
    `Проверено ${done} из ${TASKS.length} заданий · Баллы: ${got} / ${totalMax}`;
}

function renderVariant() {
  document.getElementById('variantBadge').textContent = `Вариант ${variantKey}`;
  currentVariant = ensureVariantRecord(variantKey);

  if (!currentVariant.finished && progress.lastFinishedVariant !== variantKey) {
    progress.lastFinishedVariant = null;
    writeProgress();
  }

  tasksEl.innerHTML = '';

  const notice = document.createElement('div');
  notice.className = 'lock-notice';
  notice.innerHTML = '<span class="lock-icon">🔒</span><span><b>Ответ фиксируется после первой проверки.</b> Проверить каждое задание можно только один раз — изменить ответ и получить баллы повторно не получится.</span>';
  tasksEl.appendChild(notice);

  TASKS.forEach(function (t, i) {
    const div = document.createElement('div');
    div.className = 'task ' + t.level;
    div.dataset.task = i;

    let body = '';
    if (t.type === 'choice') {
      body = t.options.map(function (o, j) {
        return `<label class="opt"><input type="radio" name="q${i}" value="${j}"><span>${o}</span></label>`;
      }).join('');
    } else {
      body = `<input type="text" id="txt${i}" placeholder="Введите ответ...">`;
    }

    div.innerHTML = `
      <span class="badge ${t.level}">${LEVEL_LABEL[t.level]}</span>
      <div class="q">${i + 1}. ${t.q}</div>
      ${body}
      <button class="btn ghost" style="margin-top:14px;padding:9px 22px" data-check="${i}">Проверить</button>
      <div class="result" id="res${i}"></div>`;
    tasksEl.appendChild(div);
  });

  Object.keys(currentVariant.tasks || {}).forEach(function (k) {
    const i = Number(k);
    if (TASKS[i]) applyTaskRecord(i, currentVariant.tasks[k], false);
  });

  updateProgress();

  if (currentVariant.finished) {
    finishVariantUI(currentVariant, true);
  }
}

tasksEl.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-check]');
  if (!btn || !variantKey) return;

  const i = +btn.dataset.check;
  const t = TASKS[i];
  const res = document.getElementById('res' + i);

  // Перечитываем прогресс перед проверкой: вторая вкладка не должна
  // перезаписать уже зафиксированный ответ.
  progress = readProgress();
  currentVariant = ensureVariantRecord(variantKey);

  if (currentVariant.finished) {
    finishVariantUI(currentVariant, true);
    return;
  }

  if (currentVariant.tasks[i]) {
    applyTaskRecord(i, currentVariant.tasks[i], false);
    updateProgress();
    return;
  }

  let correct = false;
  let answer;

  if (t.type === 'choice') {
    const sel = tasksEl.querySelector(`input[name="q${i}"]:checked`);
    if (!sel) {
      res.className = 'result bad';
      res.innerHTML = 'Выберите вариант ответа.';
      return;
    }
    answer = +sel.value;
    correct = (answer === t.answer);
  } else {
    const input = document.getElementById('txt' + i);
    answer = input ? input.value : '';
    correct = (normalizeAnswer(answer) === normalizeAnswer(t.answer));
  }

  currentVariant.tasks[i] = { answer: answer, correct: correct };
  writeProgress();
  applyTaskRecord(i, currentVariant.tasks[i], true);
  updateProgress();
  recalcXP(false);

  if (correct) {
    launchConfetti(btn);
  } else {
    const taskEl = btn.closest('.task');
    if (taskEl) {
      taskEl.classList.add('shake');
      setTimeout(function () { taskEl.classList.remove('shake'); }, 500);
    }
  }
});

function getVariantsNote() {
  let note = document.getElementById('variantsLeftNote');
  if (!note) {
    note = document.createElement('div');
    note.id = 'variantsLeftNote';
    note.className = 'variants-note';
    const reloadBtn = scoreBox.querySelector('.btn.ghost');
    if (reloadBtn && reloadBtn.parentNode === scoreBox) {
      scoreBox.insertBefore(note, reloadBtn);
    } else {
      scoreBox.appendChild(note);
    }
  }
  return note;
}

function showTestResult(rec, restored) {
  const max = Number(rec.maxScore) || totalMax;
  const got = (rec.score !== null && rec.score !== undefined)
    ? Number(rec.score)
    : variantScore(rec);
  const pct = max ? got / max * 100 : 0;
  const info = gradeInfo(pct);

  scoreBox.classList.remove('hidden');
  scoreBox.classList.add('pop-in');
  document.getElementById('finalScore').textContent =
    `Набрано ${got} из ${max} баллов (${pct.toFixed(0)}%)`;

  const gradeEl = document.getElementById('finalGrade');
  gradeEl.textContent = info.grade;
  gradeEl.classList.add('pop-in');
  document.getElementById('finalComment').textContent = info.comment;

  const ringFill = document.getElementById('ringFill');
  const ringPercent = document.getElementById('ringPercent');
  if (ringFill && ringPercent) {
    const circumference = 283;
    ringFill.style.strokeDashoffset = circumference - (pct / 100) * circumference;
    ringPercent.textContent = Math.round(pct) + '%';
  }

  const emojiMap = { 5: '🏆', 4: '🌟', 3: '👍', 2: '💪' };
  const finalEmojiEl = document.getElementById('finalEmoji');
  if (finalEmojiEl) {
    finalEmojiEl.textContent = emojiMap[info.grade] || '📘';
    finalEmojiEl.classList.add('anim-bounce');
  }

  const left = remainingVariantsCount();
  const note = getVariantsNote();
  if (left > 0) {
    note.innerHTML = `Вы прошли вариант ${variantKey}. Осталось вариантов: <b>${left}</b>. ` +
      'Нажмите «Пройти другой вариант», чтобы продолжить.';
  } else {
    note.innerHTML = '✅ <b>Вы прошли все варианты этого урока.</b> ' +
      'Повторное прохождение теста недоступно.';
  }

  const reloadBtn = scoreBox.querySelector('.btn.ghost');
  if (reloadBtn) {
    reloadBtn.style.display = left > 0 ? '' : 'none';
    if (left > 0) {
      reloadBtn.onclick = function () {
        try { sessionStorage.setItem(NEXT_VARIANT_KEY, '1'); } catch (e) { /* ignore */ }
        window.location.reload();
      };
    }
  }

  finishBtn.disabled = true;
  finishBtn.textContent = 'Результат отправлен ✓';

  if (!restored) {
    scoreBox.scrollIntoView({ behavior: 'smooth' });
    if (info.grade >= 4) {
      setTimeout(function () { launchConfetti(gradeEl); }, 200);
      setTimeout(function () { launchConfetti(gradeEl); }, 500);
      setTimeout(function () { launchConfetti(gradeEl); }, 800);
    }
  }
}

function finishVariantUI(rec, restored) {
  TASKS.forEach(function (t, i) {
    if (rec.tasks[i]) {
      applyTaskRecord(i, rec.tasks[i], false);
    } else {
      lockTaskControls(i, null, '🔒 Тест завершён');
    }
  });
  finishBtn.disabled = true;
  finishBtn.dataset.sent = '1';
  finishBtn.textContent = 'Результат отправлен ✓';
  showTestResult(rec, restored);
}

finishBtn.addEventListener('click', function () {
  if (!variantKey) return;

  progress = readProgress();
  currentVariant = ensureVariantRecord(variantKey);

  if (currentVariant.finished) {
    finishVariantUI(currentVariant, true);
    return;
  }

  const checked = Object.keys(currentVariant.tasks || {}).length;
  if (checked < TASKS.length) {
    alert('Сначала проверьте все задания теста. Ответы фиксируются после проверки.');
    return;
  }

  const studentName = (window.__student && window.__student.name) || '';
  if (!studentName) {
    alert('Не найдены данные ученика. Войдите заново.');
    return;
  }

  const got = variantScore(currentVariant);
  const pct = totalMax ? got / totalMax * 100 : 0;
  const info = gradeInfo(pct);

  currentVariant.finished = true;
  currentVariant.finishedAt = new Date().toISOString();
  currentVariant.score = got;
  currentVariant.maxScore = totalMax;
  currentVariant.grade = info.grade;
  currentVariant.resultSent = false;
  progress.lastFinishedVariant = variantKey;
  writeProgress();

  finishVariantUI(currentVariant, false);
  recalcXP(false);

  sendToSheet({
    studentName: studentName,
    className: LESSON_DATA.className || '',
    lesson: LESSON_DATA.title,
    variant: variantKey,
    score: got,
    maxScore: totalMax,
    grade: info.grade,
    workType: 'test'
  }).then(function (ok) {
    progress = readProgress();
    const rec = progress.variants[variantKey];
    if (rec) {
      rec.resultSent = !!ok;
      writeProgress();
    }
  });
});

/* ---------- XP ИЗ СОХРАНЁННОГО ПРОГРЕССА ---------- */
function computeXP() {
  let xp = 0;

  variantKeys.forEach(function (v) {
    const rec = progress.variants[v];
    const tasks = LESSON_DATA.variants[v] || [];
    if (!rec || !rec.tasks) return;
    Object.keys(rec.tasks).forEach(function (i) {
      const entry = rec.tasks[i];
      if (entry && entry.correct && tasks[i]) xp += tasks[i].weight * 3;
    });
  });

  if (progress.homework && progress.homework.tasks) {
    Object.keys(progress.homework.tasks).forEach(function (i) {
      const entry = progress.homework.tasks[i];
      if (entry && entry.correct) xp += 4;
    });
  }

  return xp;
}

function recalcXP(restoring) {
  GAME.xp = Math.min(GAME.maxXP, computeXP());

  if (restoring) {
    let level = 0;
    for (let i = GAME.levels.length - 1; i >= 0; i--) {
      if (GAME.xp >= GAME.levels[i].threshold) { level = i; break; }
    }
    GAME.currentLevel = level;
  }

  updateGameUI();
}

/* ---------- ДОМАШНЕЕ ЗАДАНИЕ ---------- */
function hwTaskElByIndex(i) {
  return document.querySelector('#homeworkTasks .task[data-hw-task="' + i + '"]');
}

function lockHwControls(i, rec, lockedText) {
  const taskEl = hwTaskElByIndex(i);
  if (!taskEl) return;
  taskEl.classList.add('locked');

  const btn = taskEl.querySelector('[data-hw-check]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = lockedText || '🔒 Ответ принят';
    btn.classList.add('locked-btn');
  }

  const t = hwData[i];
  if (t.type === 'choice') {
    taskEl.querySelectorAll('input[type="radio"]').forEach(function (inp) {
      inp.disabled = true;
      if (rec && rec.answer !== undefined && inp.value === String(rec.answer)) {
        inp.checked = true;
      }
    });
  } else {
    const input = document.getElementById('hwTxt' + i);
    if (input) {
      if (rec && rec.answer !== undefined) input.value = rec.answer;
      input.readOnly = true;
      input.disabled = true;
    }
  }
}

function applyHwTaskRecord(i, rec, animate) {
  if (!rec) return;
  const t = hwData[i];
  const res = document.getElementById('hwRes' + i);
  if (!res) return;

  if (rec.correct) {
    res.className = 'result ok' + (animate ? ' pop-in' : '');
    res.innerHTML = `✔ Верно! +1 балл.<div class="exp">${t.exp}</div>`;
  } else {
    res.className = 'result bad';
    res.innerHTML = `✖ Неверно.<div class="exp">${t.exp}</div>`;
  }

  lockHwControls(i, rec, '🔒 Ответ принят');
}

function hwScore(rec) {
  if (!rec || !rec.tasks) return 0;
  let got = 0;
  Object.keys(rec.tasks).forEach(function (i) {
    if (rec.tasks[i] && rec.tasks[i].correct) got += 1;
  });
  return got;
}

function updateHwProgress() {
  const rec = progress.homework;
  const tasks = (rec && rec.tasks) || {};
  const done = Object.keys(tasks).length;
  const got = hwScore(rec);

  if (rec && rec.finished) {
    const finalScore = (rec.score !== null && rec.score !== undefined)
      ? Number(rec.score)
      : got;
    document.getElementById('hwBar').style.width =
      (hwMax ? finalScore / hwMax * 100 : 0) + '%';
    document.getElementById('hwProgTxt').textContent =
      `Домашнее задание выполнено · Баллы: ${finalScore} / ${hwMax}`;
    return;
  }

  document.getElementById('hwBar').style.width =
    (hwData.length ? done / hwData.length * 100 : 0) + '%';
  document.getElementById('hwProgTxt').textContent =
    `Проверено ${done} из ${hwData.length} заданий · Баллы: ${got} / ${hwMax}`;
}

function showHwResult(rec, restored) {
  const max = Number(rec.maxScore) || hwMax;
  const got = (rec.score !== null && rec.score !== undefined)
    ? Number(rec.score)
    : hwScore(rec);
  const pct = max ? got / max * 100 : 0;
  const info = homeworkGradeInfo(pct);

  const box = document.getElementById('hwScoreBox');
  box.classList.remove('hidden');
  box.classList.add('pop-in');
  document.getElementById('hwFinalScore').textContent =
    `Набрано ${got} из ${max} баллов (${pct.toFixed(0)}%)`;
  document.getElementById('hwGrade').textContent = info.grade;
  document.getElementById('hwComment').textContent = info.comment;

  const btn = document.getElementById('hwFinish');
  btn.dataset.sent = '1';
  btn.disabled = true;
  btn.textContent = 'Результат отправлен ✓';

  if (!restored) {
    box.scrollIntoView({ behavior: 'smooth' });
    if (info.grade >= 4) {
      setTimeout(function () { launchConfetti(document.getElementById('hwGrade')); }, 200);
      setTimeout(function () { launchConfetti(document.getElementById('hwGrade')); }, 500);
    }
  }
}

function finishHomeworkUI(rec, restored) {
  hwData.forEach(function (t, i) {
    if (rec.tasks[i]) {
      applyHwTaskRecord(i, rec.tasks[i], false);
    } else {
      lockHwControls(i, null, '🔒 Попытка использована');
    }
  });
  updateHwProgress();
  showHwResult(rec, restored);
}

function initHomework() {
  if (!hwData || !hwData.length) return;

  const hwTasksEl = document.getElementById('homeworkTasks');
  if (!hwTasksEl) return;

  hwTasksEl.innerHTML = '';

  const notice = document.createElement('div');
  notice.className = 'lock-notice';
  notice.innerHTML = '<span class="lock-icon">🔒</span><span><b>Домашнее задание выполняется один раз.</b> Проверьте ответы внимательно: после проверки изменить их нельзя.</span>';
  hwTasksEl.appendChild(notice);

  hwData.forEach(function (t, i) {
    const div = document.createElement('div');
    div.className = 'task easy';
    div.dataset.hwTask = i;

    let body = '';
    if (t.type === 'choice') {
      body = t.options.map(function (o, j) {
        return `<label class="opt"><input type="radio" name="hw${i}" value="${j}"><span>${o}</span></label>`;
      }).join('');
    } else {
      body = `<input type="text" id="hwTxt${i}" placeholder="Введите ответ...">`;
    }

    div.innerHTML = `
      <span class="badge easy">🏠 Задание ${i + 1} · 1 балл</span>
      <div class="q">${i + 1}. ${t.q}</div>
      ${body}
      <button class="btn ghost" style="margin-top:14px;padding:9px 22px" data-hw-check="${i}">Проверить</button>
      <div class="result" id="hwRes${i}"></div>`;
    hwTasksEl.appendChild(div);
  });

  progress = progress || readProgress();

  if (progress.homework) {
    Object.keys(progress.homework.tasks || {}).forEach(function (k) {
      const i = Number(k);
      if (hwData[i]) applyHwTaskRecord(i, progress.homework.tasks[k], false);
    });
    updateHwProgress();
    if (progress.homework.finished) {
      finishHomeworkUI(progress.homework, true);
    }
  } else {
    updateHwProgress();
  }

  hwTasksEl.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-hw-check]');
    if (!btn) return;

    const i = +btn.dataset.hwCheck;
    const t = hwData[i];
    const res = document.getElementById('hwRes' + i);

    // Перечитываем прогресс, чтобы вторая вкладка не сбросила ответ.
    progress = readProgress();
    const rec = ensureHomeworkRecord();

    if (rec.finished) {
      finishHomeworkUI(rec, true);
      return;
    }

    if (rec.tasks[i]) {
      applyHwTaskRecord(i, rec.tasks[i], false);
      updateHwProgress();
      return;
    }

    let correct = false;
    let answer;

    if (t.type === 'choice') {
      const sel = hwTasksEl.querySelector(`input[name="hw${i}"]:checked`);
      if (!sel) {
        res.className = 'result bad';
        res.innerHTML = 'Выберите вариант ответа.';
        return;
      }
      answer = +sel.value;
      correct = (answer === t.answer);
    } else {
      const input = document.getElementById('hwTxt' + i);
      answer = input ? input.value : '';
      correct = (normalizeAnswer(answer) === normalizeAnswer(t.answer));
    }

    rec.tasks[i] = { answer: answer, correct: correct };
    writeProgress();
    applyHwTaskRecord(i, rec.tasks[i], true);
    updateHwProgress();
    recalcXP(false);

    if (correct) {
      launchConfetti(btn);
    } else {
      const taskEl = btn.closest('.task');
      if (taskEl) {
        taskEl.classList.add('shake');
        setTimeout(function () { taskEl.classList.remove('shake'); }, 500);
      }
    }
  });

  document.getElementById('hwFinish').addEventListener('click', function () {
    progress = readProgress();
    const rec = ensureHomeworkRecord();

    if (rec.finished) {
      showHwResult(rec, true);
      return;
    }

    const checked = Object.keys(rec.tasks || {}).length;
    if (checked < hwData.length) {
      alert('Сначала проверьте все задания домашней работы. Ответы фиксируются после проверки.');
      return;
    }

    const got = hwScore(rec);
    const pct = hwMax ? got / hwMax * 100 : 0;
    const info = homeworkGradeInfo(pct);

    rec.finished = true;
    rec.finishedAt = new Date().toISOString();
    rec.score = got;
    rec.maxScore = hwMax;
    rec.grade = info.grade;
    rec.resultSent = false;
    writeProgress();

    finishHomeworkUI(rec, false);
    recalcXP(false);

    const studentName = (window.__student && window.__student.name) || 'Без имени';
    sendToSheet({
      studentName: studentName,
      className: LESSON_DATA.className || '',
      lesson: LESSON_DATA.title,
      variant: 'HW',
      score: got,
      maxScore: hwMax,
      grade: info.grade,
      workType: 'homework'
    }).then(function (ok) {
      progress = readProgress();
      if (progress.homework) {
        progress.homework.resultSent = !!ok;
        writeProgress();
      }
    });
  });
}

/* ---------- ВСЕ ВАРИАНТЫ ПРОЙДЕНЫ ---------- */
function renderAllCompleted() {
  variantKey = null;
  document.getElementById('variantBadge').textContent = 'Все варианты пройдены';

  const scores = {};
  (serverTests || []).forEach(function (t) {
    if (!scores[t.variant] || (Number(t.score) || 0) > (Number(scores[t.variant].score) || 0)) {
      scores[t.variant] = t;
    }
  });
  variantKeys.forEach(function (v) {
    const rec = progress.variants[v];
    if (rec && rec.finished) {
      scores[v] = { variant: v, score: rec.score, maxScore: rec.maxScore };
    }
  });

  const rows = variantKeys.map(function (v) {
    const s = scores[v];
    const text = s
      ? `${Number(s.score) || 0} из ${Number(s.maxScore) || maxForVariant(v)} баллов`
      : 'пройден';
    return `<div class="variant-summary-row"><span>Вариант ${v}</span><b>${text}</b></div>`;
  }).join('');

  tasksEl.innerHTML = `
    <div class="all-done-panel">
      <div class="all-done-icon">🏁</div>
      <h3>Вы прошли все варианты этого урока</h3>
      <p>На каждый вариант даётся одна попытка, поэтому повторно пройти тест нельзя. Результаты сохранены в разделе «Мои результаты».</p>
      <div class="variant-summary">${rows}</div>
    </div>`;

  document.getElementById('bar').style.width = '100%';
  document.getElementById('progTxt').textContent = 'Все варианты пройдены';

  finishBtn.style.display = 'none';
  document.getElementById('finishCard').style.display = 'none';
  scoreBox.classList.add('hidden');
}

/* ---------- ЗАПУСК УРОКА ---------- */
(function initLesson() {
  progress = readProgress();

  serverAttemptHistory().then(function (history) {
    completedFromServer = history.tested || [];
    serverTests = history.tests || [];

    // Домашнее задание, уже сохранённое на сервере, тоже считается попыткой.
    if (history.homework) {
      const local = progress.homework;
      if (!local || !local.finished) {
        const h = history.homework;
        progress.homework = {
          tasks: (local && local.tasks) || {},
          finished: true,
          finishedAt: h.timestamp || new Date().toISOString(),
          score: Number(h.score) || 0,
          maxScore: Number(h.maxScore) || hwMax,
          grade: Number(h.grade) || homeworkGradeInfo(
            h.maxScore ? (Number(h.score) || 0) / Number(h.maxScore) * 100 : 0
          ).grade,
          resultSent: true,
          fromServer: true
        };
        writeProgress();
      }
    }

    let skipLastFinished = false;
    try {
      if (sessionStorage.getItem(NEXT_VARIANT_KEY) === '1') {
        sessionStorage.removeItem(NEXT_VARIANT_KEY);
        skipLastFinished = true;
      }
    } catch (e) { /* ignore */ }

    variantKey = pickVariant(history, skipLastFinished);

    if (!variantKey) {
      renderAllCompleted();
    } else {
      TASKS = LESSON_DATA.variants[variantKey];
      totalMax = maxForVariant(variantKey);
      renderVariant();
    }

    initHomework();
    recalcXP(true);
  });
})();
