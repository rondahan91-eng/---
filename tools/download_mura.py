"""
הורדת מאגר MURA מ-Redivis, בבת אחת, ואימות שלמות מול קובץ האינדקס.

לפני ההרצה:
  1) pip install redivis
  2) צור טוקן ב-Redivis:  Workspace -> Settings -> API tokens
  3) הגדר אותו כמשתנה סביבה (הטוקן לא נכתב לקובץ ולא נכנס ל-git):

     PowerShell:   $env:REDIVIS_API_TOKEN = "הטוקן-שלך"
     Git Bash:     export REDIVIS_API_TOKEN="הטוקן-שלך"

  4) py tools/download_mura.py

את המזהים (ORG / DATASET / TABLE) אפשר להעתיק מדף המאגר ב-Redivis:
בכל קובץ יש "הפניה ל-API" שמציג את הנתיב המלא.
"""
import csv
import os
import sys
from pathlib import Path

# --- הגדרות: עדכן לפי מה שמופיע ב-Redivis ---------------------------------
# מזהים מאומתים מול השרת (ראו tools/discover_redivis.py).
# הסיומות ":cv1a" ו-":gcvw" הן מזהי-הפניה שמומלצים ע"י Redivis עצמה - הם
# יציבים גם אם השם התצוגתי ישתנה.
# הערה: שם הטבלה התצוגתי הוא "MURA-v1.1", אבל *אי אפשר* להשתמש בו כהפניה
# כי הנקודה שבו מפצלת את ההפניה ליותר מדי חלקים והשרת דוחה אותה.
ORG = 'AIMI'
DATASET = 'mura_msk_xrays:cv1a'
TABLE = 'mura_v1_1:gcvw'

# יעד ההורדה. מכוון שהוא *לצד* תיקיית הפרויקט ולא בתוכה: 3.1GB של תמונות
# לא אמורים להיכנס למאגר ה-git, וגם אין סיבה שיסונכרנו ל-GitHub.
OUT_DIR = Path(r'C:\Users\ronda\Desktop\קבצים להנדסה ביו-רפואית')

# ספריית redivis שולחת את נתיב היעד בכותרת HTTP, וכותרות HTTP מוגבלות ל-latin-1.
# נתיב עם עברית מפיל אותה ב-UnicodeEncodeError, ולכן מורידים לתיקיית ביניים
# באנגלית ומעבירים ל-OUT_DIR בסיום.
STAGING_DIR = Path(r'C:\mura_download')

INDEX_CSV = Path(r'C:\Users\ronda\Downloads\mura_v1_1.csv')
# ---------------------------------------------------------------------------


def _get_table():
    """מתחבר ומחזיר את הטבלה, עם הודעות שגיאה שמכוונות לתיקון המזהים."""
    token = os.environ.get('REDIVIS_API_TOKEN', '')
    if not token:
        sys.exit('REDIVIS_API_TOKEN is not set. See instructions at the top of this file.')

    # הטוקן נשלח בכותרת HTTP, שמוגבלת ל-latin-1. תו לא-אנגלי מפיל את הבקשה
    # עמוק בתוך urllib3 עם שגיאה שלא מרמזת על הטוקן, ולכן בודקים כאן מראש.
    if not token.isascii():
        bad = [(i, repr(c)) for i, c in enumerate(token) if not c.isascii()][:5]
        sys.exit(
            'REDIVIS_API_TOKEN contains non-ASCII characters and cannot be sent.\n'
            f'  length: {len(token)}\n'
            f'  first offending chars (index, char): {bad}\n\n'
            'This usually means the placeholder text was copied instead of the real\n'
            'token. Set it again with the actual token from Redivis:\n'
            '  Workspace -> Settings -> API tokens')
    if token != token.strip():
        os.environ['REDIVIS_API_TOKEN'] = token.strip()
    try:
        import redivis
    except ImportError:
        sys.exit('redivis is not installed. Run:  py -m pip install redivis')

    try:
        return redivis.organization(ORG).dataset(DATASET).table(TABLE)
    except Exception as e:
        sys.exit(
            f'Could not reach the table.\n'
            f'  ORG     = {ORG}\n'
            f'  DATASET = {DATASET}\n'
            f'  TABLE   = {TABLE}\n'
            f'Error: {e}\n\n'
            'Fix the three values at the top of this file. The exact values appear\n'
            'on the Redivis dataset page, under the per-file API reference link.')


