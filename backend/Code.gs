/**
 * ==========================================================================
 * AI Mentor - הנדסה ביו-רפואית - Code.gs
 * שרת ה-Backend (Google Apps Script) עבור מערכת ליווי התלמידים.
 * משתמש בגיליון Google Sheets מחובר כמסד נתונים.
 *
 * הוראות פריסה מלאות נמצאות בקובץ README.md שבשורש הפרויקט.
 * ==========================================================================
 */

const SHEET_USERS = 'Users';
const SHEET_TOPICS = 'WeeklyTopics';
const SHEET_CHECKINS = 'WeeklyCheckIns';
const SHEET_HELPCHATS = 'HelpChatLog';
const SHEET_SESSIONS = 'Sessions';

// תוקף טוקן התחברות. אחרי הזמן הזה נדרשת התחברות מחדש.
const TOKEN_TTL_HOURS = 24;

// מודל ברירת המחדל. אפשר לעקוף אותו בלי לגעת בקוד: Project Settings →
// Script Properties → מאפיין בשם GEMINI_MODEL. שימושי כשגוגל מוציאה משימוש
// מודל ישן (הרצת listAvailableModels תראה מה זמין למפתח שלכם).
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

function geminiModel() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
}

// -------------------------------------------------------------- כניסה ל-Web App
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'בקשה לא תקינה (JSON שגוי)' });
  }
  const { action, payload } = body;
  try {
    const result = routeAction(action, payload || {});
    return jsonResponse({ ok: true, result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function doGet() {
  return ContentService.createTextOutput(
    'AI Mentor - הנדסה ביו-רפואית - API פעיל. יש לשלוח בקשות POST בלבד.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * כל פעולה - חוץ מההתחברות עצמה - דורשת טוקן תקף. בלי זה, מי שמשיג את
 * כתובת ה-/exec יכול היה למשוך את כל נתוני הכיתה ללא סיסמה.
 */
function routeAction(action, payload) {
  switch (action) {
    case 'authenticateUser': return authenticateUser(payload.username, payload.password);
    case 'logout': return logout(payload.token);

    // --- התלמיד/ה עצמו/ה, או המורה ---
    case 'changePassword':
      requireSelfOrAdmin(payload, payload.studentId);
      return changePassword(payload.studentId, payload.newPassword);
    case 'getStudentContext':
      requireSelfOrAdmin(payload, payload.studentId);
      return getStudentContext(payload.studentId);
    case 'sendMentorMessage':
      requireSelfOrAdmin(payload, payload.studentId);
      return sendMentorMessage(payload.studentId, payload.history, payload.images, payload.elapsedSeconds);
    case 'getCurrentWeek':
      requireAuth(payload);
      return getCurrentWeekInfo();

    // --- מורה בלבד ---
    case 'resetStudentPassword':
      requireAdmin(payload);
      return resetStudentPassword(payload.studentId, payload.newPassword);
    case 'importRoster':
      requireAdmin(payload);
      return importRoster(payload.students);
    case 'startNewWeek':
      requireAdmin(payload);
      return startNewWeek(payload.topicText);
    case 'updateCurrentWeekTopic':
      requireAdmin(payload);
      return updateCurrentWeekTopic(payload.topicText);
    case 'getDashboard':
      requireAdmin(payload);
      return getDashboard();
    case 'getStudentTranscripts':
      requireSelfOrAdmin(payload, payload.studentId);
      return getStudentTranscripts(payload.studentId);
    case 'setManualGrade':
      requireAdmin(payload);
      return setManualGrade(payload.checkInId, payload.score, payload.note);
    case 'exportWeeklyReport':
      requireAdmin(payload);
      return exportWeeklyReport();

    default: throw new Error('פעולה לא מוכרת: ' + action);
  }
}

// -------------------------------------------------------------- טוקנים והרשאות
const ERR_REAUTH = 'פג תוקף ההתחברות - יש להתחבר מחדש';

function createSession(user) {
  const sheet = getSheet(SHEET_SESSIONS);
  pruneExpiredSessions(sheet);
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([token, user.studentId, user.role, now,
    new Date(now.getTime() + TOKEN_TTL_HOURS * 3600 * 1000)]);
  return token;
}

function pruneExpiredSessions(sheet) {
  const values = sheet.getDataRange().getValues();
  const now = new Date();
  for (let r = values.length - 1; r >= 1; r--) {
    const exp = values[r][4];
    if (exp && new Date(exp) < now) sheet.deleteRow(r + 1);
  }
}

function resolveSession(token) {
  if (!token) throw new Error(ERR_REAUTH);
  const row = sheetToObjects(getSheet(SHEET_SESSIONS)).find(r => r.token === token);
  if (!row) throw new Error(ERR_REAUTH);
  if (new Date(row.expiresAt) < new Date()) throw new Error(ERR_REAUTH);
  return { studentId: row.studentId, role: row.role };
}

function requireAuth(payload) {
  return resolveSession(payload.token);
}

function requireAdmin(payload) {
  const s = resolveSession(payload.token);
  if (s.role !== 'admin') throw new Error('הפעולה מותרת למורה בלבד');
  return s;
}

/** תלמיד/ה רשאי/ת לגשת רק לנתונים של עצמו/ה; מורה - לכולם. */
function requireSelfOrAdmin(payload, studentId) {
  const s = resolveSession(payload.token);
  if (s.role !== 'admin' && s.studentId !== studentId) {
    throw new Error('אין הרשאה לגשת לנתונים של תלמיד/ה אחר/ת');
  }
  return s;
}

function logout(token) {
  if (!token) return { ok: true };
  const sheet = getSheet(SHEET_SESSIONS);
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (values[r][0] === token) { sheet.deleteRow(r + 1); break; }
  }
  return { ok: true };
}

// -------------------------------------------------------------- גישה לגיליונות
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = createSheet(ss, name);
  return sheet;
}

function createSheet(ss, name) {
  const sheet = ss.insertSheet(name);
  if (name === SHEET_USERS) {
    sheet.appendRow(['studentId', 'username', 'passHash', 'mustChangePassword', 'role', 'firstName', 'lastName',
      'last4Id', 'birthDate', 'group', 'bodyPart', 'strategy', 'createdAt']);
    // mustChangePassword=true: סיסמת ברירת המחדל מתועדת ב-README ולכן ציבורית -
    // המערכת מחייבת להחליף אותה כבר בכניסה הראשונה של המורה.
    sheet.appendRow(['admin', 'admin', sha256('admin123'), true, 'admin', 'מורה', 'ראשי', '', '', '', '', '', new Date()]);
  } else if (name === SHEET_TOPICS) {
    sheet.appendRow(['weekNumber', 'topicText', 'setAt']);
  } else if (name === SHEET_CHECKINS) {
    sheet.appendRow(['checkInId', 'studentId', 'weekNumber', 'date', 'image1Url', 'image2Url', 'studentSummary',
      'transcriptJson', 'aiMemorySummary', 'mentorFeedback', 'score', 'teacherOverrideScore', 'teacherNote',
      'docLink', 'sessionSeconds', 'status']);
  } else if (name === SHEET_HELPCHATS) {
    sheet.appendRow(['logId', 'studentId', 'weekNumber', 'date', 'transcriptJson']);
  } else if (name === SHEET_SESSIONS) {
    sheet.appendRow(['token', 'studentId', 'role', 'createdAt', 'expiresAt']);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(row => row[0] !== '').map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    obj.__row = idx + 2; // מספר שורה בפועל בגיליון (1-based + header)
    return obj;
  });
}

function sha256(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}

// -------------------------------------------------------------- אימות והרשאות
function authenticateUser(username, password) {
  if (!username || !password) throw new Error('שם משתמש וסיסמה הם שדות חובה');
  const users = sheetToObjects(getSheet(SHEET_USERS));
  const user = users.find(u => String(u.username).toLowerCase() === String(username).trim().toLowerCase());
  if (!user) throw new Error('שם משתמש או סיסמה שגויים');
  if (sha256(password) !== user.passHash) throw new Error('שם משתמש או סיסמה שגויים');
  return {
    studentId: user.studentId, username: user.username, role: user.role,
    displayName: (user.firstName || '') + ' ' + (user.lastName || ''),
    mustChangePassword: !!user.mustChangePassword,
    token: createSession(user),
  };
}

function changePassword(studentId, newPassword) {
  if (!studentId || !newPassword) throw new Error('חסרים פרטים לעדכון הסיסמה');
  const sheet = getSheet(SHEET_USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const col = (name) => headers.indexOf(name) + 1;
  for (let r = 1; r < values.length; r++) {
    if (values[r][0] === studentId) {
      sheet.getRange(r + 1, col('passHash')).setValue(sha256(newPassword));
      sheet.getRange(r + 1, col('mustChangePassword')).setValue(false);
      return { ok: true };
    }
  }
  throw new Error('תלמיד לא נמצא');
}

function resetStudentPassword(studentId, newPassword) {
  // איפוס ע"י המורה (למשל אם תלמיד שכח סיסמה) - מחייב החלפה נוספת בכניסה הבאה
  const sheet = getSheet(SHEET_USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const col = (name) => headers.indexOf(name) + 1;
  for (let r = 1; r < values.length; r++) {
    if (values[r][0] === studentId) {
      sheet.getRange(r + 1, col('passHash')).setValue(sha256(newPassword));
      sheet.getRange(r + 1, col('mustChangePassword')).setValue(true);
      return { ok: true };
    }
  }
  throw new Error('תלמיד לא נמצא');
}

// -------------------------------------------------------------- ייבוא תלמידים מאקסל
/**
 * הקובץ עצמו נקרא ומפוענח בדפדפן (js/excelImport.js, SheetJS) - כולל גזירת
 * username/password ותחתוך ת"ז ל-4 ספרות אחרונות. תעודת הזהות המלאה **לא
 * מגיעה לשרת בכלל** - זו הגנת הפרטיות הראשונה (השנייה: גם אם הייתה מגיעה,
 * לא הייתה נכתבת לגיליון).
 * students: [{firstName, lastName, username, password, last4Id, group, bodyPart, strategy}]
 */
function importRoster(students) {
  if (!students || !students.length) throw new Error('לא התקבלו תלמידים לייבוא');
  const usersSheet = getSheet(SHEET_USERS);
  const existing = sheetToObjects(usersSheet);
  const results = [];
  students.forEach(s => {
    if (!s.firstName || !s.username || !s.password) {
      results.push({ firstName: s.firstName, ok: false, error: 'שורה חסרה שדות חובה' });
      return;
    }
    if (existing.some(u => u.username === s.username)) {
      results.push({ firstName: s.firstName, username: s.username, ok: true, status: 'כבר קיים - לא נוצר מחדש' });
      return;
    }
    const studentId = 's_' + Utilities.getUuid().slice(0, 8);
    usersSheet.appendRow([studentId, s.username, sha256(s.password), true, 'student', s.firstName, s.lastName || '',
      s.last4Id || '', s.birthDateLabel || '', s.group || '', s.bodyPart || '', s.strategy || '', new Date()]);
    existing.push({ username: s.username }); // מונע כפילויות בתוך אותו קובץ
    results.push({ firstName: s.firstName, username: s.username, ok: true, status: 'נוצר' });
  });
  return { imported: results };
}

// -------------------------------------------------------------- נושא שבועי (FR-C6)
function getCurrentWeekInfo() {
  const topics = sheetToObjects(getSheet(SHEET_TOPICS));
  if (!topics.length) return { weekNumber: 0, topicText: '' };
  return topics[topics.length - 1];
}

function startNewWeek(topicText) {
  const sheet = getSheet(SHEET_TOPICS);
  const current = getCurrentWeekInfo();
  const nextWeek = (Number(current.weekNumber) || 0) + 1;
  sheet.appendRow([nextWeek, topicText || '', new Date()]);
  return { weekNumber: nextWeek, topicText: topicText || '' };
}

function updateCurrentWeekTopic(topicText) {
  const sheet = getSheet(SHEET_TOPICS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return startNewWeek(topicText);
  const lastRow = values.length; // 1-based, כולל header
  sheet.getRange(lastRow, 2).setValue(topicText || '');
  return { weekNumber: values[lastRow - 1][0], topicText: topicText || '' };
}

// -------------------------------------------------------------- הקשר תלמיד
function getStudentContext(studentId) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!user) throw new Error('תלמיד לא נמצא');
  const week = getCurrentWeekInfo();
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS)).filter(c => c.studentId === studentId);
  const thisWeekCheckIn = checkIns.find(c => Number(c.weekNumber) === Number(week.weekNumber));
  const lastGraded = checkIns.filter(c => c.status === 'graded').sort((a, b) => b.weekNumber - a.weekNumber)[0];
  return {
    firstName: user.firstName,
    bodyPart: user.bodyPart,
    strategy: user.strategy,
    group: user.group,
    weekNumber: week.weekNumber,
    topicText: week.topicText,
    priorSummary: lastGraded ? lastGraded.aiMemorySummary : '',
    gradedThisWeek: !!(thisWeekCheckIn && thisWeekCheckIn.status === 'graded'),
  };
}

// -------------------------------------------------------------- System Prompt מאוחד
function buildSystemPrompt(ctx) {
  return [
    '[זהות ותפקיד]',
    'אתה מנטור רפואי-טכנולוגי, מומחה למדעי הנתונים ובוחן פדגוגי. מטרתך היא לאתגר ולהעריך',
    'תלמידי כיתה י\' המפתחים מודל AI לאבחון רנטגן, באמצעות תשאול סוקרטי - וגם לשמש עוזר',
    'טכני/מקצועי חופשי מחוץ לחלק המוערך.',
    '',
    '[הקשר התלמיד]',
    'שם התלמיד: ' + ctx.firstName,
    'איבר ההתמחות: ' + ctx.bodyPart,
    'אסטרטגיית מחקר אישית: ' + ctx.strategy + ' (תקן = דאטה מושלם, הטיות = חוסר איזון, רעשים = הפרעות פיזיקליות)',
    'נושא השיעור השבועי: ' + (ctx.topicText || '(לא הוזן)'),
    'סיכום הצ\'ק-אין המוערך האחרון: ' + (ctx.priorSummary || '(אין - זה הצ\'ק-אין הראשון)'),
    '',
    ctx.gradedThisWeek
      ? '--- החלק המוערך של השבוע הזה כבר בוצע. פעל אך ורק לפי "מצב ב\'" למטה. ---'
      : [
        '--- מצב א\': החלק המוערך של השבוע (אם עוד לא בוצע) ---',
        '',
        'אם עוד לא הועלו 2 תמונות התקדמות + סיכום מילולי של השבוע - בקש זאת. הודע לתלמיד',
        'במפורש שאתה עומד לשאול אותו שאלות שיזכו אותו בציון.',
        '',
        'בניית השאלה הפותחת (חובה): שאלה אחת בלבד, המשלבת שלושה אלמנטים - (1) איבר',
        'ההתמחות, (2) מטרת האסטרטגיה האישית, (3) נושא השיעור השבועי. אסור שאלות "גוגל"',
        '(שינון עובדתי, כמו "כמה עצמות יש בכתף?"). חובה שאלות מבוססות-תרחיש שמציגות',
        'בעיה/קונפליקט קונקרטי מתוך העבודה שלו.',
        'דוגמה גרועה: "מה זה פיקסל?"',
        'דוגמה טובה (רעשים, אגן): "השבוע למדנו שרזולוציה היא רשת של פיקסלים. באסטרטגיית',
        'הרעשים שלך על איבר האגן, אם תוריד צילום ברזולוציה נמוכה מאוד, האם לדעתך המודל',
        'ייכשל בגלל חוסר יכולת לראות את קו השבר, או בגלל שהוא יבלבל פיקסלים גדולים עם',
        'מבנה סחוס? נמק את עמדתך."',
        '',
        'ניהול השיחה: שאל שאלה אחת בלבד והמתן לתשובה. בלי פסקאות ארוכות. סולם סוקרטי לפי',
        'איכות התשובה:',
        '  - נכונה אך שטחית -> "תוכל לתת לי דוגמה מתוך התמונות שאספת השבוע?"',
        '  - מתחמקת ("כן, זה ישפיע") -> "באילו מובנים? תאר לי את התהליך הלוגי."',
        '  - שגויה לגמרי -> אל תיתן את התשובה! הצג סתירה לוגית ("אבל אם זה נכון, איך תסביר',
        '    ש...?") כדי שהתלמיד יבין בעצמו שטעה.',
        'מקסימום 3 חילופי דברים (תורות).',
        '',
        'מתן ציון (בסוף השיחה המוערכת בלבד): 40% דיוק מדעי/מושגי (מונחים כמו רזולוציה,',
        'הנחתה, מטריצת פיקסלים, סחוס לעומת עצם, False Positives/Negatives) - 40% חיבור',
        'לאסטרטגיה האישית - 20% ביסוס ונימוק. רמות: 9-10 מצוין, 7-8 טוב, 5-6 חלקי, 1-4',
        'דורש שיפור ניכר. אזהרה: אל תהיה רך מדי - תשובות של מילה אחת/חוסר הבנה מוחלט',
        'מקבלות ציון נמוך (4-6) עם הסבר.',
        '',
        'פורמט סיום חובה, מדויק:',
        '"תודה על התשובות, ' + ctx.firstName + '. ציון ההערכה לשבוע זה: [ציון מ-1 עד 10].',
        'משוב מנטור: [משפט חיזוק חיובי ספציפי, ומשפט אחד המציג נקודה לשיפור או שאלה',
        'פתוחה למחשבה לקראת השבוע הבא]."',
        '',
        'מיד אחרי הודעת הסיום הזו, כתוב שורה נוספת בפורמט המדויק הבא (לשימוש פנימי של',
        'המערכת, לא לתלמיד):',
        '###SUMMARY### <סיכום קצר של השיחה לזיכרון השבוע הבא>',
        '',
        '--- מצב ב\': בכל שאר ההודעות (לפני/אחרי החלק המוערך, או אם כבר בוצע השבוע) ---',
      ].join('\n'),
    '',
    'אתה עוזר חופשי, לא מוערך. תפקידך:',
    '1. הכוונה כללית על הפרויקט בגישה סוקרטית - הנחה בשאלות מנחות ורמזים, לעולם אל תמסור',
    '   תשובה סופית, מסקנה מוכנה, או פתרון מוכן (אל תסווג תמונה עבורו, אל תכתוב עבורו',
    '   מסקנת מחקר). אם הוא מבקש ישירות "תן לי את התשובה" - הכוון אותו לחשוב בשלבים.',
    '2. סיוע טכני בהפעלת כלי אימון חיצוניים (כגון Teachable Machine) - הסבר שלבים, עזרה',
    '   בפתרון תקלות נפוצות.',
    '3. מענה מקצועי ומדויק על שאלות בתחום הרפואה והדימות הרפואי (אנטומיה, פיזיקת קרינת',
    '   רנטגן, מינוח), ברמה המתאימה לתלמיד תיכון.',
    'במצב ב\' אל תזכיר ציונים ואל תיתן ציון.',
  ].join('\n');
}

// -------------------------------------------------------------- שיחת ה-AI Mentor
/**
 * history: מערך {role: 'user'|'model', text: string} - כל היסטוריית השיחה הנוכחית
 * (הלקוח שומר ושולח אותה בכל פעם - השרת חסר מצב בין קריאות).
 * images: מערך עד 2 {base64, mimeType} - רק בהודעה הראשונה של צ'ק-אין חדש.
 */
function sendMentorMessage(studentId, history, images, elapsedSeconds) {
  const ctx = getStudentContext(studentId);
  const systemPrompt = buildSystemPrompt(ctx);

  const contents = (history || []).map((turn, idx) => {
    const parts = [{ text: turn.text }];
    if (idx === 0 && images && images.length && !ctx.gradedThisWeek) {
      images.forEach(img => {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
      });
    }
    return { role: turn.role === 'model' ? 'model' : 'user', parts };
  });

  const raw = callGemini(systemPrompt, contents);
  const summaryMatch = raw.match(/###SUMMARY###\s*([\s\S]*)$/);
  const visibleText = raw.replace(/###SUMMARY###[\s\S]*$/, '').trim();
  const scoreMatch = visibleText.match(/ציון ההערכה לשבוע זה:\s*\[?(\d{1,2})\]?/);

  const result = { reply: visibleText, graded: false };

  if (scoreMatch && !ctx.gradedThisWeek) {
    const score = Math.max(1, Math.min(10, Number(scoreMatch[1])));
    const aiMemorySummary = summaryMatch ? summaryMatch[1].trim() : '';
    saveGradedCheckIn(studentId, ctx.weekNumber, images, history.concat([{ role: 'model', text: visibleText }]),
      aiMemorySummary, visibleText, score, elapsedSeconds);
    result.graded = true;
    result.score = score;
  } else {
    appendHelpChatTurn(studentId, ctx.weekNumber, history.concat([{ role: 'model', text: visibleText }]));
  }
  return result;
}

function callGemini(systemPrompt, contents) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('לא הוגדר GEMINI_API_KEY ב-Script Properties (ראו README)');
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };
  const url = GEMINI_API_BASE + geminiModel() + ':generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.error) {
    throw new Error('שגיאת Gemini (מודל: ' + geminiModel() + '): ' + data.error.message +
      '\nהריצו את listAvailableModels בעורך ה-Apps Script כדי לראות אילו מודלים זמינים לכם.');
  }
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('Gemini לא החזיר תשובה (ייתכן שנחסם ע"י מסנני בטיחות)');
  return candidate.content.parts.map(p => p.text || '').join('');
}

