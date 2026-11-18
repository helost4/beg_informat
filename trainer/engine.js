/* ============================================================
   ДВИЖОК ТРЕНАЖЁРА ПОДГОТОВКИ К ЭКЗАМЕНАМ
   Работает на двух страницах:
     exam.html   — список уроков раздела (data-page="exam")
     lesson.html — урок: теория + блоки по 10 задач (data-page="lesson")
   ============================================================ */
(function () {
  'use strict';

  var CATALOG = window.EXAM_CATALOG || { order: [], exams: {} };
  var VIDEOS = window.TRAINER_VIDEOS || {};
  var student = window.__student || (window.Account && Account.currentStudent()) || null;
  var params = new URLSearchParams(window.location.search);
  var page = document.body.dataset.page;

  /* ---------------- Утилиты ---------------- */
  function $(id) { return document.getElementById(id); }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Широкие таблицы из условий задач прокручиваются по горизонтали,
     а не растягивают всю страницу на телефоне. */
  function wrapTables(host) {
    if (!host) return;
    var tables = host.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      if (table.parentNode && table.parentNode.classList &&
          table.parentNode.classList.contains('table-scroll')) continue;
      var box = document.createElement('div');
      box.className = 'table-scroll';
      table.parentNode.insertBefore(box, table);
      box.appendChild(table);
    }
  }

  function plural(n, one, few, many) {
    var d = Math.abs(n) % 100;
    var d1 = d % 10;
    if (d >= 11 && d <= 14) return many;
    if (d1 === 1) return one;
    if (d1 >= 2 && d1 <= 4) return few;
    return many;
  }

  function examById(id) {
    return CATALOG.exams[id] || null;
  }

  function isAllowed(exam) {
    if (!exam || !student) return false;
    var base = window.Account && Account.baseClass ? Account.baseClass(student.class) : student.class;
    return exam.classes.indexOf(base) !== -1;
  }

  function findLesson(exam, num) {
    for (var i = 0; i < exam.lessons.length; i++) {
      if (Number(exam.lessons[i].number) === Number(num)) return exam.lessons[i];
    }
    return null;
  }

  function lessonFile(examId, num) {
    var n = String(num);
    if (n.length < 2) n = '0' + n;
    return 'data/' + examId + '/' + n + '.js';
  }

  function setTitle(text) {
    document.title = text;
  }

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/\u00a0/g, ' ')
      .replace(/\u00ad/g, '')
      .replace(/ё/g, 'е')
      .replace(/[−–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s*,\s*/g, ',')
      .replace(/\s*;\s*/g, ';')
      .replace(/\.$/, '');
  }

  function isCorrect(value, task) {
    var user = normalize(value);
    if (!user) return false;
    var variants = [task.answer];
    if (Array.isArray(task.accept)) variants = variants.concat(task.accept);
    for (var i = 0; i < variants.length; i++) {
      if (normalize(variants[i]) === user) return true;
    }
    return false;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Не удалось загрузить файл данных: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function showFatal(message) {
    var wrap = document.querySelector('.trainer-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="error-card"><b>Не удалось открыть тренажёр.</b><br>' +
      esc(message) + '<br><br><a class="btn ghost" href="../lessons.html">← Вернуться к урокам</a></div>';
  }

  function guard(exam) {
    if (!exam) {
      showFatal('Раздел не найден. Проверьте ссылку.');
      return false;
    }
    if (!student) {
      window.location.href = '../login.html';
      return false;
    }
    if (!isAllowed(exam)) {
      showFatal('Раздел «' + exam.title + '» доступен ученикам ' +
        exam.classes.join(', ') + '. Вы вошли как ' + (student.class || 'класс не указан') + '.');
      return false;
    }
    return true;
  }

  /* ============================================================
     РЕЗУЛЬТАТЫ: лучший результат по каждому блоку
     variant = EXAM-ID-N-BK   (например, OGE-1-B1)
     ============================================================ */
  function bestByVariant(results) {
    var best = {};
    (results || []).forEach(function (row) {
      if (String(row.workType) !== 'exam-task') return;
      var m = /^([A-Z0-9]+)-(\d+)-B(\d+)$/.exec(String(row.variant || ''));
      if (!m) return;
      var key = m[1] + '-' + m[2] + '-B' + m[3];
      var score = Number(row.score) || 0;
      var max = Number(row.maxScore) || 0;
      if (!max) return;
      var prev = best[key];
      if (!prev || score > prev.score) best[key] = { score: score, max: max };
    });
    return best;
  }

  function loadBest() {
    if (!window.Account || !Account.isLoggedIn()) return Promise.resolve({});
    return Account.getMyResults()
      .then(function (rows) { return bestByVariant(rows); })
      .catch(function () { return {}; });
  }

  function lessonBest(best, examId, num) {
    var prefix = examId.toUpperCase() + '-' + num + '-B';
    var done = 0, score = 0, max = 0;
    Object.keys(best).forEach(function (key) {
      if (key.indexOf(prefix) !== 0) return;
      done++;
      score += best[key].score;
      max += best[key].max;
    });
    return { done: done, score: score, max: max };
  }

  /* ============================================================
     СТРАНИЦА РАЗДЕЛА (exam.html)
     ============================================================ */
  function initExamPage() {
    var exam = examById(params.get('exam') || '');
    if (!guard(exam)) return;

    setTitle(exam.title + ' · Подготовка к экзаменам');
    var hero = document.querySelector('.exam-hero');
    if (!hero) return;

    var readyLessons = exam.lessons.filter(function (l) { return l.ready; });
    var totalBlocks = 0;
    exam.lessons.forEach(function (l) { totalBlocks += (l.blocks || []).length; });

    hero.innerHTML =
      '<div class="exam-badge ' + esc(exam.id) + '">' + esc(exam.short) + '</div>' +
      '<h1>' + esc(exam.title) + '</h1>' +
      '<p class="sub">' + esc(exam.subtitle) + '</p>' +
      '<div class="exam-legend">' +
        '<span class="legend-item">📚 <b>' + exam.lessons.length + '</b> ' +
          plural(exam.lessons.length, 'задание', 'задания', 'заданий') + '</span>' +
        '<span class="legend-item">✅ <b>' + readyLessons.length + '</b> готово</span>' +
        '<span class="legend-item">🧩 <b>' + totalBlocks + '</b> ' +
          plural(totalBlocks, 'блок', 'блока', 'блоков') + ' по 10 задач</span>' +
        '<span class="legend-item">🏫 ' + esc(exam.classes.join(' · ')) + '</span>' +
      '</div>';

    var listEl = $('examList');
    if (!listEl) return;
    listEl.innerHTML = '';

    var tools = document.createElement('div');
    tools.className = 'exam-tools';
    tools.innerHTML =
      '<a class="btn ghost" href="../lessons.html">← Все уроки</a>' +
      '<span class="muted">Источник заданий: <a href="' + esc(exam.source.url) +
      '" target="_blank" rel="noopener">' + esc(exam.source.label) + '</a></span>';
    listEl.parentNode.insertBefore(tools, listEl);

    renderLessonCards(exam, {}, false);
    loadBest().then(function (best) {
      renderLessonCards(exam, best, true);
    });
  }

  function renderLessonCards(exam, best, withProgress) {
    var listEl = $('examList');
    if (!listEl) return;
    listEl.innerHTML = '';

    exam.lessons.forEach(function (lesson) {
      var blocks = lesson.blocks || [];
      var info = lessonBest(best, exam.id, lesson.number);
      var isDone = info.done > 0 && info.max > 0;
      var card;

      if (lesson.ready) {
        card = document.createElement('a');
        card.className = 'lesson-card-x' + (isDone ? ' done' : '');
        card.href = 'lesson.html?exam=' + encodeURIComponent(exam.id) + '&task=' + lesson.number;
      } else {
        card = document.createElement('div');
        card.className = 'lesson-card-x disabled';
      }

      var meta = blocks.length
        ? blocks.length + ' ' + plural(blocks.length, 'блок', 'блока', 'блоков') +
          ' · ' + (blocks.length * 10) + ' задач'
        : 'готовится';

      var state;
      if (!lesson.ready) {
        state = '<span class="lc-state todo">⏳ скоро</span>';
      } else if (isDone) {
        state = '<span class="lc-state done">✓ ' +
          Account.percent(info.score, info.max) + '%</span>';
      } else if (withProgress) {
        state = '<span class="lc-state todo">не начато</span>';
      } else {
        state = '';
      }

      card.innerHTML =
        '<div class="lc-num">' + lesson.number + '</div>' +
        '<div class="lc-body">' +
          '<div class="lc-title">Задание ' + lesson.number + '. ' + esc(lesson.title) + '</div>' +
          '<div class="lc-meta"><span>' + esc(meta) + '</span></div>' +
        '</div>' + state;

      listEl.appendChild(card);
    });
  }

  /* ============================================================
     СТРАНИЦА УРОКА (lesson.html)
     ============================================================ */
  function initLessonPage() {
    var exam = examById(params.get('exam') || '');
    var num = Number(params.get('task') || 0);
    if (!guard(exam)) return;

    var meta = findLesson(exam, num);
    if (!meta) {
      showFatal('Задание №' + num + ' не найдено в разделе «' + exam.title + '».');
      return;
    }

    setTitle(exam.short + ' · Задание ' + num + ' · Тренажёр');
    var badge = $('examBadge');
    if (badge) {
      badge.textContent = exam.short;
      badge.className = 'exam-badge ' + exam.id;
    }
    var titleEl = $('lessonTitle');
    if (titleEl) titleEl.textContent = 'Задание ' + num + '. ' + meta.title;
    var subEl = $('lessonSub');
    if (subEl) subEl.textContent = exam.title + ' · ' + exam.subtitle;
    var studentEl = $('studentNameDisplay');
    if (studentEl) studentEl.textContent = (student.name || 'Ученик') + ' · ' + (student.class || '');

    var links = document.querySelectorAll('a[data-back-exam]');
    for (var i = 0; i < links.length; i++) {
      links[i].href = 'exam.html?exam=' + encodeURIComponent(exam.id);
    }

    loadScript(lessonFile(exam.id, num)).then(function () {
      var data = window.TRAINER_LESSON;
      if (!data || !Array.isArray(data.blocks) || !data.blocks.length) {
        throw new Error('Файл урока пуст или имеет неверный формат.');
      }
      renderLesson(exam, num, data);
    }).catch(function (err) {
      showFatal(err && err.message ? err.message : 'Ошибка загрузки урока.');
    });
  }

  /* ---------------- Состояние прохождения ---------------- */
  var storeKey = '';
  var state = null;

  function readState() {
    try {
      var raw = sessionStorage.getItem(storeKey);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeState() {
    try { sessionStorage.setItem(storeKey, JSON.stringify(state.answers)); } catch (e) { /* ignore */ }
  }

  function blockStateKey(blockIndex) {
    return 'b' + blockIndex;
  }

  function getTaskState(blockIndex, taskId) {
    var b = state.answers[blockStateKey(blockIndex)];
    return (b && b[taskId]) || null;
  }

  function setTaskState(blockIndex, taskId, value) {
    var key = blockStateKey(blockIndex);
    if (!state.answers[key]) state.answers[key] = {};
    state.answers[key][taskId] = value;
    writeState();
  }

  /* ---------------- Рендер урока ---------------- */
  function renderLesson(exam, num, data) {
    storeKey = 'trainer_' + exam.id + '_' + num;
    state = {
      exam: exam,
      num: num,
      data: data,
      blockIndex: 0,
      answers: readState(),
      saved: {},
      best: {}
    };

    $('lessonLoading').classList.add('hidden');
    $('lessonContent').classList.remove('hidden');

    var totalTasks = data.blocks.reduce(function (sum, b) {
      return sum + (b.tasks ? b.tasks.length : 0);
    }, 0);
    var totalBlocks = data.blocks.length;

    var metaEl = $('lessonMeta');
    if (metaEl) {
      metaEl.innerHTML =
        '<span class="meta-chip">🧩 <b>' + totalBlocks + '</b> ' +
          plural(totalBlocks, 'блок', 'блока', 'блоков') + '</span>' +
        '<span class="meta-chip">📝 <b>' + totalTasks + '</b> ' +
          plural(totalTasks, 'задача', 'задачи', 'задач') + '</span>' +
        '<span class="meta-chip">🏫 ' + esc(exam.classes.join(' · ')) + '</span>';
    }

    var countEl = $('tasksTabCount');
    if (countEl) countEl.textContent = totalTasks;

    renderTheory(data);
    renderBlocks(data);

    var tabs = document.querySelectorAll('.trainer-tabs .tab');
    function activateTab(name, scroll) {
      for (var j = 0; j < tabs.length; j++) {
        tabs[j].classList.toggle('active', tabs[j].dataset.tab === name);
      }
      $('theoryTab').classList.toggle('hidden', name !== 'theory');
      $('tasksTab').classList.toggle('hidden', name !== 'tasks');
      if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        activateTab(this.dataset.tab, true);
      });
    }

    /* Прямая ссылка на блок задач: lesson.html?...&tab=tasks или #tasks */
    var wantedTab = '';
    try {
      wantedTab = new URLSearchParams(window.location.search).get('tab') || '';
    } catch (e) { wantedTab = ''; }
    if (wantedTab === 'tasks' || window.location.hash === '#tasks') {
      activateTab('tasks', false);
    }

    loadBest().then(function (best) {
      state.best = best;
      updateBlockChips();
      updateBlockProgress();
    });
  }

  /* ---------------- Теория ---------------- */
  function renderTheory(data) {
    var host = $('theoryTab');
    if (!host) return;
    host.innerHTML = '';

    if (data.intro) {
      var lead = document.createElement('div');
      lead.className = 'theory-lead';
      lead.innerHTML = data.intro;
      host.appendChild(lead);
    }

    (data.theory || []).forEach(function (section) {
      var block = document.createElement('div');
      block.className = 'theory-block';
      block.innerHTML =
        (section.title ? '<h3>' + esc(section.title) + '</h3>' : '') +
        (section.html || '');
      wrapTables(block);
      host.appendChild(block);
    });

    if (!data.theory || !data.theory.length) {
      var empty = document.createElement('div');
      empty.className = 'theory-block';
      empty.innerHTML = '<p>Теория для этого задания пока готовится. Можно сразу перейти к задачам.</p>';
      host.appendChild(empty);
    }

    var links = [];
    (data.sources || []).forEach(function (s) { links.push(s); });
    if (data.examSource) links.push(data.examSource);

    if (links.length) {
      var box = document.createElement('div');
      box.className = 'sources-box';
      box.innerHTML = '<h3>🔗 Где ещё потренироваться</h3><div class="source-links">' +
        links.map(function (s) {
          return '<a class="source-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
            esc(s.label) + ' ↗</a>';
        }).join('') + '</div>';
      host.appendChild(box);
    }
  }

  /* ---------------- Блоки задач ---------------- */
  function renderBlocks(data) {
    var chips = $('blockChips');
    chips.innerHTML = '';
    if (data.blocks.length > 1) {
      data.blocks.forEach(function (block, index) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'block-chip';
        chip.dataset.index = index;
        chip.innerHTML =
          '<span class="chip-num">' + (index + 1) + '</span>' +
          '<span><span class="chip-title">' + esc(block.title) + '</span><br>' +
          '<span class="chip-status"></span></span>';
        chip.addEventListener('click', function () {
          state.blockIndex = index;
          renderBlock(data, index);
          updateBlockChips();
        });
        chips.appendChild(chip);
      });
    } else {
      chips.classList.add('hidden');
    }
    renderBlock(data, 0);
    updateBlockChips();
  }

  function blockTasks(block) {
    return Array.isArray(block.tasks) ? block.tasks : [];
  }

  function blockStats(blockIndex) {
    var block = state.data.blocks[blockIndex];
    var tasks = blockTasks(block);
    var done = 0, correct = 0;
    tasks.forEach(function (task, i) {
      var ts = getTaskState(blockIndex, task.id || ('t' + (i + 1)));
      if (ts && ts.locked) {
        done++;
        if (ts.correct) correct++;
      }
    });
    return { done: done, correct: correct, total: tasks.length };
  }

  function blockBest(blockIndex) {
    var variant = variantId(blockIndex);
    return state.best[variant] || null;
  }

  function variantId(blockIndex) {
    return state.exam.id.toUpperCase() + '-' + state.num + '-B' + (blockIndex + 1);
  }

  function updateBlockChips() {
    var chips = document.querySelectorAll('.block-chip');
    for (var i = 0; i < chips.length; i++) {
      var idx = Number(chips[i].dataset.index);
      var stats = blockStats(idx);
      chips[i].classList.toggle('active', idx === state.blockIndex);
      chips[i].classList.toggle('done', stats.total > 0 && stats.done === stats.total);
      var status = chips[i].querySelector('.chip-status');
      if (status) {
        status.textContent = stats.done
          ? 'решено ' + stats.done + ' из ' + stats.total
          : stats.total + ' задач';
      }
    }
  }

  function updateBlockProgress() {
    var stats = blockStats(state.blockIndex);
    var el = $('blockProgress');
    if (el) {
      var text = 'Решено <b>' + stats.done + '</b> из ' + stats.total;
      if (stats.done) text += ' · верно <b>' + stats.correct + '</b>';
      var best = blockBest(state.blockIndex);
      if (best) text += ' · лучший ' + Account.percent(best.score, best.max) + '%';
      el.innerHTML = text;
    }
    var bar = $('blockBar');
    if (bar) bar.style.width = (stats.total ? stats.done / stats.total * 100 : 0) + '%';
  }

  function renderBlock(data, blockIndex) {
    var block = data.blocks[blockIndex];
    var host = $('blockHost');
    if (!host || !block) return;

    var stats = blockStats(blockIndex);
    var total = blockTasks(block).length;
    var best = blockBest(blockIndex);

    host.innerHTML = '';
    var panel = document.createElement('div');
    panel.className = 'block-panel';

    var head = document.createElement('div');
    head.className = 'block-head';
    head.innerHTML =
      '<h2>🧩 ' + esc(block.title) + '</h2>' +
      '<div class="block-progress" id="blockProgress">Решено <b>' + stats.done + '</b> из ' + total +
        (stats.done ? ' · верно <b>' + stats.correct + '</b>' : '') +
        (best ? ' · лучший ' + Account.percent(best.score, best.max) + '%' : '') +
      '</div>';
    panel.appendChild(head);

    var bar = document.createElement('div');
    bar.className = 'block-bar';
    bar.innerHTML = '<div id="blockBar" style="width:' +
      (total ? stats.done / total * 100 : 0) + '%"></div>';
    panel.appendChild(bar);

    var hint = document.createElement('p');
    hint.className = 'block-hint';
    hint.textContent = 'Задачи идут от простой к сложной. Введите ответ и нажмите «Проверить». ' +
      'Если не получается — откройте подсказку или разбор.';
    panel.appendChild(hint);

    blockTasks(block).forEach(function (task, index) {
      panel.appendChild(buildTaskCard(blockIndex, block, task, index));
    });

    var summary = document.createElement('div');
    summary.className = 'lesson-summary hidden';
    summary.id = 'blockSummary';
    panel.appendChild(summary);

    host.appendChild(panel);
    updateBlockProgress();
    updateSummary(blockIndex);
  }

  function difficulty(index) {
    if (index < 3) return { level: 1, label: 'разминка' };
    if (index < 7) return { level: 2, label: 'средний уровень' };
    return { level: 3, label: 'сложный уровень' };
  }

  function buildTaskCard(blockIndex, block, task, index) {
    var taskId = task.id || ('t' + (index + 1));
    var diff = difficulty(index);
    var saved = getTaskState(blockIndex, taskId);

    var card = document.createElement('div');
    card.className = 'task-card';
    card.id = 'task-' + blockIndex + '-' + taskId;
    card.dataset.taskId = taskId;

    if (saved && saved.locked) {
      card.classList.add(saved.correct && !saved.firstWrong ? 'solved' : 'wrong');
    }

    var dots = '';
    for (var d = 1; d <= 3; d++) {
      dots += '<i class="' + (d <= diff.level ? 'on' : '') + '"></i>';
    }

    card.innerHTML =
      '<div class="task-top">' +
        '<div class="task-num">' + (index + 1) + '</div>' +
        '<div class="diff">' + dots + '</div>' +
        '<span class="diff-label">' + diff.label + '</span>' +
      '</div>' +
      '<div class="task-q">' + (task.q || '') + '</div>' +
      '<div class="answer-row">' +
        '<input class="answer-input" type="text" autocomplete="off" ' +
          'placeholder="Введите ответ" aria-label="Ответ к задаче ' + (index + 1) + '">' +
        '<button class="btn-check" type="button">Проверить</button>' +
      '</div>' +
      '<div class="task-feedback hidden"></div>' +
      '<div class="task-actions"></div>' +
      '<div class="task-hint hidden"></div>' +
      '<div class="task-solution hidden"></div>' +
      videoSlot(taskId) +
      (task.source ? '<div class="task-source">Источник: <a href="' + esc(task.source.url) +
        '" target="_blank" rel="noopener">' + esc(task.source.label || 'задание') + '</a></div>' : '');

    var input = card.querySelector('.answer-input');
    var button = card.querySelector('.btn-check');
    var feedback = card.querySelector('.task-feedback');
    var actions = card.querySelector('.task-actions');
    var hintEl = card.querySelector('.task-hint');
    var solutionEl = card.querySelector('.task-solution');
    wrapTables(card.querySelector('.task-q'));

    /* Подсказка */
    if (task.hint) {
      var hintBtn = document.createElement('button');
      hintBtn.type = 'button';
      hintBtn.className = 'btn-soft';
      hintBtn.textContent = '💡 Подсказка';
      hintEl.innerHTML = task.hint;
      hintBtn.addEventListener('click', function () {
        hintEl.classList.toggle('hidden');
        hintBtn.textContent = hintEl.classList.contains('hidden') ? '💡 Подсказка' : '🙈 Скрыть подсказку';
      });
      actions.appendChild(hintBtn);
    }

    /* Разбор */
    var solution = task.solution || '';
    if (solution) {
      var solBtn = document.createElement('button');
      solBtn.type = 'button';
      solBtn.className = 'btn-soft';
      solBtn.textContent = '📖 Показать разбор';
      solutionEl.innerHTML = solution;
      solBtn.addEventListener('click', function () {
        solutionEl.classList.toggle('hidden');
        solBtn.textContent = solutionEl.classList.contains('hidden') ? '📖 Показать разбор' : '🙈 Скрыть разбор';
      });
      actions.appendChild(solBtn);
    }

    /* Восстановление состояния */
    if (saved) {
      input.value = saved.value || '';
      if (saved.locked) {
        input.disabled = true;
        button.disabled = true;
        renderFeedback(card, feedback, saved, task);
        if (!saved.correct) solutionEl.classList.remove('hidden');
      }
    }

    function check() {
      if (button.disabled) return;
      var value = input.value;
      if (!normalize(value)) {
        input.focus();
        return;
      }
      var ts = getTaskState(blockIndex, taskId) || { attempts: 0, firstWrong: false };
      var ok = isCorrect(value, task);
      ts.attempts = (ts.attempts || 0) + 1;
      ts.value = value;

      if (ok) {
        ts.correct = true;
        ts.locked = true;
      } else if (!ts.firstWrong) {
        ts.firstWrong = true;
      }
      if (!ok && ts.attempts >= 2) ts.locked = true;

      setTaskState(blockIndex, taskId, ts);
      card.classList.toggle('solved', !!ts.correct);
      card.classList.toggle('wrong', !!ts.locked && !ts.correct);

      if (ts.correct) {
        input.disabled = true;
        button.disabled = true;
      }
      if (ts.locked) {
        input.disabled = true;
        button.disabled = true;
      }

      renderFeedback(card, feedback, ts, task);
      if (ts.locked && !ts.correct) solutionEl.classList.remove('hidden');
      if (!ts.locked && !ts.correct && task.hint) hintEl.classList.remove('hidden');

      updateBlockProgress();
      updateBlockChips();
      updateSummary(blockIndex);
      if (ts.locked) maybeSave(blockIndex);
    }

    button.addEventListener('click', check);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        check();
      }
    });

    return card;
  }

  function renderFeedback(card, el, ts, task) {
    el.classList.remove('hidden', 'ok', 'bad');
    if (ts.correct) {
      el.classList.add('ok');
      el.innerHTML = '✅ Верно!' + (ts.firstWrong ? ' <span class="expected">(со второй попытки)</span>' : '');
    } else if (ts.locked) {
      el.classList.add('bad');
      el.innerHTML = '❌ Неверно. <span class="expected">Правильный ответ: <b>' +
        esc(task.answer) + '</b></span>';
    } else {
      el.classList.add('bad');
      el.innerHTML = '❌ Пока неверно. Попробуйте ещё раз — или откройте подсказку и разбор.';
    }
  }

  function videoSlot(taskId) {
    var url = VIDEOS[taskId];
    if (!url) {
      return '<div class="task-video">🎬 <b>Видеоразбор</b> этой задачи скоро появится. ' +
        'Пока можно посмотреть пошаговое решение кнопкой «Показать разбор».</div>';
    }
    return '<div class="task-video ready">' +
      '<div class="video-title"><span>🎬 Видеоразбор</span>' +
        '<a href="' + esc(url) + '" target="_blank" rel="noopener">Открыть на Rutube ↗</a></div>' +
      '<div class="video-frame"><iframe src="' + esc(url) + '" loading="lazy" ' +
        'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Видеоразбор задачи"></iframe></div>' +
      '</div>';
  }

  function updateSummary(blockIndex) {
    var summary = $('blockSummary');
    if (!summary) return;
    var stats = blockStats(blockIndex);
    if (!stats.total || stats.done < stats.total) {
      summary.classList.add('hidden');
      return;
    }
    summary.classList.remove('hidden');
    var pct = Math.round(stats.correct / stats.total * 100);
    var grade = Account.gradeFor ? Account.gradeFor(pct) : '';
    summary.innerHTML =
      '<h3>Блок пройден!</h3>' +
      '<div>Верных ответов: <b>' + stats.correct + ' из ' + stats.total + '</b> (' + pct + '%)' +
      (grade ? ' · оценка <b>' + grade + '</b>' : '') + '.</div>' +
      '<div style="margin-top:6px;">Можно перейти к другому блоку или вернуться к списку заданий.</div>';
  }

  /* ---------------- Сохранение результата ---------------- */
  function maybeSave(blockIndex) {
    if (state.saved[blockIndex]) return;
    var stats = blockStats(blockIndex);
    if (!stats.total || stats.done < stats.total) return;
    state.saved[blockIndex] = true;

    if (!window.Account || !Account.isLoggedIn()) return;

    var block = state.data.blocks[blockIndex];
    var pct = Math.round(stats.correct / stats.total * 100);
    var payload = {
      clientId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
      studentName: student.name || 'Аноним',
      className: student.class || '',
      lesson: state.exam.short + ' · Задание ' + state.num + ' · ' + block.title,
      variant: variantId(blockIndex),
      score: stats.correct,
      maxScore: stats.total,
      grade: Account.gradeFor ? Account.gradeFor(pct) : pct,
      workType: 'exam-task'
    };

    Account.saveResult(payload).catch(function () {
      /* результат останется в очереди аккаунта и отправится позже */
    });
  }

  /* ============================================================
     ГЛАВНАЯ СТРАНИЦА ТРЕНАЖЁРА (index.html)
     ============================================================ */
  function initIndexPage() {
    setTitle('Подготовка к экзаменам и ВПР · Тренажёр');
    var host = $('examIndex');
    if (!host) return;

    host.innerHTML = '';
    CATALOG.order.forEach(function (id) {
      var exam = examById(id);
      if (!exam) return;

      var allowed = isAllowed(exam);
      var ready = exam.lessons.filter(function (l) { return l.ready; }).length;
      var total = exam.lessons.length;
      var card = document.createElement(allowed ? 'a' : 'div');

      card.className = 'exam-card ' + exam.id + (allowed ? '' : ' locked');
      if (allowed) {
        card.href = 'exam.html?exam=' + encodeURIComponent(exam.id);
      }

      card.innerHTML =
        '<div class="ec-icon">' + esc(exam.icon) + '</div>' +
        '<div class="ec-body">' +
          '<div class="ec-title">' + esc(exam.title) + '</div>' +
          '<div class="ec-sub">' + esc(exam.subtitle) + '</div>' +
          '<div class="ec-meta">' +
            '<span>' + total + ' ' + plural(total, 'задание', 'задания', 'заданий') + '</span>' +
            '<span>✅ ' + ready + ' готово</span>' +
            '<span>🏫 ' + esc(exam.classes.join(' · ')) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ec-state">' +
          (allowed ? '<span class="ec-open">Открыть →</span>'
                   : '<span class="ec-lock">🔒 только ' + esc(exam.classes.join(', ')) + '</span>') +
        '</div>';

      host.appendChild(card);
    });
  }

  /* ============================================================
     СТАРТ
     ============================================================ */
  if (page === 'index') initIndexPage();
  else if (page === 'exam') initExamPage();
  else if (page === 'lesson') initLessonPage();
})();
