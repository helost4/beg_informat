/* ============================================================
   АВТОРИЗАЦИЯ: проверка, что ученик открыл урок своего класса
   ============================================================ */
(function checkAccess(){
  const studentRaw = localStorage.getItem('student');

  // 1. Если ученик не вошёл — редирект на страницу входа
  if (!studentRaw) {
    window.location.href = '../login.html';
    throw new Error('Не выполнен вход');
  }

  const student = JSON.parse(studentRaw);
  // Делаем данные ученика доступными для остальной части app.js
  window.__student = student;

  // 2. Если класс ученика не совпадает с классом урока — редирект
  if (LESSON_DATA.className && student.class !== LESSON_DATA.className) {
    alert(`Этот урок предназначен для ${LESSON_DATA.className}. Вы вошли как ${student.class}.`);
    window.location.href = '../lessons.html';
    throw new Error('Класс не совпадает');
  }
})();

/* ============================================================
   ОБЩАЯ ФУНКЦИЯ ОТПРАВКИ РЕЗУЛЬТАТА В GOOGLE ТАБЛИЦУ
   Объявлена В НАЧАЛЕ, чтобы была доступна всем обработчикам
   ============================================================ */
function sendToSheet(payload){
  if (typeof APPS_SCRIPT_URL === 'undefined' || !APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('ВАШ_ID')) {
    console.warn('APPS_SCRIPT_URL не настроен — отправка пропущена');
    return;
  }

  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function() {
    console.log('Результат отправлен:', payload);
  }).catch(function(err) {
    console.error('Ошибка отправки:', err);
  });
}

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

  // Определяем текущий уровень
  let level = 0;
  for (let i = GAME.levels.length - 1; i >= 0; i--) {
    if (GAME.xp >= GAME.levels[i].threshold) { level = i; break; }
  }

  // Повышение уровня — показать уведомление
  if (level > GAME.currentLevel) {
    GAME.currentLevel = level;
    showLevelUp(GAME.levels[level].name);
    launchConfetti(document.getElementById('xpPanel'));
  }

  // Обновляем полосу и текст
  const pct = Math.min(100, (GAME.xp / GAME.maxXP) * 100);
  xpFill.style.width = pct + '%';
  xpPoints.textContent = `${GAME.xp} / ${GAME.maxXP} XP`;
  xpLevelName.textContent = GAME.levels[level].name;

  // Разблокируем значки
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

/* ---------- Состояние ---------- */
const variantKeys = Object.keys(LESSON_DATA.variants);
const variantKey  = variantKeys[Math.floor(Math.random()*variantKeys.length)];
const TASKS       = LESSON_DATA.variants[variantKey];
const totalMax    = TASKS.reduce((s,t)=>s+t.weight,0);
const state       = {};

/* ---------- Заголовки ---------- */
document.getElementById('title').textContent    = LESSON_DATA.title;
document.getElementById('subtitle').textContent = LESSON_DATA.subtitle;

/* ---------- Отображение ФИО ученика в тесте ---------- */
const nameDisplay = document.getElementById('studentNameDisplay');
if (nameDisplay && window.__student) {
  nameDisplay.textContent = window.__student.name + ' · ' + window.__student.class;
}
document.getElementById('variantBadge').textContent = `Вариант ${variantKey}`;

/* ---------- Цель и задачи ---------- */
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

/* ---------- Теория ---------- */
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

/* ---------- Интеллект-карта ---------- */
if (typeof renderMindMap === 'function') {
  renderMindMap(LESSON_DATA.mindmap, document.getElementById('mindmapBox'));
}

/* ---------- Вкладки ---------- */
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const t = tab.dataset.tab;

    document.getElementById('theorySection').classList.toggle('hidden',   t!=='theory');
    document.getElementById('mindmapSection').classList.toggle('hidden',  t!=='mindmap');
    document.getElementById('testSection').classList.toggle('hidden',     t!=='test');
    document.getElementById('finishCard').classList.toggle('hidden',      t!=='test');
    document.getElementById('homeworkSection').classList.toggle('hidden', t!=='homework');

    window.scrollTo({top:0,behavior:'smooth'});
  });
});

/* ---------- Конфетти ---------- */
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

/* ---------- Рендер заданий теста ---------- */
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

