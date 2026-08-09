// ==========================================================================
// api.js - שכבת התקשורת מול השרת (Google Apps Script Web App).
// כל עוד CONFIG.API_URL ריק, פועל מצב פיתוח מקומי (DEV MODE) המדמה את מרבית
// הפעולות באמצעות localStorage. שיחת ה-AI Mentor במצב פיתוח מוחזרת כתסריט
// מדומה קבוע (לא AI אמיתי) - זה מספיק לבדיקת הממשק, לא לבדיקת איכות השאלות.
// ==========================================================================
import { CONFIG } from './config.js';

const DB_KEY = CONFIG.SESSION_KEY + '-devdb';

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- טוקן התחברות
/** הטוקן נשמר יחד עם ה-session ונשלח בכל בקשה חוץ מההתחברות עצמה. */
function currentToken() {
  try { return (JSON.parse(sessionStorage.getItem(CONFIG.SESSION_KEY) || 'null') || {}).token || null; }
  catch { return null; }
}

function handleExpiredSession() {
  sessionStorage.removeItem(CONFIG.SESSION_KEY);
  location.reload();
}

// ---------------------------------------------------------------- תקשורת אמיתית
async function callRemote(action, payload) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) throw new Error('שגיאת רשת מול השרת (' + res.status + ')');
  const data = await res.json();
  if (!data.ok) {
    if (/פג תוקף ההתחברות/.test(data.error || '')) {
      handleExpiredSession();
      throw new Error('פג תוקף ההתחברות - מעביר למסך הכניסה');
    }
    throw new Error(data.error || 'שגיאת שרת לא ידועה');
  }
  return data.result;
}

// ---------------------------------------------------------------- DEV MODE (localStorage)
function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  return raw ? JSON.parse(raw) : null;
}
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function delay(ms = 250) { return new Promise(r => setTimeout(r, ms)); }

async function ensureSeeded() {
  let db = loadDB();
  if (db) return db;
  db = { users: [], week: { weekNumber: 1, topicText: 'ייצוג דיגיטלי, פיקסלים 0-255' }, checkIns: [], helpChats: [] };
  db.users.push({
    studentId: 'admin', username: 'admin', passHash: await sha256Hex('admin123'),
    mustChangePassword: false, role: 'admin', firstName: 'מורה', lastName: 'ראשי',
  });
  db.users.push({
    studentId: 'demo1', username: 'מיכל5678', passHash: await sha256Hex('140810'),
    mustChangePassword: false, role: 'student', firstName: 'מיכל', lastName: 'לדוגמה',
    group: 'קבוצה 1', bodyPart: 'כתף', strategy: 'רעשים',
  });
  saveDB(db);
  return db;
}

function findStudent(db, studentId) {
  const u = db.users.find(u => u.studentId === studentId);
  if (!u) throw new Error('תלמיד לא נמצא');
  return u;
}

const MOCK_QUESTIONS = [
  (ctx) => `היי ${ctx.firstName}! השבוע למדנו על "${ctx.week.topicText}". באסטרטגיית ה${ctx.strategy} שלך על איבר ה${ctx.bodyPart}, איך זה עשוי להשפיע על התמונות שאספת השבוע? נמק את עמדתך. (זו שאלה מדומה - מצב פיתוח מקומי, לא AI אמיתי)`,
  () => 'תוכל/י לתת לי דוגמה קונקרטית מתוך התמונות שאספת השבוע? (שאלה מדומה - מצב פיתוח)',
  () => 'מעניין - ואיך זה מתקשר למה שלמדנו על מטריצת פיקסלים? (שאלה מדומה - מצב פיתוח)',
];

async function mockMentorReply(db, studentId, history) {
  const u = findStudent(db, studentId);
  const ctx = { firstName: u.firstName, bodyPart: u.bodyPart, strategy: u.strategy, week: db.week };
  const userTurns = history.filter(h => h.role === 'user').length; // כולל ההודעה שרק נשלחה
  if (userTurns > MOCK_QUESTIONS.length) {
    const score = 7 + Math.floor(Math.random() * 3);
    return {
      reply: `תודה על התשובות, ${u.firstName}. ציון ההערכה לשבוע זה: ${score}. משוב מנטור: הפגנת הבנה טובה של הקישור בין האסטרטגיה שלך לתופעה שנשאלת. לפעם הבאה - נסה/י לחזק את הנימוק המדעי עם עוד מונחים מקצועיים. (הערכה מדומה - מצב פיתוח מקומי)`,
      graded: true, score,
    };
  }
  return { reply: MOCK_QUESTIONS[userTurns - 1](ctx), graded: false };
}

