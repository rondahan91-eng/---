// ==========================================================================
// studentChat.js - ממשק התלמיד: app shell עם מסילת משימה (זהות, כרטיס
// המחקר האישי, צעדי השבוע) לצד שיחה רציפה אחת עם ה-AI Mentor -
// 3 שאלות מוערכות משולבות + עזרה חופשית בלתי מוגבלת סביבן (FR-B/FR-F).
// ==========================================================================
import { escapeHtml, toast, logoMark } from './ui.js';
import { getStudentContext, sendMentorMessage } from './api.js';

// הקטנת תמונות לפני השליחה. צילומי טלפון/מסך מגיעים לעיתים במגה-בייטים,
// ו-Gemini מחייב על תמונות לפי רזולוציה - ההקטנה חוסכת עלות טוקנים, זמן
// המתנה ונפח ב-Drive. 1024px נשמר בכוונה גבוה מספיק כדי שקווי שבר ופרטים
// עדינים בצילום הרנטגן יישארו ניתנים לזיהוי.
const RAIL_PREF_KEY = 'ai-mentor-rail-hidden';

const MAX_IMAGE_DIM = 1024;
const IMAGE_QUALITY = 0.85;
const SKIP_RESIZE_UNDER_BYTES = 300 * 1024;

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא הצלחתי לקרוא את הקובץ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('הקובץ אינו תמונה תקינה'));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
        // תמונה שכבר קטנה ממילא - משאירים כפי שהיא, בלי מעבר מיותר דרך JPEG
        if (scale === 1 && file.size <= SKIP_RESIZE_UNDER_BYTES) {
          resolve(reader.result);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const STRATEGY_BLURB = {
  'תקן': 'נתונים אידיאליים — התמונות הברורות והמאוזנות ביותר',
  'הטיות': 'מאגר לא מאוזן — לחקר GIGO והטיה בנתונים',
  'רעשים': 'תמונות קשות לפיענוח — חפצים זרים, גבס, חשיפה חסרה',
};

export async function mountStudentChat(app, session, onLogout) {
  app.innerHTML = `<div class="center-msg"><div class="spinner"></div>טוען את סביבת המחקר שלך...</div>`;

  let ctx;
  try {
    ctx = await getStudentContext(session.studentId);
  } catch (err) {
    app.innerHTML = `<div class="center-msg">שגיאה בטעינת הפרופיל: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const state = {
    history: [],
    images: null,          // נשלח פעם אחת, עם ההודעה שפותחת את החלק המוערך
    slots: [null, null],   // תצוגה מקדימה (dataURL) לפני השליחה
    submittedTask: ctx.gradedThisWeek,
    sending: false,
    sessionStart: Date.now(),
    // העדפת תצוגה נשמרת בין כניסות, כדי שלא צריך לקפל מחדש בכל פעם
    railHidden: localStorage.getItem(RAIL_PREF_KEY) === '1',
  };

  render();

  // ---------------------------------------------------------------- מסילת הצד
  function railHtml() {
    const initial = (ctx.firstName || '?').trim().charAt(0);
    const imagesDone = state.submittedTask;
    const answering = state.submittedTask && !ctx.gradedThisWeek;
    const scored = ctx.gradedThisWeek;

    const step = (done, active, label) =>
      `<div class="step${done ? ' done' : ''}${active ? ' active' : ''}">
         <span class="dot">${done ? '✓' : ''}</span><span class="txt">${label}</span>
       </div>`;

    return `
    <aside class="rail">
      <div class="rail-top">
        <div class="rail-brand">${logoMark(26)} <span>AI Mentor</span></div>
        <button class="ghost" id="logout-btn" style="padding:6px 10px;font-size:12px;">יציאה</button>
      </div>

      <div class="id-card">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="who">
          <b>${escapeHtml(ctx.firstName || session.displayName)}</b>
          <span>${escapeHtml(ctx.group || 'ללא קבוצה')}</span>
        </div>
      </div>

      <div class="mission" data-strategy="${escapeHtml(ctx.strategy || '')}">
        <h4>המחקר שלי</h4>
        <div class="mission-row"><span>איבר ההתמחות</span><b>${escapeHtml(ctx.bodyPart || '—')}</b></div>
        <div class="mission-row"><span>אסטרטגיה</span><span class="s-chip">${escapeHtml(ctx.strategy || '—')}</span></div>
        <p class="form-note" style="margin-top:8px;">${escapeHtml(STRATEGY_BLURB[ctx.strategy] || '')}</p>
      </div>

      <div class="steps">
        <h4>המשימה השבועית</h4>
        ${step(imagesDone, !imagesDone, '2 תמונות התקדמות + סיכום')}
        ${step(scored, answering, 'מענה על שאלות המנטור')}
        ${step(scored, false, 'קבלת ציון ומשוב')}
      </div>

      <div class="rail-tip">
        <b>שימו לב:</b> רק החלק המוערך נכנס לציון. בכל שאר השיחה אפשר לשאול
        בחופשיות על הפרויקט, על הפעלת Teachable Machine או על אנטומיה ופיזיקה
        של הדימות — בלי שזה נמדד.
      </div>
    </aside>`;
  }

  // ---------------------------------------------------------------- שיחה
  function turnHtml(turn) {
    if (turn.role === 'user') {
      return `<div class="turn me">
          <div class="who-mark">${escapeHtml((ctx.firstName || '?').charAt(0))}</div>
          <div class="bubble">${escapeHtml(turn.text)}</div>
        </div>`;
    }
    const scored = /ציון ההערכה לשבוע זה/.test(turn.text);
    return `<div class="turn ai${scored ? ' scored' : ''}">
        <div class="who-mark">${logoMark(18)}</div>
        <div>
          <span class="turn-tag">${scored ? 'הערכה וציון' : 'AI Mentor'}</span>
          <div class="bubble">${escapeHtml(turn.text)}</div>
        </div>
      </div>`;
  }

  function emptyStateHtml() {
    return `<div class="stream-empty">
        ${logoMark(52)}
        <div class="big">שלום ${escapeHtml(ctx.firstName || '')}, נתחיל?</div>
        <p>אפשר לפתוח בשאלה חופשית על הפרויקט, או להעלות למטה את תמונות
           ההתקדמות של השבוע כדי להתחיל את החלק המוערך.</p>
      </div>`;
  }

  function taskStripHtml() {
    if (state.submittedTask) return '';
    return `
    <div class="task-strip">
      <div class="task-strip-head">
        <b>משימת שבוע ${ctx.weekNumber}</b>
        <span class="mini">— 2 תמונות + סיכום קצר. השליחה פותחת את החלק המוערך.</span>
      </div>
      <div class="tiles">
        ${[0, 1].map(i => `
          <label class="tile${state.slots[i] ? ' filled' : ''}">
            ${state.slots[i]
              ? `<img src="${state.slots[i]}" alt="תמונה ${i + 1}">`
              : `<span class="ph">תמונה ${i + 1}<br>לחצו לבחירה</span>`}
            <input type="file" class="slot-input" data-idx="${i}" accept="image/*">
          </label>`).join('')}
      </div>
      <div class="field" style="margin-bottom:10px;">
        <textarea id="week-summary" rows="2" placeholder="מה עשית השבוע? (אילו תמונות אספת ולמה הן מתאימות לאסטרטגיה שלך)"></textarea>
      </div>
      <button type="button" id="start-graded-btn" style="width:100%;">שליחה והתחלת החלק המוערך</button>
    </div>`;
  }

  function render() {
    const statusPill = ctx.gradedThisWeek
      ? '<span class="pill ok">החלק המוערך הושלם ✓</span>'
      : (state.submittedTask ? '<span class="pill warn">בתהליך הערכה</span>' : '<span class="pill bad">טרם בוצע</span>');

    app.innerHTML = `
    <div class="shell${state.railHidden ? ' rail-hidden' : ''}">
      ${railHtml()}
      <main class="main">
        <header class="stream-head">
          <button class="rail-toggle" id="rail-toggle"
            title="${state.railHidden ? 'הצגת פרטי המחקר' : 'הסתרת פרטי המחקר להרחבת השיחה'}">☰</button>
          <span class="week-pill">שבוע ${ctx.weekNumber}</span>
          <span class="topic-line">${ctx.topicText
            ? `נושא השבוע: <b>${escapeHtml(ctx.topicText)}</b>`
            : 'טרם הוזן נושא שבועי'}</span>
          <span class="head-status">${statusPill}</span>
        </header>

        <div class="stream" id="stream">
          <div class="stream-inner">
            ${state.history.length ? state.history.map(turnHtml).join('') : emptyStateHtml()}
            ${state.sending ? `<div class="turn ai"><div class="who-mark">${logoMark(18)}</div>
              <div class="bubble thinking"><i></i><i></i><i></i></div></div>` : ''}
          </div>
        </div>

        <div class="dock">
          <div class="dock-inner">
            ${taskStripHtml()}
            <form class="composer" id="chat-form">
              <textarea id="chat-input" rows="1" placeholder="כתבו הודעה למנטור..." required></textarea>
              <button type="submit" id="send-btn">שליחה</button>
            </form>
            <div class="dock-note">${ctx.gradedThisWeek
              ? 'החלק המוערך של השבוע הסתיים — מכאן השיחה חופשית ואינה נמדדת.'
              : 'שאלות חופשיות אינן נמדדות. רק שאלות המנטור המסומנות מזכות בציון.'}</div>
          </div>
        </div>
      </main>
    </div>
    <div id="toast" class="toast"></div>`;

    wire();
    const stream = document.getElementById('stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  }

  // ---------------------------------------------------------------- אירועים
  function wire() {
    document.getElementById('logout-btn').addEventListener('click', onLogout);

    document.getElementById('rail-toggle').addEventListener('click', () => {
      state.railHidden = !state.railHidden;
      localStorage.setItem(RAIL_PREF_KEY, state.railHidden ? '1' : '0');
      render();
    });

    document.querySelectorAll('.slot-input').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const idx = Number(input.dataset.idx);
        try {
          state.slots[idx] = await downscaleImage(file);
        } catch (err) {
          toast('שגיאה בטעינת התמונה: ' + err.message, true);
          return;
        }
        render();
      });
    });

    const startBtn = document.getElementById('start-graded-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const summary = document.getElementById('week-summary').value.trim();
        if (!state.slots.some(Boolean) || !summary) {
          toast('נא להעלות לפחות תמונה אחת ולכתוב סיכום קצר', true);
          return;
        }
        state.images = state.slots.filter(Boolean).map(dataUrl => {
          const [meta, base64] = dataUrl.split(',');
          return { base64, mimeType: meta.match(/data:(.*);base64/)[1] };
        });
        state.submittedTask = true;
        send(summary);
      });
    }

    const form = document.getElementById('chat-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text || state.sending) return;
      input.value = '';
      send(text);
    });

    // Enter שולח, Shift+Enter יורד שורה
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
  }

  async function send(text) {
    state.history.push({ role: 'user', text });
    state.sending = true;
    render();
    try {
      const elapsedSeconds = Math.round((Date.now() - state.sessionStart) / 1000);
      const result = await sendMentorMessage(session.studentId, state.history, state.images, elapsedSeconds);
      state.history.push({ role: 'model', text: result.reply });
      if (result.graded) {
        ctx.gradedThisWeek = true;
        toast('הציון לשבוע זה נשמר: ' + result.score + '/10');
      }
    } catch (err) {
      state.history.push({ role: 'model', text: '⚠️ שגיאה: ' + err.message });
    } finally {
      state.sending = false;
      render();
    }
  }
}
