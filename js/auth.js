// מסך התחברות - פאנל מפוצל (אזור מיתוג + טופס).
// אין חיוב להחליף סיסמה בכניסה הראשונה: התלמיד/ה נשאר/ת עם הסיסמה שהמערכת
// גזרה מתאריך הלידה, והמורה עם סיסמת ברירת המחדל.
import { logoMark } from './ui.js';
import { authenticateUser, isDevMode } from './api.js';

function artPanel() {
  return `
  <div class="auth-art">
    <div class="auth-brand">${logoMark(34)} <span>AI Mentor · הנדסה ביו-רפואית</span></div>
    <div>
      <div class="auth-headline">מהצילום<br>אל האבחנה</div>
      <p class="auth-sub">ליווי שבועי אישי בפרויקט בניית מודל ה-AI שלך לזיהוי שברים —
        שאלות עומק על האנטומיה, הפיזיקה של הדימות ואסטרטגיית הנתונים שבחרת.</p>
    </div>
    <div class="auth-meta">
      <div><b>3</b>אסטרטגיות מחקר</div>
      <div><b>30%</b>מציון הבגרות</div>
      <div><b>1:1</b>ליווי שבועי</div>
    </div>
  </div>`;
}

export function renderLogin(app, onLoggedIn) {
  app.innerHTML = `
  <div class="auth">
    ${artPanel()}
    <div class="auth-form">
      <form class="auth-box" id="login-form">
        <h2>כניסה למערכת</h2>
        <p class="lede">התחברו עם הפרטים שקיבלתם ממורה המגמה.</p>
        <div class="login-error" id="login-error"></div>
        <div class="field">
          <label for="username">שם משתמש</label>
          <input type="text" id="username" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">סיסמה</label>
          <input type="password" id="password" autocomplete="current-password" required>
        </div>
        <button type="submit" id="login-btn">כניסה</button>
        ${isDevMode() ? `<div class="auth-hint"><b>מצב פיתוח מקומי</b> (ללא שרת מחובר)<br>
          מורה: <code>admin</code> / <code>admin123</code><br>
          תלמידה לדוגמה: <code>מיכל5678</code> / <code>140810</code></div>` : ''}
      </form>
    </div>
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
      onLoggedIn(user);
    } catch (e2) {
      err.textContent = e2.message || 'שגיאת התחברות';
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'כניסה';
    }
  });
}

