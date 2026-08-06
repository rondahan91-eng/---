// רכיבי ממשק משותפים: פס עליון, טוסט הודעות, עזרי DOM קטנים.
import { CONFIG } from './config.js';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function topbarHtml(session, subtitle) {
  const roleLabel = session.role === 'admin' ? 'מורה / ניהול' : 'תלמיד/ה';
  return `
  <div class="topbar">
    <div class="brand"><span>🩻</span> <span>${CONFIG.APP_NAME}</span>
      ${subtitle ? `<span style="color:var(--text-1);font-size:13px;font-weight:400;">— ${subtitle}</span>` : ''}
    </div>
    <div class="user-pill">
      <span><b>${escapeHtml(session.displayName || session.username)}</b> · ${roleLabel}</span>
      <button class="secondary" id="logout-btn" style="padding:6px 12px;font-size:12.5px;">התנתקות</button>
    </div>
  </div>`;
}

export function wireLogout(onLogout) {
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', onLogout);
}
