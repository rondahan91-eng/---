// ==========================================================================
// studentChat.js - הצ'אט המאוחד עם ה-AI Mentor: העלאת תמונות שבועיות + 3
// שאלות מוערכות משולבות + צ'אט עזרה חופשי בלתי מוגבל (FR-B/FR-F).
// ==========================================================================
import { escapeHtml, toast, topbarHtml, wireLogout } from './ui.js';
import { getStudentContext, sendMentorMessage } from './api.js';

export async function mountStudentChat(app, session, onLogout) {
  app.innerHTML = `<div class="center-msg" style="margin:auto;"><div class="spinner"></div>טוען...</div>`;
  let ctx;
  try {
    ctx = await getStudentContext(session.studentId);
  } catch (err) {
    app.innerHTML = `<div class="center-msg" style="margin:auto;">שגיאה בטעינת הפרופיל: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const state = {
    history: [], // {role:'user'|'model', text}
    images: null, // [{base64, mimeType}] עד 2, נקבע פעם אחת בתחילת השבוע
    pendingSlots: [null, null], // תצוגה מקדימה בזמן מילוי הטופס
    sessionStart: Date.now(),
    uploadDone: ctx.gradedThisWeek, // אם כבר בוצע השבוע - לא מציגים את כרטיס ההעלאה
    sending: false,
  };

  render();

  function render() {
    app.innerHTML = `
      ${topbarHtml(session, ctx.bodyPart + ' · אסטרטגיית ' + escapeHtml(ctx.strategy))}
      <div class="chat-wrap">
        <div class="week-banner">שבוע ${ctx.weekNumber}${ctx.topicText ? ' · נושא השבוע: ' + escapeHtml(ctx.topicText) : ''}
          ${ctx.gradedThisWeek ? ' · <b>החלק המוערך של השבוע כבר בוצע ✓</b> — אפשר להמשיך לשוחח בעזרה חופשית.' : ''}
        </div>
        ${!state.uploadDone ? renderUploadCard() : ''}
        <div class="messages" id="messages">
          ${state.history.length === 0 ? `<div class="msg system-note">כתבו הודעה כדי להתחיל, או השלימו למעלה את תמונות ההתקדמות לשבוע זה.</div>` : ''}
          ${state.history.map(renderBubble).join('')}
          ${state.sending ? `<div class="typing-dots">ה-AI Mentor כותב...</div>` : ''}
        </div>
        <form class="chat-input-row" id="chat-form">
          <textarea id="chat-input" placeholder="כתבו הודעה..." required></textarea>
          <button type="submit" id="send-btn">שליחה</button>
        </form>
      </div>
      <div id="toast" class="toast"></div>`;
    wireLogout(onLogout);
    wireUploadCard();
    wireChatForm();
    scrollToBottom();
  }

  function renderUploadCard() {
    return `
    <div class="upload-card glass">
      <h3>📸 תמונות התקדמות לשבוע ${ctx.weekNumber}</h3>
      <p class="form-note" style="margin-top:0;">העלו 2 תמונות + סיכום קצר של השבוע - זה יתחיל את החלק המוערך של הצ'ק-אין.</p>
      <div class="upload-row">
        ${[0, 1].map(i => `
          <label class="upload-slot" for="img-slot-${i}">
            ${state.pendingSlots[i]
              ? `<img src="${state.pendingSlots[i]}" alt="תמונה ${i + 1}">`
              : `<span class="hint">תמונה ${i + 1}<br>לחצו לבחירה</span>`}
            <input type="file" id="img-slot-${i}" accept="image/*">
          </label>`).join('')}
      </div>
      <div class="field"><textarea id="week-summary" rows="3" placeholder="סיכום מילולי קצר של השבוע..."></textarea></div>
      <button type="button" id="start-graded-btn" style="width:100%;">שליחה והתחלת החלק המוערך</button>
    </div>`;
  }

  function renderBubble(turn) {
    if (turn.role === 'user') return `<div class="msg user">${escapeHtml(turn.text)}</div>`;
    const isGraded = /ציון ההערכה לשבוע זה/.test(turn.text);
    return `<div class="mode-badge${isGraded ? ' graded' : ''}">${isGraded ? '📋 חלק מוערך' : '💬 עזרה חופשית'}</div>
            <div class="msg model${isGraded ? ' graded' : ''}">${escapeHtml(turn.text)}</div>`;
  }

  function wireUploadCard() {
    const btn = document.getElementById('start-graded-btn');
    if (!btn) return;
    [0, 1].forEach(i => {
      const input = document.getElementById('img-slot-' + i);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          state.pendingSlots[i] = reader.result;
          render();
        };
        reader.readAsDataURL(file);
      });
    });
    btn.addEventListener('click', async () => {
      const summary = document.getElementById('week-summary').value.trim();
      const filled = state.pendingSlots.filter(Boolean);
      if (!filled.length || !summary) {
        toast('נא להעלות לפחות תמונה אחת ולכתוב סיכום קצר', true);
        return;
      }
      state.images = state.pendingSlots.filter(Boolean).map(dataUrl => {
        const [meta, base64] = dataUrl.split(',');
        const mimeType = meta.match(/data:(.*);base64/)[1];
        return { base64, mimeType };
      });
      state.uploadDone = true;
      await sendMessage(summary || '(תמונות התקדמות השבוע מצורפות)');
    });
  }

  function wireChatForm() {
    const form = document.getElementById('chat-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text || state.sending) return;
      input.value = '';
      await sendMessage(text);
    });
  }

  async function sendMessage(text) {
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

  function scrollToBottom() {
    const el = document.getElementById('messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}
