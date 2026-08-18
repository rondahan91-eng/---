// ==========================================================================
// config.js - הגדרות גלובליות של המערכת
// ==========================================================================
// לאחר פריסת ה-Google Apps Script כ-Web App, הדביקו כאן את כתובת ה-URL שקיבלתם.
// כל עוד השדה ריק, האפליקציה תעבוד במצב פיתוח מקומי (DEV MODE) שמדמה את
// השרת באמצעות localStorage - כך אפשר לבדוק הכל בלי לפרוס שום דבר בגוגל.
// שימו לב: שיחת ה-AI Mentor עצמה דורשת שרת אמיתי (מפתח Gemini) - במצב פיתוח
// היא מוצגת כתשובות מדומות קבועות, לצורך בדיקת הממשק בלבד.
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxobWUS683la3WOoupio2PrvBsl0wQppn0UDU57TSt6uCCQ64R5zZNnAIATtFKeeYz6/exec',
  APP_NAME: 'AI Mentor - הנדסה ביו-רפואית',
  SESSION_KEY: 'ai-mentor-biorefua-session',
};

// כלי הניתוח הם קבצים עצמאיים ואינם מייבאים את המודול הזה. הם קוראים את
// כתובת השרת מכאן דרך localStorage, כך שהתיוק האוטומטי עובד ברגע שהמערכת
// נטענה פעם אחת באותו דפדפן - בלי לשכפל את הכתובת בשלושה קבצים.
try { localStorage.setItem('ai-mentor-api-url', CONFIG.API_URL || ''); } catch {}
