// ==========================================================================
// excelImport.js - פרשור קובץ Excel של תלמידים + חישוב פרטי התחברות.
// משתמש בספריית SheetJS הגלובלית (XLSX) שנטענת ב-index.html.
//
// הערת פרטיות: תעודת הזהות המלאה נקראת מהקובץ *רק בדפדפן*, משמשת לחישוב
// 4 הספרות האחרונות (לשם המשתמש) ואז נזרקת - היא לעולם לא מוחזרת מהפונקציה
// הזו ולא נשלחת לשרת (ראו FR-A3/NFR-2 באפיון).
// ==========================================================================

const HEADER_ALIASES = {
  firstName: ['שם פרטי'],
  lastName: ['שם משפחה'],
  idNumber: ['תעודת זהות מלאה', 'ת.ז', 'ת"ז', 'ת״ז', 'תעודת זהות', 'תז'],
  dob: ['תאריך לידה'],
  group: ['קבוצה'],
  bodyPart: ['איבר התמחות קבוצתי', 'איבר התמחות', 'איבר'],
  strategy: ['אסטרטגיית מודל - תפקיד', 'אסטרטגיית מודל', 'אסטרטגיה'],
};
const FIELD_LABELS = {
  firstName: 'שם פרטי', lastName: 'שם משפחה', idNumber: 'תעודת זהות מלאה',
  dob: 'תאריך לידה', group: 'קבוצה', bodyPart: 'איבר התמחות קבוצתי', strategy: 'אסטרטגיית מודל',
};
const VALID_STRATEGIES = ['תקן', 'הטיות', 'רעשים'];

function normalizeHeader(h) {
  return String(h || '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
}

function buildFieldMap(sampleRow) {
  const rawHeaders = Object.keys(sampleRow);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const found = rawHeaders.find(h => normalizedAliases.includes(normalizeHeader(h)));
    if (found) map[field] = found;
  }
  return map;
}

/** מפרש ערך תאריך לידה (Date אמיתי מ-SheetJS, או מחרוזת DD/MM/YYYY וכדומה). */
export function parseDob(value) {
  if (value instanceof Date && !isNaN(value)) {
    return {
      dd: String(value.getDate()).padStart(2, '0'),
      mm: String(value.getMonth() + 1).padStart(2, '0'),
      yy: String(value.getFullYear() % 100).padStart(2, '0'),
    };
  }
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10);
  let year = m[3];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  year = year.length === 4 ? year.slice(2) : year.padStart(2, '0');
  return { dd: String(day).padStart(2, '0'), mm: String(month).padStart(2, '0'), yy: year };
}

/** שם משתמש = שם פרטי + 4 הספרות האחרונות של ת.ז, עם דה-דופ (_2, _3...). */
export function deriveUsername(firstName, idNumber, takenSet) {
  const digits = String(idNumber || '').replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '0');
  const base = firstName.trim() + last4;
  let candidate = base;
  let i = 2;
  while (takenSet.has(candidate)) {
    candidate = `${base}_${i}`;
    i += 1;
  }
  takenSet.add(candidate);
  return { username: candidate, last4 };
}

function isBlankRow(row, fieldMap) {
  return Object.values(fieldMap).every(key => String(row[key] ?? '').trim() === '');
}

/**
 * מפרש קובץ Excel של תלמידים ומחזיר { valid, invalid }.
 * @param {File} file
 * @param {string[]} existingUsernames - שמות משתמש קיימים כבר במערכת (למניעת התנגשות)
 */
export async function parseStudentsExcel(file, existingUsernames = []) {
  if (typeof XLSX === 'undefined') {
    throw new Error('ספריית קריאת ה-Excel לא נטענה. ודאו חיבור אינטרנט ורעננו את הדף.');
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rows.length) {
    return { valid: [], invalid: [{ row: 0, reason: 'הקובץ ריק, או שלא נמצאו כותרות עמודות בשורה הראשונה.' }] };
  }

  const fieldMap = buildFieldMap(rows[0]);
  const missingFields = Object.keys(HEADER_ALIASES).filter(f => !fieldMap[f]);
  if (missingFields.length) {
    return {
      valid: [],
      invalid: [{ row: 0, reason: `עמודות חסרות בקובץ: ${missingFields.map(f => FIELD_LABELS[f]).join(', ')}` }],
    };
  }

  const takenUsernames = new Set(existingUsernames);
  const valid = [];
  const invalid = [];

  rows.forEach((row, i) => {
    const excelRow = i + 2; // שורה 1 = כותרות
    if (isBlankRow(row, fieldMap)) return; // דילוג שקט על שורות ריקות

    const firstName = String(row[fieldMap.firstName] ?? '').trim();
    const lastName = String(row[fieldMap.lastName] ?? '').trim();
    const idNumber = String(row[fieldMap.idNumber] ?? '').trim(); // נקרא כאן בלבד, לא מוחזר
    const dobRaw = row[fieldMap.dob];
    const group = String(row[fieldMap.group] ?? '').trim();
    const bodyPart = String(row[fieldMap.bodyPart] ?? '').trim();
    const strategy = String(row[fieldMap.strategy] ?? '').trim();

    if (!firstName || !lastName || !idNumber || !dobRaw || !group || !bodyPart || !strategy) {
      invalid.push({ row: excelRow, reason: 'חסרים שדות חובה בשורה.' });
      return;
    }
    const dob = parseDob(dobRaw);
    if (!dob) {
      invalid.push({ row: excelRow, reason: `תאריך לידה לא תקין ("${dobRaw}"). פורמט צפוי: DD/MM/YYYY.` });
      return;
    }
    if (!VALID_STRATEGIES.includes(strategy)) {
      invalid.push({ row: excelRow, reason: `אסטרטגיה לא מוכרת: "${strategy}" (צפוי: ${VALID_STRATEGIES.join('/')}).` });
      return;
    }

    const { username, last4 } = deriveUsername(firstName, idNumber, takenUsernames);
    const password = dob.dd + dob.mm + dob.yy;
    valid.push({
      excelRow, firstName, lastName, displayName: `${firstName} ${lastName}`,
      last4Id: last4, birthDateLabel: `${dob.dd}/${dob.mm}/${dob.yy}`, group, bodyPart, strategy,
      username, password,
    });
    // idNumber המלא לא נשמר באובייקט המוחזר - נזרק כאן.
  });

  return { valid, invalid };
}
