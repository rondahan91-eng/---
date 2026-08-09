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

/**
 * סמל המערכת: מסגרת סורק דימות (viewfinder) עם קו דופק - רפואי-טכנולוגי.
 * uid מבדיל בין מופעים כדי שמזהי ה-gradient לא יתנגשו כששניים מוצגים יחד.
 */
let logoCounter = 0;
export function logoMark(size = 64) {
  const uid = 'lg' + (++logoCounter);
  const s = Number(size);
  return `
  <svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"
       xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AI Mentor">
    <defs>
      <linearGradient id="${uid}" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
        <stop stop-color="#22d3ee"/><stop offset="1" stop-color="#0d9488"/>
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#${uid})" opacity=".10"/>
    <rect x="3.9" y="3.9" width="56.2" height="56.2" rx="16.1" stroke="url(#${uid})" stroke-width="1.8"/>
    <g stroke="url(#${uid})" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M15 24v-5a4 4 0 0 1 4-4h5"/>
      <path d="M49 24v-5a4 4 0 0 0-4-4h-5"/>
      <path d="M15 40v5a4 4 0 0 0 4 4h5"/>
      <path d="M49 40v5a4 4 0 0 1-4 4h-5"/>
    </g>
    <path d="M16 32.5h6.5l3.2-7.4 5.6 14.6 4-8.2 2.4 3.4H48"
          stroke="url(#${uid})" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;
}

export function topbarHtml(session, subtitle) {
  const roleLabel = session.role === 'admin' ? 'מורה / ניהול' : 'תלמיד/ה';
  return `
  <div class="topbar">
    <div class="brand">${logoMark(28)} <span>${CONFIG.APP_NAME}</span>
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