/**
 * כלי אבחון - להרצה ידנית מעורך ה-Apps Script בלבד (לא חשוף כ-API).
 * בוחרים את הפונקציה בתפריט העליון, לוחצים ▶ Run, ואז פותחים את
 * "יומן ביצוע / Execution log" כדי לראות אילו מודלים המפתח שלכם יכול להריץ.
 * שימושי כשגוגל מוציאה משימוש מודל וההודעה "no longer available" מופיעה.
 */
function listAvailableModels() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('לא הוגדר GEMINI_API_KEY ב-Script Properties');
  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + apiKey,
    { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  if (data.error) throw new Error('שגיאה בשליפת רשימת המודלים: ' + data.error.message);

  const usable = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1)
    .map(m => m.name.replace('models/', ''));

  Logger.log('המודל שמוגדר כרגע: ' + geminiModel());
  Logger.log('נמצאו ' + usable.length + ' מודלים זמינים ליצירת תוכן:');
  usable.forEach(name => Logger.log('  ' + name));
  Logger.log('\nלהחלפה: Project Settings ← Script Properties ← מאפיין GEMINI_MODEL עם השם המבוקש.');
  return usable;
}

// -------------------------------------------------------------- שמירת אירועי הערכה/עזרה
function saveGradedCheckIn(studentId, weekNumber, images, fullHistory, aiMemorySummary, mentorFeedback, score, elapsedSeconds) {
  const studentSummary = (fullHistory[0] && fullHistory[0].text) || '';
  const image1Url = images && images[0] ? saveImageToDrive(studentId, weekNumber, 1, images[0]) : '';
  const image2Url = images && images[1] ? saveImageToDrive(studentId, weekNumber, 2, images[1]) : '';
  const docLink = createWeeklyDoc(studentId, weekNumber, fullHistory, image1Url, image2Url);
  const checkInId = 'ci_' + Utilities.getUuid().slice(0, 8);
  getSheet(SHEET_CHECKINS).appendRow([
    checkInId, studentId, weekNumber, new Date(), image1Url, image2Url, studentSummary,
    JSON.stringify(fullHistory), aiMemorySummary, mentorFeedback, score, '', '', docLink, elapsedSeconds || '', 'graded',
  ]);
}