async function callLocal(action, payload) {
  await delay();
  const db = await ensureSeeded();

  if (action === 'authenticateUser') {
    const { username, password } = payload;
    const user = db.users.find(u => u.username.toLowerCase() === String(username).trim().toLowerCase());
    if (!user) throw new Error('שם משתמש או סיסמה שגויים');
    if ((await sha256Hex(password)) !== user.passHash) throw new Error('שם משתמש או סיסמה שגויים');
    return {
      studentId: user.studentId, username: user.username, role: user.role,
      displayName: user.firstName + ' ' + user.lastName, mustChangePassword: !!user.mustChangePassword,
      token: 'dev-' + user.studentId, // במצב פיתוח אין אכיפת הרשאות אמיתית
    };
  }

  if (action === 'logout') return { ok: true };

  if (action === 'changePassword') {
    const { studentId, newPassword } = payload;
    const u = findStudent(db, studentId);
    u.passHash = await sha256Hex(newPassword);
    u.mustChangePassword = false;
    saveDB(db);
    return { ok: true };
  }

  if (action === 'resetStudentPassword') {
    const { studentId, newPassword } = payload;
    const u = findStudent(db, studentId);
    u.passHash = await sha256Hex(newPassword);
    u.mustChangePassword = true;
    saveDB(db);
    return { ok: true };
  }

  if (action === 'getStudentContext') {
    const { studentId } = payload;
    const u = findStudent(db, studentId);
    const mine = db.checkIns.filter(c => c.studentId === studentId);
    const lastGraded = mine.filter(c => c.status === 'graded').slice(-1)[0];
    const doneThisWeek = mine.some(c => c.weekNumber === db.week.weekNumber && c.status === 'graded');
    return {
      firstName: u.firstName, bodyPart: u.bodyPart, strategy: u.strategy, group: u.group,
      weekNumber: db.week.weekNumber, topicText: db.week.topicText,
      priorSummary: lastGraded ? lastGraded.aiMemorySummary : '', gradedThisWeek: doneThisWeek,
    };
  }

  if (action === 'sendMentorMessage') {
    const { studentId, history } = payload;
    const result = await mockMentorReply(db, studentId, history || []);
    const fullHistory = (history || []).concat([{ role: 'model', text: result.reply }]);
    if (result.graded) {
      db.checkIns.push({
        checkInId: 'ci_' + Date.now(), studentId, weekNumber: db.week.weekNumber,
        transcript: fullHistory, aiMemorySummary: 'סיכום מדומה של שיחת שבוע ' + db.week.weekNumber,
        mentorFeedback: result.reply, score: result.score, status: 'graded',
      });
    } else {
      const existing = db.helpChats.find(h => h.studentId === studentId && h.weekNumber === db.week.weekNumber);
      if (existing) existing.transcript = fullHistory;
      else db.helpChats.push({ logId: 'hc_' + Date.now(), studentId, weekNumber: db.week.weekNumber, transcript: fullHistory });
    }
    saveDB(db);
    return result;
  }

  if (action === 'getCurrentWeek') {
    return db.week;
  }

  if (action === 'startNewWeek') {
    db.week = { weekNumber: db.week.weekNumber + 1, topicText: payload.topicText || '' };
    saveDB(db);
    return db.week;
  }

  if (action === 'updateCurrentWeekTopic') {
    db.week.topicText = payload.topicText || '';
    saveDB(db);
    return db.week;
  }

  if (action === 'getDashboard') {
    return db.users.filter(u => u.role === 'student').map(u => {
      const mine = db.checkIns.filter(c => c.studentId === u.studentId);
      const scores = mine.map(c => c.teacherOverrideScore || c.score || 0);
      const accumulated = scores.reduce((s, v) => s + v, 0);
      const pointsFor100 = 0.8 * (db.week.weekNumber || 1) * 10;
      const grade = pointsFor100 > 0 ? Math.min(100, Math.round((accumulated / pointsFor100) * 100)) : 0;
      const surplusPoints = Math.max(0, accumulated - pointsFor100);
      const doneThisWeek = mine.some(c => c.weekNumber === db.week.weekNumber && c.status === 'graded');
      return {
        studentId: u.studentId, firstName: u.firstName, lastName: u.lastName,
        group: u.group, bodyPart: u.bodyPart, strategy: u.strategy,
        weeksCompleted: mine.length, mentorGrade: grade, surplusPoints,
        doneThisWeek, lastScore: mine.length ? scores[scores.length - 1] : null,
      };
    });
  }

  if (action === 'getStudentTranscripts') {
    const { studentId } = payload;
    return {
      checkIns: db.checkIns.filter(c => c.studentId === studentId),
      helpChats: db.helpChats.filter(c => c.studentId === studentId),
    };
  }

  if (action === 'setManualGrade') {
    const { checkInId, score, note } = payload;
    const c = db.checkIns.find(c => c.checkInId === checkInId);
    if (!c) throw new Error('צ\'ק-אין לא נמצא');
    c.teacherOverrideScore = score;
    c.teacherNote = note || '';
    saveDB(db);
    return { ok: true };
  }

  if (action === 'importRoster') {
    const students = payload.students || [];
    const existingUsernames = db.users.map(u => u.username);
    const results = [];
    for (const s of students) {
      if (existingUsernames.includes(s.username)) {
        results.push({ firstName: s.firstName, username: s.username, ok: true, status: 'כבר קיים - לא נוצר מחדש' });
        continue;
      }
      db.users.push({
        studentId: 's_' + Date.now() + Math.random().toString(36).slice(2, 6),
        username: s.username, passHash: await sha256Hex(s.password), mustChangePassword: true, role: 'student',
        firstName: s.firstName, lastName: s.lastName, group: s.group, bodyPart: s.bodyPart, strategy: s.strategy,
      });
      existingUsernames.push(s.username);
      results.push({ firstName: s.firstName, username: s.username, ok: true, status: 'נוצר' });
    }
    saveDB(db);
    return { imported: results };
  }

  if (action === 'exportWeeklyReport') {
    return { url: '(מצב פיתוח - ייצוא אמיתי דורש שרת)' };
  }

  throw new Error('פעולה לא מוכרת: ' + action);
}

