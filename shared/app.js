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

  // 2. Проверка профиля ЕГЭ (блокируем только тренажеры ЕГЭ)
  const isEgeContent = window.location.pathname.includes('/ege-class/') || LESSON_DATA.title.toLowerCase().includes('тренажер');
  
  if (isEgeContent && student.track !== 'ege') {
    alert('Этот урок доступен только в режиме "Подготовка к ЕГЭ". Выйдите и выберите соответствующий профиль при входе.');
    window.location.href = '../lessons.html';
    throw new Error('Неверный профиль');
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
const GAME = {
  xp: 0,
  maxXP: 100,
  levels: [
    { name: '🥉 Новичок',        threshold: 0,  badge: 'badgeBronze' },
    { name: '🥈 Писарь',          threshold: 40, badge: 'badgeSilver' },
    { name: '🥇 Мастер текста',   threshold: 75, badge: 'badgeGold'   }
  ],
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

const variantKeys = Object.keys(LESSON_DATA.variants);
const variantKey  = variantKeys[Math.floor(Math.random()*variantKeys.length)];
const TASKS       = LESSON_DATA.variants[variantKey];
const totalMax    = TASKS.reduce((s,t)=>s+t.weight,0);
const state       = {};

document.getElementById('title').textContent    = LESSON_DATA.title;
document.getElementById('subtitle').textContent = LESSON_DATA.subtitle;

const nameDisplay = document.getElementById('studentNameDisplay');
if (nameDisplay && window.__student) {
  nameDisplay.textContent = window.__student.name + ' · ' + window.__student.class;
}
document.getElementById('variantBadge').textContent = `Вариант ${variantKey}`;

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

const tasksEl = document.getElementById('tasks');
TASKS.forEach((t,i)=>{
  const div = document.createElement('div');
  div.className = 'task '+t.level;
  let body = '';
  if (t.type==='choice'){
    body = t.options.map((o,j)=>`
      <label class="opt"><input type="radio" name="q${i}" value="${j}"><span>${o}</span></label>`).join('');
  } else {
    body = `<input type="text" id="txt${i}" placeholder="Введите ответ...">`;
  }
  div.innerHTML = `
    <span class="badge ${t.level}">${LEVEL_LABEL[t.level]}</span>
    <div class="q">${i+1}. ${t.q}</div>
    ${body}
    <button class="btn ghost" style="margin-top:14px;padding:9px 22px" data-check="${i}">Проверить</button>
    <div class="result" id="res${i}"></div>`;
  tasksEl.appendChild(div);
});

tasksEl.addEventListener('click', e=>{
  const btn = e.target.closest('[data-check]');
  if (!btn) return;
  const i = +btn.dataset.check;
  const t = TASKS[i];
  const res = document.getElementById('res'+i);
  let correct = false;

  if (t.type==='choice'){
    const sel = document.querySelector(`input[name="q${i}"]:checked`);
    if (!sel){ res.className='result bad'; res.innerHTML='Выберите вариант ответа.'; return; }
    correct = (+sel.value === t.answer);
  } else {
    const val = document.getElementById('txt'+i).value.trim().replace(',','.');
    correct = (val === String(t.answer).trim());
  }

  if (correct){
    res.className='result ok pop-in';
    res.innerHTML = `✔ Верно! +${t.weight} балл(ов).<div class="exp">${t.exp}</div>`;
    state[i] = t.weight;
    launchConfetti(btn);
    addXP(t.weight * 3);
  } else {
    res.className='result bad';
    res.innerHTML = `✖ Неверно.<div class="exp">${t.exp}</div>`;
    state[i] = 0;
    const taskEl = btn.closest('.task');
    taskEl.classList.add('shake');
    setTimeout(() => taskEl.classList.remove('shake'), 500);
  }
  updateProgress();
});

function updateProgress(){
  const done = Object.keys(state).length;
  const got  = Object.values(state).reduce((a,b)=>a+b,0);
  document.getElementById('bar').style.width = (done/TASKS.length*100)+'%';
  document.getElementById('progTxt').textContent =
    `Проверено ${done} из ${TASKS.length} заданий · Баллы: ${got} / ${totalMax}`;
}

document.getElementById('finish').addEventListener('click', function() {
  const finishBtn = document.getElementById('finish');
  if (finishBtn.dataset.sent === '1') {
    alert('Результат уже отправлен.');
    return;
  }

  const studentName = (window.__student && window.__student.name) || '';
  if (!studentName) {
    alert('Не найдены данные ученика. Войдите заново.');
    return;
  }

  finishBtn.dataset.sent = '1';
  finishBtn.disabled = true;

  const got = Object.values(state).reduce((a, b) => a + b, 0);
  const pct = got / totalMax * 100;

  let g, comment;
  if (pct >= 85)      { g = 5; comment = 'Отлично! Материал усвоен.'; }
  else if (pct >= 65) { g = 4; comment = 'Хорошо! Повторите сложные задания.'; }
  else if (pct >= 45) { g = 3; comment = 'Удовлетворительно. Стоит повторить тему.'; }
  else                { g = 2; comment = 'Попробуйте пройти урок ещё раз.'; }

  const box = document.getElementById('scoreBox');
  box.classList.remove('hidden');
  box.classList.add('pop-in');
  document.getElementById('finalScore').textContent =
    `Набрано ${got} из ${totalMax} баллов (${pct.toFixed(0)}%)`;
  const gradeEl = document.getElementById('finalGrade');
  gradeEl.textContent = g;
  gradeEl.classList.add('pop-in');
  document.getElementById('finalComment').textContent = comment;
  
  const ringFill = document.getElementById('ringFill');
  const ringPercent = document.getElementById('ringPercent');
  if (ringFill && ringPercent) {
    const circumference = 283;
    const offset = circumference - (pct / 100) * circumference;
    ringFill.style.strokeDashoffset = offset;
    ringPercent.textContent = Math.round(pct) + '%';
  }

  const emojiMap = { 5: '🏆', 4: '🌟', 3: '👍', 2: '💪' };
  const finalEmojiEl = document.getElementById('finalEmoji');
  if (finalEmojiEl) {
    finalEmojiEl.textContent = emojiMap[g] || '📘';
    finalEmojiEl.classList.add('anim-bounce');
  }

  box.scrollIntoView({behavior:'smooth'});

  if (g >= 4) {
    setTimeout(() => launchConfetti(gradeEl), 200);
    setTimeout(() => launchConfetti(gradeEl), 500);
    setTimeout(() => launchConfetti(gradeEl), 800);
  }

  sendToSheet({
    studentName: studentName,
    className: LESSON_DATA.className || '',
    lesson: LESSON_DATA.title,
    variant: variantKey,
    score: got,
    maxScore: totalMax,
    grade: g,
    workType: 'test'
  });
});

(function initHomework(){
  const hwData = LESSON_DATA.homework;
  if (!hwData || !hwData.length) return;

  const hwTasksEl = document.getElementById('homeworkTasks');
  if (!hwTasksEl) return;

  const hwState = {};
  const hwMax = hwData.length * 1;

  hwData.forEach(function(t, i){
    const div = document.createElement('div');
    div.className = 'task easy';

    let body = '';
    if (t.type === 'choice') {
      body = t.options.map(function(o, j){
        return `<label class="opt"><input type="radio" name="hw${i}" value="${j}"><span>${o}</span></label>`;
      }).join('');
    } else {
      body = `<input type="text" id="hwTxt${i}" placeholder="Введите ответ...">`;
    }

    div.innerHTML = `
      <span class="badge easy">🏠 Задание ${i+1} · 1 балл</span>
      <div class="q">${i+1}. ${t.q}</div>
      ${body}
      <button class="btn ghost" style="margin-top:14px;padding:9px 22px" data-hw-check="${i}">Проверить</button>
      <div class="result" id="hwRes${i}"></div>`;
    hwTasksEl.appendChild(div);
  });

  hwTasksEl.addEventListener('click', function(e){
    const btn = e.target.closest('[data-hw-check]');
    if (!btn) return;
    const i = +btn.dataset.hwCheck;
    const t = hwData[i];
    const res = document.getElementById('hwRes' + i);
    let correct = false;

    if (t.type === 'choice') {
      const sel = document.querySelector(`input[name="hw${i}"]:checked`);
      if (!sel) {
        res.className = 'result bad';
        res.innerHTML = 'Выберите вариант ответа.';
        return;
      }
      correct = (+sel.value === t.answer);
    } else {
      const val = document.getElementById('hwTxt' + i).value.trim().replace(',', '.');
      correct = (val === String(t.answer).trim());
    }

    if (correct) {
      res.className = 'result ok pop-in';
      res.innerHTML = `✔ Верно! +1 балл.<div class="exp">${t.exp}</div>`;
      hwState[i] = 1;
      launchConfetti(btn);
      addXP(4);
    } else {
      res.className = 'result bad';
      res.innerHTML = `✖ Неверно.<div class="exp">${t.exp}</div>`;
      hwState[i] = 0;
      const taskEl = btn.closest('.task');
      taskEl.classList.add('shake');
      setTimeout(() => taskEl.classList.remove('shake'), 500);
    }
    updateHwProgress();
  });

  function updateHwProgress(){
    const done = Object.keys(hwState).length;
    const got = Object.values(hwState).reduce((a, b) => a + b, 0);
    document.getElementById('hwBar').style.width = (done / hwData.length * 100) + '%';
    document.getElementById('hwProgTxt').textContent =
      `Проверено ${done} из ${hwData.length} заданий · Баллы: ${got} / ${hwMax}`;
  }

  document.getElementById('hwFinish').addEventListener('click', function(){
    const btn = document.getElementById('hwFinish');

    if (btn.dataset.sent === '1') {
      alert('Результат уже отправлен. Перезагрузите страницу, чтобы пройти заново.');
      return;
    }

    const got = Object.values(hwState).reduce((a, b) => a + b, 0);
    const pct = got / hwMax * 100;

    let g, comment;
    if (pct >= 85)      { g = 5; comment = 'Отлично! Домашнее задание выполнено верно.'; }
    else if (pct >= 65) { g = 4; comment = 'Хорошо! Немного повторите материал.'; }
    else if (pct >= 45) { g = 3; comment = 'Удовлетворительно. Стоит перечитать теорию.'; }
    else                { g = 2; comment = 'Попробуйте выполнить домашнее задание ещё раз.'; }

    const box = document.getElementById('hwScoreBox');
    box.classList.remove('hidden');
    box.classList.add('pop-in');
    document.getElementById('hwFinalScore').textContent =
      `Набрано ${got} из ${hwMax} баллов (${pct.toFixed(0)}%)`;
    document.getElementById('hwGrade').textContent = g;
    document.getElementById('hwComment').textContent = comment;
    box.scrollIntoView({ behavior: 'smooth' });

    if (g >= 4) {
      setTimeout(() => launchConfetti(document.getElementById('hwGrade')), 200);
      setTimeout(() => launchConfetti(document.getElementById('hwGrade')), 500);
    }

    btn.dataset.sent = '1';
    btn.disabled = true;
    btn.textContent = 'Результат отправлен ✓';

    const studentName = (window.__student && window.__student.name) || 'Без имени';
    sendToSheet({
      studentName: studentName,
      className: LESSON_DATA.className || '',
      lesson: LESSON_DATA.title,
      variant: 'HW',
      score: got,
      maxScore: hwMax,
      grade: g,
      workType: 'homework'
    });
  });
})();