def check():
    """
    בדיקה לפני הורדה של 3GB.
    חשוב: חייבת לבצע פנייה *מאומתת* לשרת. גרסה קודמת רק בנתה אובייקט מקומי
    והדפיסה את המזהים שסופקו לה - כלומר עברה בהצלחה גם עם טוקן פסול.
    """
    table = _get_table()
    print('Contacting Redivis ...')
    try:
        table.get()   # מאלץ בקשת רשת מאומתת
    except AttributeError:
        _ = table.properties   # חלופה אם ה-API השתנה
    except Exception as e:
        sys.exit(f'[FAIL] Server rejected the request.\n  {type(e).__name__}: {e}\n\n'
                 'Common causes: invalid API token, or the dataset usage terms\n'
                 'have not been accepted yet on the Redivis website.')

    print('[OK] Authenticated and table reachable.')
    props = getattr(table, 'properties', None) or {}
    for k in ('name', 'numRows', 'numFiles', 'totalBytes'):
        if k in props:
            v = props[k]
            print(f'   {k}: {v:,}' if isinstance(v, int) else f'   {k}: {v}')
    print('\nAll good. Run without --check to start the download.')


def download():
    table = _get_table()
    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    print(f'Downloading to staging dir {STAGING_DIR} ... (3.1 GB, this will take a while)')
    # overwrite=False מאפשר להריץ שוב אחרי ניתוק - ימשיך מהמקום שנעצר
    table.download_files(path=str(STAGING_DIR), overwrite=False)
    print('Download finished.')
    _move_to_final()


def _move_to_final():
    """מעביר מתיקיית הביניים ליעד הסופי (זה שיכול להכיל עברית)."""
    import shutil

    entries = list(STAGING_DIR.iterdir()) if STAGING_DIR.exists() else []
    if not entries:
        print('Staging dir is empty, nothing to move.')
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f'Moving {len(entries)} item(s) to {OUT_DIR} ...')
    for item in entries:
        target = OUT_DIR / item.name
        if target.exists():
            # מיזוג במקום דריסה, כדי שהרצה חוזרת לא תמחק מה שכבר הועבר
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
                shutil.rmtree(item)
            else:
                item.replace(target)
        else:
            shutil.move(str(item), str(target))

    try:
        STAGING_DIR.rmdir()
    except OSError:
        pass
    print('Move complete.')


def verify():
    """משווה את מה שהורד מול האינדקס: כמה קבצים הגיעו וכמה חסרים."""
    if not INDEX_CSV.exists():
        print(f'Index CSV not found at {INDEX_CSV} - skipping verification.')
        return

    expected = {}
    with open(INDEX_CSV, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            name = row.get('file_name')
            if name and name.lower().endswith('.png'):
                expected[name] = int(row['size'])

    found = missing = wrong_size = 0
    for rel, size in expected.items():
        # הקבצים עשויים לרדת עם או בלי תיקיית-על בשם המאגר
        for cand in (OUT_DIR / rel, OUT_DIR / TABLE / rel):
            if cand.exists():
                found += 1
                if cand.stat().st_size != size:
                    wrong_size += 1
                break
        else:
            missing += 1

    print('\n--- Integrity check ---')
    print(f'expected: {len(expected):,}')
    print(f'found:    {found:,}')
    print(f'missing:  {missing:,}')
    print(f'bad size: {wrong_size:,}')
    if missing == 0 and wrong_size == 0:
        print('[OK] Dataset is complete.')
    else:
        print('[!] Run the script again - it resumes where it stopped.')


if __name__ == '__main__':
    if '--check' in sys.argv:
        check()
    elif '--move-only' in sys.argv:
        # להשלמת העברה שנקטעה: מעביר את מה שכבר ירד, בלי להוריד עוד
        _move_to_final()
        verify()
    elif '--verify-only' in sys.argv:
        verify()
    else:
        download()
        verify()