async function dispatch(action, payload) {
  // ההתחברות היא הפעולה היחידה שאין לה עדיין טוקן
  const withToken = action === 'authenticateUser'
    ? payload
    : Object.assign({}, payload, { token: currentToken() });
  return CONFIG.API_URL ? callRemote(action, withToken) : callLocal(action, withToken);
}

// ---------------------------------------------------------------- API ציבורי
export async function authenticateUser(username, password) {
  return dispatch('authenticateUser', { username, password });
}
export async function changePassword(studentId, newPassword) {
  return dispatch('changePassword', { studentId, newPassword });
}
export async function logout() {
  try { await dispatch('logout', {}); } catch { /* ניתוק מקומי גם אם השרת לא ענה */ }
}
export async function resetStudentPassword(studentId, newPassword) {
  return dispatch('resetStudentPassword', { studentId, newPassword });
}
export async function importRoster(students) {
  return dispatch('importRoster', { students });
}
export async function getStudentContext(studentId) {
  return dispatch('getStudentContext', { studentId });
}
export async function sendMentorMessage(studentId, history, images, elapsedSeconds) {
  return dispatch('sendMentorMessage', { studentId, history, images, elapsedSeconds });
}
export async function getCurrentWeek() {
  return dispatch('getCurrentWeek', {});
}
export async function startNewWeek(topicText) {
  return dispatch('startNewWeek', { topicText });
}
export async function updateCurrentWeekTopic(topicText) {
  return dispatch('updateCurrentWeekTopic', { topicText });
}
export async function getDashboard() {
  return dispatch('getDashboard', {});
}
export async function getStudentTranscripts(studentId) {
  return dispatch('getStudentTranscripts', { studentId });
}
export async function setManualGrade(checkInId, score, note) {
  return dispatch('setManualGrade', { checkInId, score, note });
}
export async function exportWeeklyReport() {
  return dispatch('exportWeeklyReport', {});
}
export function isDevMode() { return !CONFIG.API_URL; }