function appendHelpChatTurn(studentId, weekNumber, fullHistory) {
  const sheet = getSheet(SHEET_HELPCHATS);
  const rows = sheetToObjects(sheet);
  const existing = rows.find(r => r.studentId === studentId && Number(r.weekNumber) === Number(weekNumber));
  if (existing) {
    sheet.getRange(existing.__row, 5).setValue(JSON.stringify(fullHistory));
  } else {
    const logId = 'hc_' + Utilities.getUuid().slice(0, 8);
    sheet.appendRow([logId, studentId, weekNumber, new Date(), JSON.stringify(fullHistory)]);
  }
}

function saveImageToDrive(studentId, weekNumber, idx, image) {
  const folder = getOrCreateFolderPath(['AI Mentor - תמונות תלמידים', studentId]);
  const blob = Utilities.newBlob(Utilities.base64Decode(image.base64), image.mimeType,
    'week' + weekNumber + '_img' + idx);
  const file = folder.createFile(blob);
  return file.getUrl();
}

function getOrCreateFolderPath(pathParts) {
  let folder = DriveApp.getRootFolder();
  pathParts.forEach(name => {
    const it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

/** יוצר/מעדכן קובץ Google Docs מצטבר לתלמיד, עם סעיף חדש לכל שבוע מוערך */
function createWeeklyDoc(studentId, weekNumber, fullHistory, image1Url, image2Url) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  const folder = getOrCreateFolderPath(['AI Mentor - יומני תלמידים']);
  const docName = 'יומן AI Mentor - ' + (user ? user.firstName + ' ' + user.lastName : studentId);
  const files = folder.getFilesByName(docName);
  let doc;
  if (files.hasNext()) {
    doc = DocumentApp.openById(files.next().getId());
  } else {
    doc = DocumentApp.create(docName);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
  }
  const body = doc.getBody();
  body.appendParagraph('שבוע ' + weekNumber + ' - ' + new Date().toLocaleDateString('he-IL')).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  fullHistory.forEach(turn => {
    body.appendParagraph((turn.role === 'user' ? 'תלמיד: ' : 'AI: ') + turn.text);
  });
  if (image1Url) body.appendParagraph('תמונה 1: ' + image1Url);
  if (image2Url) body.appendParagraph('תמונה 2: ' + image2Url);
  body.appendHorizontalRule();
  doc.saveAndClose();
  return doc.getUrl();
}

// -------------------------------------------------------------- דשבורד למורה
/** ציון רכיב ה-AI Mentor לפי FR-B10: 80% מהנקודות האפשריות = ציון 100 */
function computeMentorGrade(scores, totalWeeksSoFar) {
  const accumulated = scores.reduce((s, v) => s + v, 0);
  const pointsFor100 = 0.8 * totalWeeksSoFar * 10;
  const grade = pointsFor100 > 0 ? Math.min(100, Math.round((accumulated / pointsFor100) * 100)) : 0;
  const surplusPoints = Math.max(0, accumulated - pointsFor100);
  return { grade, surplusPoints, accumulated };
}

function getDashboard() {
  const users = sheetToObjects(getSheet(SHEET_USERS)).filter(u => u.role === 'student');
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS));
  const week = getCurrentWeekInfo();
  return users.map(u => {
    const mine = checkIns.filter(c => c.studentId === u.studentId);
    const scores = mine.map(c => Number(c.teacherOverrideScore || c.score) || 0);
    const totalWeeksSoFar = Number(week.weekNumber) || mine.length || 1;
    const { grade, surplusPoints } = computeMentorGrade(scores, totalWeeksSoFar);
    const doneThisWeek = mine.some(c => Number(c.weekNumber) === Number(week.weekNumber) && c.status === 'graded');
    return {
      studentId: u.studentId, firstName: u.firstName, lastName: u.lastName,
      group: u.group, bodyPart: u.bodyPart, strategy: u.strategy,
      weeksCompleted: mine.length, mentorGrade: grade, surplusPoints,
      doneThisWeek, lastScore: mine.length ? scores[scores.length - 1] : null,
    };
  });
}

