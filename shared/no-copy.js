/* Практические работы: дополнительная защита образцов-картинок.
   Сам текст уже выведен изображением, поэтому обычный Ctrl+C на нём не работает.
   Этот файл дополнительно запрещает перетаскивание, контекстное меню и
   попытки выделить/скопировать картинку. Остальная страница (инструкции,
   пути, имена файлов, команды) остаётся обычным копируемым текстом. */
(function () {
  'use strict';

  function isSample(target) {
    return !!(target && target.closest && target.closest('.sample-image'));
  }

  function prevent(e) {
    if (!isSample(e.target)) return;
    e.preventDefault();
    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', '');
    }
  }

  document.addEventListener('copy', prevent, true);
  document.addEventListener('cut', prevent, true);
  document.addEventListener('selectstart', prevent, true);
  document.addEventListener('dragstart', prevent, true);
  document.addEventListener('contextmenu', prevent, true);
}());
