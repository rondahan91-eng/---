// מסך התחברות - שם משתמש + סיסמה, כולל חיוב החלפת סיסמה בכניסה ראשונה (FR-A3).
import { CONFIG } from './config.js';
import { authenticateUser, changePassword, isDevMode } from './api.js';

export function renderLogin(app, onLoggedIn) {
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card glass" id="login-form">
      <div class="login-logo">🩻</div>
      <h1>${CONFIG.APP_NAME}</h1>
      <p class="sub">AI Mentor - ליווי שבועי אישי</p>
      <div class="login-error" id="login-error"></div>
      <div class="field" style="text-align:right;">
        <label for="username">שם משתמש</label>
        <input type="text" id="username" autocomplete="username" required>
      </div>
      <div class="field" style="text-align:right;">
        <label for="password">סיסמה</label>
        <input type="password" id="password" autocomplete="current-password" required>
      </div>
      <button type="submit" id="login-btn" style="width:100%;">כניסה 🔒</button>
      ${isDevMode() ? `<div class="form-note">מצב פיתוח מקומי (ללא שרת מחובר)<br>מורה: admin / admin123 · תלמידה לדוגמה: מיכל5678 / 140810</div>` : ''}
    </form>
  </div>`;

  const form = document.getElementById('login-form');
  const err = document.getElementById('login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('show');
    const btn = document.getElementById('login-btn');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!username || !password) return;
    btn.disabled = true;
    btn.textContent = 'מתחבר...';
    try {
      const user = await authenticateUser(username, password);
      if (user.mustChangePassword) {
        renderForcedPasswordChange(app, user, onLoggedIn);
      } else {
        onLoggedIn(user);
      }
    } catch (e2) {
      err.textContent = e2.message || 'שגיאת התחברות';
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'כניסה 🔒';
    }
  });
}

function renderForcedPasswordChange(app, user, onLoggedIn) {
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card glass" id="pw-form">
      <div class="login-logo">🔑</div>
      <h1>החלפת סיסמה</h1>
      <p class="sub">זו כניסתך הראשונה - יש לבחור סיסמה אישית חדשה לפני שממשיכים.</p>
      <div class="login-error" id="pw-error"></div>
      <div class="field" style="text-align:right;">
        <label for="new-password">סיסמה חדשה</label>
        <input type="password" id="new-password" autocomplete="new-password" required minlength="4">
      </div>
      <div class="field" style="text-align:right;">
        <label for="new-password-confirm">אימות סיסמה</label>
        <input type="password" id="new-password-confirm" autocomplete="new-password" required minlength="4">
      </div>
      <button type="submit" style="width:100%;">שמירה והמשך</button>
    </form>
  </div>`;

  const form = document.getElementById('pw-form');
  const err = document.getElementById('pw-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('show');
    const p1 = document.getElementById('new-password').value;
    const p2 = document.getElementById('new-password-confirm').value;
    if (p1 !== p2) {
      err.textContent = 'הסיסמאות אינן תואמות';
      err.classList.add('show');
      return;
    }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await changePassword(user.studentId, p1);
      onLoggedIn(Object.assign({}, user, { mustChangePassword: false }));
    } catch (e2) {
      err.textContent = e2.message || 'שגיאה בעדכון הסיסמה';
      err.classList.add('show');
      btn.disabled = false;
    }
  });
}
