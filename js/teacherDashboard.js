// ==========================================================================
// teacherDashboard.js - פאנל ניהול: ייבוא תלמידים, נושא שבועי, מעקב ציונים,
// צפייה בתמלולים, דריסת ציון, ייצוא (FR-C).
// ==========================================================================
import { escapeHtml, toast, topbarHtml, wireLogout } from './ui.js';
import {
  getDashboard, getCurrentWeek, startNewWeek, updateCurrentWeekTopic,
  getStudentTranscripts, setManualGrade, exportWeeklyReport, importRoster, resetStudentPassword,
} from './api.js';
import { parseStudentsExcel } from './excelImport.js';

export async function mountTeacherDashboard(app, session, onLogout) {
  const state = { students: [], week: { weekNumber: 0, topicText: '' }, selectedStudentId: null, transcripts: null, importPreview: null };
  await refresh();

  async function refresh() {
    const [students, week] = await Promise.all([getDashboard(), getCurrentWeek()]);
    state.students = students;
    state.week = week;
    render();
  }

  function render() {
    app.innerHTML = `
      ${topbarHtml(session, 'פאנל ניהול')}
      <div class="dash-wrap">
        <div class="dash-grid">
          <div>
            <div class="panel glass">
              <h3>👥 תלמידים (${state.students.length})</h3>
              <div class="table-scroll">
                <table class="data-table">
                  <thead><tr>
                    <th>שם</th><th>קבוצה</th><th>איבר</th><th>אסטרטגיה</th>
                    <th>שבועות</th><th>ציון Mentor</th><th>השבוע</th><th></th>
                  </tr></thead>
                  <tbody>
                    ${state.students.map(s => `
                      <tr>
                        <td>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName || '')}</td>
                        <td>${escapeHtml(s.group || '—')}</td>
                        <td>${escapeHtml(s.bodyPart || '—')}</td>
                        <td>${escapeHtml(s.strategy || '—')}</td>
                        <td>${s.weeksCompleted}</td>
                        <td>${s.mentorGrade}${s.surplusPoints > 0 ? ` <span class="pill ok">+${s.surplusPoints.toFixed(1)} בונוס</span>` : ''}</td>
                        <td>${s.doneThisWeek ? '<span class="pill ok">בוצע</span>' : '<span class="pill bad">חסר</span>'}</td>
                        <td style="white-space:nowrap;">
                          <button class="secondary view-student-btn" data-id="${s.studentId}" style="padding:5px 10px;font-size:12px;">תמלולים</button>
                          <button class="secondary reset-pw-btn" data-id="${s.studentId}" data-name="${escapeHtml(s.firstName)}" style="padding:5px 10px;font-size:12px;">🔑</button>
                        </td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            ${state.selectedStudentId ? renderStudentDetail() : ''}
          </div>

          <div>
            <div class="panel glass">
              <h3>🗓️ נושא שבועי נוכחי</h3>
              <p class="form-note" style="margin-top:0;">שבוע ${state.week.weekNumber}${state.week.topicText ? ' · ' + escapeHtml(state.week.topicText) : ' · טרם הוזן נושא'}</p>
              <div class="field"><textarea id="topic-input" rows="2" placeholder="נושא השיעור השבועי...">${escapeHtml(state.week.topicText || '')}</textarea></div>
              <div style="display:flex;gap:8px;">
                <button type="button" id="update-topic-btn" class="secondary" style="flex:1;">עדכון נושא לשבוע הנוכחי</button>
                <button type="button" id="new-week-btn" style="flex:1;">שבוע חדש ▶</button>
              </div>
            </div>

            <div class="panel glass">
              <h3>📥 ייבוא תלמידים מקובץ Excel</h3>
              <p class="form-note" style="margin-top:0;">עמודות נדרשות: שם פרטי, שם משפחה, תעודת זהות מלאה, תאריך לידה, קבוצה, איבר התמחות קבוצתי, אסטרטגיית מודל.
                שם משתמש ייגזר משם פרטי + 4 ספרות אחרונות של ת"ז, וסיסמה ראשונית מתאריך הלידה. ת"ז המלאה לא עוזבת את הדפדפן.</p>
              <div class="field"><input type="file" id="excel-file-input" accept=".xlsx,.xls"></div>
              <button type="button" id="parse-excel-btn" class="secondary" style="width:100%;">ניתוח קובץ</button>
              ${renderImportPreview()}
            </div>

            <div class="panel glass">
              <h3>📤 ייצוא נתונים</h3>
              <p class="form-note" style="margin-top:0;">דוח Excel (גיליון לכל תלמיד) נשמר אוטומטית מדי שבוע ל-Drive. אפשר גם להריץ ידנית עכשיו.</p>
              <button type="button" id="export-btn" class="secondary" style="width:100%;">ייצוא עכשיו</button>
            </div>
          </div>
        </div>
      </div>
      <div id="toast" class="toast"></div>`;
    wireLogout(onLogout);
    wireActions();
  }

  function renderImportPreview() {
    if (!state.importPreview) return '';
    const { valid, invalid } = state.importPreview;
    return `
      <div style="margin-top:12px;">
        ${valid.length ? `<p class="form-note">${valid.length} תלמידים תקינים:</p>
          ${valid.map(v => `<div class="import-row"><span>${escapeHtml(v.displayName)}</span><span>${escapeHtml(v.username)}</span></div>`).join('')}
          <button type="button" id="confirm-import-btn" style="width:100%;margin-top:10px;">ייבוא ${valid.length} תלמידים</button>` : ''}
        ${invalid.length ? `<p class="form-note" style="color:var(--red);">${invalid.length} שורות נכשלו:</p>
          ${invalid.map(v => `<div class="import-row"><span>שורה ${v.row}</span><span>${escapeHtml(v.reason)}</span></div>`).join('')}` : ''}
      </div>`;
  }

  function renderStudentDetail() {
    const s = state.students.find(s => s.studentId === state.selectedStudentId);
    if (!s || !state.transcripts) return `<div class="panel glass"><div class="spinner"></div></div>`;
    const { checkIns, helpChats } = state.transcripts;
    return `
    <div class="panel glass">
      <h3>📄 תמלולים - ${escapeHtml(s.firstName)} ${escapeHtml(s.lastName || '')}</h3>
      ${checkIns.length === 0 ? '<p class="form-note">אין עדיין צ\'ק-אין מוערך.</p>' : checkIns.map(c => `
        <div style="border-bottom:1px solid var(--line);padding:10px 0;">
          <b>שבוע ${c.weekNumber}</b> · ציון: ${c.teacherOverrideScore || c.score}/10
          ${c.docLink ? ` · <a href="${escapeHtml(c.docLink)}" target="_blank">קובץ Docs</a>` : ''}
          <div class="form-note">${escapeHtml(c.mentorFeedback || '')}</div>
          <form class="override-form" data-checkin="${c.checkInId}" style="display:flex;gap:8px;margin-top:6px;">
            <input type="number" min="1" max="10" placeholder="דריסת ציון" style="width:110px;">
            <input type="text" placeholder="הערה" style="flex:1;">
            <button type="submit" class="secondary" style="padding:6px 12px;font-size:12.5px;">שמירה</button>
          </form>
        </div>`).join('')}
      ${helpChats.length ? `<p class="form-note" style="margin-top:10px;">${helpChats.length} שיחות עזרה חופשיות נוספות נשמרו (לא מוערכות).</p>` : ''}
      <button type="button" id="close-detail-btn" class="secondary" style="margin-top:10px;">סגירה</button>
    </div>`;
  }

  function wireActions() {
    document.querySelectorAll('.view-student-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        state.selectedStudentId = btn.dataset.id;
        state.transcripts = null;
        render();
        state.transcripts = await getStudentTranscripts(state.selectedStudentId);
        render();
      });
    });

    document.querySelectorAll('.reset-pw-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newPw = prompt('סיסמה זמנית חדשה עבור ' + btn.dataset.name + ' (התלמיד/ה יחויב/תחויב להחליף בכניסה הבאה):');
        if (!newPw) return;
        try {
          await resetStudentPassword(btn.dataset.id, newPw);
          toast('הסיסמה אופסה');
        } catch (err) { toast('שגיאה: ' + err.message, true); }
      });
    });

    const closeBtn = document.getElementById('close-detail-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => { state.selectedStudentId = null; render(); });

    document.querySelectorAll('.override-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const [scoreInput, noteInput] = form.querySelectorAll('input');
        if (!scoreInput.value) return;
        try {
          await setManualGrade(form.dataset.checkin, Number(scoreInput.value), noteInput.value);
          toast('הציון עודכן');
          state.transcripts = await getStudentTranscripts(state.selectedStudentId);
          await refresh();
        } catch (err) {
          toast('שגיאה: ' + err.message, true);
        }
      });
    });

    document.getElementById('update-topic-btn').addEventListener('click', async () => {
      const text = document.getElementById('topic-input').value.trim();
      try {
        state.week = await updateCurrentWeekTopic(text);
        toast('הנושא עודכן');
        render();
      } catch (err) { toast('שגיאה: ' + err.message, true); }
    });

    document.getElementById('new-week-btn').addEventListener('click', async () => {
      const text = document.getElementById('topic-input').value.trim();
      if (!confirm('להתחיל שבוע חדש (' + (state.week.weekNumber + 1) + ')? זה יאפשר לכל התלמידים לבצע צ\'ק-אין מוערך חדש.')) return;
      try {
        state.week = await startNewWeek(text);
        toast('שבוע ' + state.week.weekNumber + ' התחיל');
        await refresh();
      } catch (err) { toast('שגיאה: ' + err.message, true); }
    });

    document.getElementById('parse-excel-btn').addEventListener('click', async () => {
      const input = document.getElementById('excel-file-input');
      const file = input.files && input.files[0];
      if (!file) { toast('נא לבחור קובץ Excel קודם', true); return; }
      try {
        const existingUsernames = state.students.map(s => s.username).filter(Boolean);
        state.importPreview = await parseStudentsExcel(file, existingUsernames);
        render();
      } catch (err) {
        toast('שגיאה בקריאת הקובץ: ' + err.message, true);
      }
    });

    const confirmBtn = document.getElementById('confirm-import-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        try {
          const { imported } = await importRoster(state.importPreview.valid);
          const created = imported.filter(r => r.status === 'נוצר').length;
          toast(`יובאו ${created} תלמידים חדשים`);
          state.importPreview = null;
          await refresh();
        } catch (err) {
          toast('שגיאה בייבוא: ' + err.message, true);
          confirmBtn.disabled = false;
        }
      });
    }

    document.getElementById('export-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const { url } = await exportWeeklyReport();
        toast('הדוח מוכן');
        if (url && url.startsWith('http')) window.open(url, '_blank');
      } catch (err) {
        toast('שגיאה בייצוא: ' + err.message, true);
      } finally {
        e.target.disabled = false;
      }
    });
  }
}