/* ---------- Проверка ответа теста ---------- */
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
     // ⬇️ ГЕЙМИФИКАЦИЯ: +XP за правильный ответ
    addXP(t.weight * 3);   // 1 балл = 3 XP, 2 балла = 6 XP, 3 балла = 9 XP
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

/* ---------- Итоговая оценка за тест + отправка ---------- */
document.getElementById('finish').addEventListener('click', function() {
  // 1. Защита от повторного нажатия
  const finishBtn = document.getElementById('finish');
  if (finishBtn.dataset.sent === '1') {
    alert('Результат уже отправлен.');
    return;
  }

  // 2. Проверка ФИО из localStorage
  const studentName = (window.__student && window.__student.name) || '';
  if (!studentName) {
    alert('Не найдены данные ученика. Войдите заново.');
    return;
  }

  // 3. Блокируем кнопку
  finishBtn.dataset.sent = '1';
  finishBtn.disabled = true;

  // 4. Считаем результат
  const got = Object.values(state).reduce((a, b) => a + b, 0);
  const pct = got / totalMax * 100;

  let g, comment;
  if (pct >= 85)      { g = 5; comment = 'Отлично! Материал усвоен.'; }
  else if (pct >= 65) { g = 4; comment = 'Хорошо! Повторите сложные задания.'; }
  else if (pct >= 45) { g = 3; comment = 'Удовлетворительно. Стоит повторить тему.'; }
  else                { g = 2; comment = 'Попробуйте пройти урок ещё раз.'; }

  // 5. Показываем оценку
  const box = document.getElementById('scoreBox');
  box.classList.remove('hidden');
  box.classList.add('pop-in');
  document.getElementById('finalScore').textContent =
    `Набрано ${got} из ${totalMax} баллов (${pct.toFixed(0)}%)`;
  const gradeEl = document.getElementById('finalGrade');
  gradeEl.textContent = g;
  gradeEl.classList.add('pop-in');
  document.getElementById('finalComment').textContent = comment;
     // ⬇️ ГЕЙМИФИКАЦИЯ: прогресс-кольцо
  const ringFill = document.getElementById('ringFill');
  const ringPercent = document.getElementById('ringPercent');
  if (ringFill && ringPercent) {
    const circumference = 283; // 2 * π * 45 ≈ 283
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

  // 6. Отправка в таблицу
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

/* ============================================================
   ДОМАШНЕЕ ЗАДАНИЕ (автопроверка)
   ============================================================ */
(function initHomework(){
  const hwData = LESSON_DATA.homework;
  if (!hwData || !hwData.length) return;

  const hwTasksEl = document.getElementById('homeworkTasks');
  if (!hwTasksEl) return;

  const hwState = {};
  const hwMax = hwData.length * 1;   // каждое задание = 1 балл

  /* ---------- Рендер заданий ДЗ ---------- */
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

  /* ---------- Проверка одного задания ДЗ ---------- */
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
       // ⬇️ ГЕЙМИФИКАЦИЯ: +XP за ДЗ
      addXP(4);   // 4 XP за каждое задание ДЗ
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

  /* ---------- Итог ДЗ + отправка ---------- */
  document.getElementById('hwFinish').addEventListener('click', function(){
    const btn = document.getElementById('hwFinish');

    // 1. Защита от повторного нажатия
    if (btn.dataset.sent === '1') {
      alert('Результат уже отправлен. Перезагрузите страницу, чтобы пройти заново.');
      return;
    }

    // 2. Считаем результат
    const got = Object.values(hwState).reduce((a, b) => a + b, 0);
    const pct = got / hwMax * 100;

    let g, comment;
    if (pct >= 85)      { g = 5; comment = 'Отлично! Домашнее задание выполнено верно.'; }
    else if (pct >= 65) { g = 4; comment = 'Хорошо! Немного повторите материал.'; }
    else if (pct >= 45) { g = 3; comment = 'Удовлетворительно. Стоит перечитать теорию.'; }
    else                { g = 2; comment = 'Попробуйте выполнить домашнее задание ещё раз.'; }

    // 3. Показываем оценку на экране
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

    // 4. Блокируем кнопку
    btn.dataset.sent = '1';
    btn.disabled = true;
    btn.textContent = 'Результат отправлен ✓';

    // 5. Отправка в Google Таблицу
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
})();   // ← ЗАКРЫВАЕТ initHomework — этой строки не хватало!
