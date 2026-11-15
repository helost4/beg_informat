#!/usr/bin/env node
/* ============================================================
   Проверка тренажёра «Подготовка к экзаменам и ВПР»
   Запуск: node tools/validate-trainer.js
   Проверяет: наличие файлов уроков, по 10 задач в блоке,
   заполненные ответы и разборы, уникальные id, картинки, видео.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function runScript(rel, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read(rel), sandbox, { filename: rel });
  return sandbox.window[globalName];
}

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

const catalog = runScript('trainer/data/catalog.js', 'EXAM_CATALOG');
const videos = runScript('trainer/data/videos.js', 'TRAINER_VIDEOS') || {};

if (!catalog || !catalog.exams) {
  err('catalog.js: не найден window.EXAM_CATALOG');
  report();
}

const allTaskIds = new Map();
let lessons = 0;
let blocks = 0;
let tasks = 0;

catalog.order.forEach(function (examId) {
  const exam = catalog.exams[examId];
  if (!exam) { err('catalog.js: раздел "' + examId + '" отсутствует в exams'); return; }

  if (!Array.isArray(exam.classes) || !exam.classes.length) {
    err(examId + ': не указаны классы доступа');
  }

  exam.lessons.forEach(function (meta) {
    if (!meta.ready) return;
    lessons++;

    const num = String(meta.number).padStart(2, '0');
    const rel = 'trainer/data/' + examId + '/' + num + '.js';
    if (!fs.existsSync(path.join(ROOT, rel))) {
      err(rel + ': файл урока не найден (ready: true)');
      return;
    }

    let lesson;
    try {
      lesson = runScript(rel, 'TRAINER_LESSON');
    } catch (e) {
      err(rel + ': ошибка выполнения — ' + e.message);
      return;
    }

    if (!lesson) { err(rel + ': нет window.TRAINER_LESSON'); return; }
    if (!Array.isArray(lesson.blocks) || !lesson.blocks.length) {
      err(rel + ': нет блоков задач');
      return;
    }

    if (!lesson.theory || !lesson.theory.length) {
      warn(rel + ': нет теории');
    }

    if (lesson.blocks.length !== meta.blocks.length) {
      err(rel + ': блоков ' + lesson.blocks.length + ', в каталоге ' + meta.blocks.length);
    }

    lesson.blocks.forEach(function (block, bi) {
      blocks++;
      const where = rel + ' → блок ' + (bi + 1) + ' «' + block.title + '»';

      if (!block.title) err(where + ': нет названия блока');
      if (meta.blocks[bi] && meta.blocks[bi].title !== block.title) {
        warn(where + ': название не совпадает с каталогом («' + (meta.blocks[bi] || {}).title + '»)');
      }

      if (!Array.isArray(block.tasks)) {
        err(where + ': tasks не массив');
        return;
      }
      if (block.tasks.length !== 10) {
        err(where + ': задач ' + block.tasks.length + ', должно быть 10');
      }

      block.tasks.forEach(function (task, ti) {
        tasks++;
        const at = where + ' → задача ' + (ti + 1);

        ['id', 'q', 'answer', 'solution'].forEach(function (field) {
          if (typeof task[field] !== 'string' || !task[field].trim()) {
            err(at + ': пустое поле "' + field + '"');
          }
        });

        if (!task.id) return;
        if (allTaskIds.has(task.id)) {
          err(at + ': повторяется id "' + task.id + '" (уже есть в ' + allTaskIds.get(task.id) + ')');
        } else {
          allTaskIds.set(task.id, rel);
        }

        if (!/^[a-z0-9]+-\d+-b\d+-t\d+$/.test(task.id)) {
          warn(at + ': id не по шаблону «раздел-номер-bN-tN»: ' + task.id);
        }

        if (/Ответ\s*:/i.test(task.q)) {
          err(at + ': в условии остался фрагмент «Ответ:»');
        }
        if (/\.\.\/img\//.test(task.q)) {
          err(at + ': путь к картинке должен начинаться с img/');
        }

        const imgRe = /<img[^>]+src="([^"]+)"/g;
        let m;
        while ((m = imgRe.exec(task.q)) !== null) {
          const src = m[1];
          if (!/^img\//.test(src)) {
            warn(at + ': внешняя или нестандартная картинка ' + src);
            continue;
          }
          if (!fs.existsSync(path.join(ROOT, 'trainer', src))) {
            err(at + ': не найдена картинка trainer/' + src);
          }
        }

        if (task.source) {
          if (!task.source.url || !task.source.label) {
            warn(at + ': у source нет url или label');
          }
        }
      });
    });
  });
});

Object.keys(videos).forEach(function (id) {
  if (!allTaskIds.has(id)) {
    warn('videos.js: видео для неизвестной задачи "' + id + '"');
  }
  if (!/^https:\/\/rutube\.ru\//.test(videos[id])) {
    warn('videos.js: ссылка не на Rutube у "' + id + '"');
  }
});

function report() {
  console.log('');
  console.log('Тренажёр: уроков ' + lessons + ', блоков ' + blocks + ', задач ' + tasks + '.');
  if (warnings.length) {
    console.log('\nПредупреждения (' + warnings.length + '):');
    warnings.forEach(function (w) { console.log('  • ' + w); });
  }
  if (errors.length) {
    console.log('\nОшибки (' + errors.length + '):');
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    console.log('');
    process.exit(1);
  }
  console.log('\n✅ Ошибок нет.');
  process.exit(0);
}

report();
