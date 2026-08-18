/**
 * תיוק אוטומטי של תוצרי הכלים.
 *
 * הקובץ הזה אינו נטען כ-script נפרד: הוא מקור האמת, ומועתק כלשונו לתוך
 * שלושת הכלים. הכלים נשארים קובץ בודד שעובד גם בלי שרת, וזו תכונה שאני
 * לא רוצה לאבד - תלמיד/ה שפותח/ת אותם מהדיסק צריך/ה שהם יעבדו.
 *
 * העיקרון: כל ייצוא אקטיבי יורד למחשב *וגם* מתויק בשרת, אם יש התחברות.
 * הורדה תמיד מתרחשת - גם אם התיוק נכשל - כדי שהתלמיד/ה לא יאבד/תאבד
 * את התוצר בגלל תקלת רשת.
 */

const SESSION_KEY = 'ai-mentor-biorefua-session';
const API_KEY_LS  = 'ai-mentor-api-url';
const WHO_KEY     = 'ai-mentor-who';

function sessionUser() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function apiUrl() {
  return localStorage.getItem(API_KEY_LS) || '';
}
/** מתויק רק כשיש גם טוקן וגם כתובת שרת. אחרת - הורדה מקומית בלבד. */
function filingEnabled() {
  const u = sessionUser();
  return !!(u && u.token && apiUrl());
}

/**
 * שולח קובץ לשרת. השרת מזהה את התלמיד/ה מהטוקן, ולכן אין כאן studentId -
 * שדה כזה היה מאפשר לתייק בשם מישהו אחר.
 */
async function fileToServer(kind, filename, blob) {
  const u = sessionUser();
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('קריאת הקובץ נכשלה'));
    r.readAsDataURL(blob);
  });
  const resp = await fetch(apiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // מונע preflight מול Apps Script
    body: JSON.stringify({ action: 'saveArtifact', token: u.token,
                           kind, filename, mimeType: blob.type, base64 }),
  });
  const data = await resp.json();
  // מבנה התשובה של השרת: {ok, result} או {ok:false, error} - זהה ל-api.js
  if (!data.ok) throw new Error(data.error || 'התיוק נכשל');
  return data.result;
}

/**
 * מוריד למחשב ומתייק. מחזיר תיאור קצר למסך.
 * blobOrCanvas: Blob, canvas, או מחרוזת טקסט.
 */
async function exportArtifact(kind, filename, source, mimeType) {
  let blob;
  // instanceof נשבר בין חלונות: שם Blob הוא בנאי אחר, והבדיקה נכשלת בשקט
  const isBlob = o => o && Object.prototype.toString.call(o) === '[object Blob]';
  if (isBlob(source)) blob = source;
  else if (source && source.tagName === 'CANVAS')
    blob = await new Promise(r => source.toBlob(r, 'image/png'));
  else blob = new Blob(['﻿' + source], { type: mimeType || 'text/csv;charset=utf-8' });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);

  if (!filingEnabled()) return { filed: false, reason: 'לא מחובר/ת — הקובץ ירד למחשב בלבד' };
  try {
    const r = await fileToServer(kind, filename, blob);
    return { filed: true, url: r.url, folder: r.kind };
  } catch (e) {
    return { filed: false, reason: 'התיוק נכשל: ' + e.message + ' — הקובץ ירד למחשב' };
  }
}