function getStudentTranscripts(studentId) {
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS)).filter(c => c.studentId === studentId)
    .map(c => Object.assign({}, c, { transcript: JSON.parse(c.transcriptJson || '[]') }));
  const helpChats = sheetToObjects(getSheet(SHEET_HELPCHATS)).filter(c => c.studentId === studentId)
    .map(c => Object.assign({}, c, { transcript: JSON.parse(c.transcriptJson || '[]') }));
  return { checkIns, helpChats };
}

function setManualGrade(checkInId, score, note) {
  const sheet = getSheet(SHEET_CHECKINS);
  const rows = sheetToObjects(sheet);
  const row = rows.find(r => r.checkInId === checkInId);
  if (!row) throw new Error('צ\'ק-אין לא נמצא');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(row.__row, headers.indexOf('teacherOverrideScore') + 1).setValue(score);
  sheet.getRange(row.__row, headers.indexOf('teacherNote') + 1).setValue(note || '');
  return { ok: true };
}

// -------------------------------------------------------------- ייצוא שבועי (FR-C5)
function exportWeeklyReport() {
  const users = sheetToObjects(getSheet(SHEET_USERS)).filter(u => u.role === 'student');
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS));
  const grades = {}; // group -> קבוצה, לתיקיית שכבה אחת בסיסית (ניתן להרחיב לפי שכבה אמיתית אם יש שדה נפרד)
  const reportName = 'דוח AI Mentor - ' + new Date().toLocaleDateString('he-IL');
  const folder = getOrCreateFolderPath(['AI Mentor - דוחות שבועיים']);
  const existingFiles = folder.getFilesByName(reportName);
  let ss;
  if (existingFiles.hasNext()) {
    ss = SpreadsheetApp.openById(existingFiles.next().getId());
  } else {
    ss = SpreadsheetApp.create(reportName);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  }

  users.forEach(u => {
    const name = (u.firstName + ' ' + u.lastName).trim().slice(0, 90) || u.studentId;
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(['שבוע', 'ציון שבועי', 'קישור ליומן Docs', 'זמן פעילות (שניות)', 'הערכת AI לתפקוד']);
      sheet.setFrozenRows(1);
    } else {
      sheet.clearContents();
      sheet.appendRow(['שבוע', 'ציון שבועי', 'קישור ליומן Docs', 'זמן פעילות (שניות)', 'הערכת AI לתפקוד']);
    }
    const mine = checkIns.filter(c => c.studentId === u.studentId).sort((a, b) => a.weekNumber - b.weekNumber);
    mine.forEach(c => {
      sheet.appendRow([c.weekNumber, c.teacherOverrideScore || c.score || 0, c.docLink || '',
        c.sessionSeconds || '', c.mentorFeedback || '']);
    });
  });
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  return { url: ss.getUrl() };
}

/** מתקין (פעם אחת, ידנית מהעורך) הרצה אוטומטית שבועית של הייצוא */
function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'exportWeeklyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('exportWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).create();
  return { ok: true };
}
