/* ============================================================
   АВТОРИЗАЦИЯ И НАВИГАЦИЯ ДЛЯ СТРАНИЦ БЕЗ LESSON_DATA
   (практические работы, тренажёры и другие служебные страницы)

   Подключать на страницах, расположенных на один уровень
   вглубь от корня (например, 5-class/, ege-class/).
   ============================================================ */
(function initNavAndAuth() {
  const studentRaw = localStorage.getItem('student');
  let student = null;

  if (studentRaw) {
    try {
      student = JSON.parse(studentRaw);
    } catch (e) {
      student = null;
    }
  }

  if (!student || !student.name) {
    localStorage.removeItem('student');
    window.location.href = '../login.html';
    return;
  }

  window.__student = student;

  const nav = document.createElement('div');
  nav.className = 'floating-nav';

  const homeBtn = document.createElement('a');
  homeBtn.className = 'floating-btn home';
  homeBtn.href = '../lessons.html';
  homeBtn.innerHTML = '🏠 Главная';

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'floating-btn logout';
  logoutBtn.innerHTML = '🚪 Выйти';
  logoutBtn.onclick = function () {
    localStorage.removeItem('student');
    window.location.href = '../login.html';
  };

  nav.appendChild(homeBtn);
  nav.appendChild(logoutBtn);
  document.body.appendChild(nav);
})();
