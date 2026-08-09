// ==========================================================================
// main.js - נקודת הכניסה: ניהול session וניתוב בין מסך התחברות / צ'אט / דשבורד.
// ==========================================================================
import { CONFIG } from './config.js';
import { renderLogin } from './auth.js';
import { logout as apiLogout } from './api.js';
import { mountStudentChat } from './studentChat.js';
import { mountTeacherDashboard } from './teacherDashboard.js';

const app = document.getElementById('app');

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(CONFIG.SESSION_KEY) || 'null'); }
  catch { return null; }
}
function saveSession(user) { sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(user)); }
function clearSession() { sessionStorage.removeItem(CONFIG.SESSION_KEY); }

function route() {
  const session = loadSession();
  if (!session) {
    renderLogin(app, (user) => { saveSession(user); route(); });
    return;
  }
  // מבטלים את הטוקן בשרת לפני שמוחקים אותו מקומית, כדי שלא יישאר תקף
  const onLogout = async () => { await apiLogout(); clearSession(); route(); };
  if (session.role === 'admin') mountTeacherDashboard(app, session, onLogout);
  else mountStudentChat(app, session, onLogout);
}

route();
