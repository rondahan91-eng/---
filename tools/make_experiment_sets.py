"""
מחולל ערכות אימון לניסויים.

בונה תיקיות מוכנות לגרירה ל-Teachable Machine, אחת לכל תנאי ניסוי.
עובד על כל מאגר שבנוי כתיקיית-על עם תת-תיקייה לכל מחלקה.

שלושת הניסויים:
  curve    - עקומת למידה: אותו יחס, גדלים עולים
  balance  - יחסי איזון: אותו סך הכל, יחסים שונים
  source   - הכללה: אימון על תת-מקור אחד בלבד

עקרון קריטי - קינון:
ערכת ה-50 מכילה את כל ה-25, ערכת ה-100 את כל ה-50, וכן הלאה. בלי זה,
הפרש בין שתי נקודות בעקומה עלול לנבוע מ*אילו* תמונות נבחרו ולא מ*כמה* -
והניסוי מודד רעש במקום מגמה.

הרצה:
    py tools/make_experiment_sets.py --source <pool> --out <dir> --experiment curve
    py tools/make_experiment_sets.py --source <pool> --out <dir> --experiment balance
    py tools/make_experiment_sets.py --source <pool> --out <dir> --experiment source \
        --group-a "IM-" --group-b "NORMAL2-"

    הוסיפו --exclude <benchmark_dir> כדי לוודא שאף תמונת מבחן לא נכנסת.
"""
import argparse
import csv
import random
import shutil
import sys
from pathlib import Path

CURVE_SIZES = [25, 50, 100, 200, 400]
BALANCE_TOTAL = 400            # סך הכל קבוע, רק היחס משתנה
BALANCE_RATIOS = [(50, 50), (70, 30), (90, 10)]
SEED = 20260817
EXTS = ('.png', '.jpg', '.jpeg')


def class_dirs(root: Path):
    ds = sorted((d for d in root.iterdir() if d.is_dir()),
                key=lambda p: p.name.lower())
    return [d for d in ds if any(f.suffix.lower() in EXTS for f in d.iterdir())]


def excluded_names(paths):
    """שמות קבצים שאסור להם להיכנס לאימון (בדרך כלל ערכת המבחן)."""
    names = set()
    for p in paths:
        p = Path(p)
        if p.is_dir():
            for f in p.rglob('*'):
                if f.suffix.lower() in EXTS:
                    names.add(f.name)
    return names


def write(sets, out_root, manifest_rows, dry):
    for rel, files in sets:
        dest = out_root / rel
        if not dry:
            dest.mkdir(parents=True, exist_ok=True)
            for f in files:
                shutil.copy2(f, dest / f.name)
        for f in files:
            manifest_rows.append([str(rel), dest.name, f.name, str(f)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True, help='בריכת תמונות: תיקייה עם תת-תיקיית מחלקה')
    ap.add_argument('--out', required=True)
    ap.add_argument('--experiment', required=True, choices=['curve', 'balance', 'source'])
    ap.add_argument('--exclude', nargs='*', default=[], help='תיקיות שתמונותיהן אסורות (benchmark)')
    ap.add_argument('--group-a', default=None, help='קידומת/מחרוזת שמזהה מקור א׳')
    ap.add_argument('--group-b', default=None)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    src, out = Path(args.source), Path(args.out)
    if not src.is_dir():
        sys.exit(f'לא נמצא: {src}')
    classes = class_dirs(src)
    if len(classes) < 2:
        sys.exit(f'נדרשות לפחות שתי תת-תיקיות מחלקה תחת {src}')

    banned = excluded_names(args.exclude)
    rng = random.Random(SEED)
    pools = {}
    for d in classes:
        files = sorted(f for f in d.iterdir()
                       if f.suffix.lower() in EXTS and f.name not in banned)
        rng.shuffle(files)
        pools[d.name] = files

    print(f'Source: {src}')
    print(f'Output: {out}')
    print(f'Mode:   {"DRY RUN" if args.dry_run else "COPY"}')
    if banned:
        print(f'Excluded {len(banned)} benchmark filenames')
    for k, v in pools.items():
        print(f'  {k}: {len(v)} available')
    print()

    sets, rows = [], []
    exp = args.experiment

    if exp == 'curve':
        # קינון: כל גודל הוא רישא של אותה רשימה מעורבבת
        for n in CURVE_SIZES:
            short = min(n, min(len(v) for v in pools.values()))
            if short < n:
                print(f'  [!] רק {short} זמינות - מדלג על {n}')
                continue
            for cls, files in pools.items():
                sets.append((Path(f'curve/n{n:04d}') / cls, files[:n]))

    elif exp == 'balance':
        names = list(pools)
        if len(names) != 2:
            sys.exit('ניסוי האיזון מוגדר לשתי מחלקות בלבד')
        for a_pct, b_pct in BALANCE_RATIOS:
            na = BALANCE_TOTAL * a_pct // 100
            nb = BALANCE_TOTAL * b_pct // 100
            if len(pools[names[0]]) < na or len(pools[names[1]]) < nb:
                print(f'  [!] אין מספיק תמונות ליחס {a_pct}/{b_pct} - מדלג')
                continue
            tag = f'balance/r{a_pct}_{b_pct}'
            sets.append((Path(tag) / names[0], pools[names[0]][:na]))
            sets.append((Path(tag) / names[1], pools[names[1]][:nb]))

    else:  # source
        if not (args.group_a and args.group_b):
            sys.exit('ניסוי ההכללה דורש --group-a ו---group-b')

        # מחלקה שאין בה את הדפוס אינה מסוננת אלא נשארת קבועה בשני התנאים.
        # כך היא משמשת בקרה, ומה שמשתנה הוא רק המקור של המחלקה השנייה -
        # וזה בדיוק מה שהניסוי אמור לבודד. מאגרים רפואיים כמעט תמיד מתחלקים
        # למקורות באופן שונה בכל מחלקה, ולכן סינון גורף היה מפיל את הניסוי.
        split_classes = [c for c, fs in pools.items()
                         if any(args.group_a.lower() in f.name.lower() for f in fs)
                         or any(args.group_b.lower() in f.name.lower() for f in fs)]
        fixed = [c for c in pools if c not in split_classes]
        if not split_classes:
            sys.exit(f'אף מחלקה לא מכילה "{args.group_a}" או "{args.group_b}".')
        print(f'  מפוצל לפי מקור: {", ".join(split_classes)}')
        if fixed:
            print(f'  קבוע כבקרה:     {", ".join(fixed)}')
        print()

        cap = 200
        for tag, needle in (('only_a', args.group_a), ('only_b', args.group_b)):
            for cls in split_classes:
                sub = [f for f in pools[cls] if needle.lower() in f.name.lower()]
                if len(sub) < 25:
                    print(f'  [!] "{needle}" ב-{cls}: רק {len(sub)} תמונות - ערכה קטנה')
                if sub:
                    sets.append((Path(f'source/{tag}') / cls, sub[:cap]))
            for cls in fixed:
                sets.append((Path(f'source/{tag}') / cls, pools[cls][:cap]))

    if not sets:
        sys.exit('לא נוצרה אף ערכה - בדקו את הפרמטרים.')

    write(sets, out, rows, args.dry_run)

    # דיווח נספר מהתוכנית, ואחריו אימות מהדיסק
    print(f'{"set":<22}{"class":<20}{"images":>8}')
    print('-' * 50)
    for rel, files in sets:
        print(f'{str(rel.parent):<22}{rel.name:<20}{len(files):>8}')

    if not args.dry_run:
        out.mkdir(parents=True, exist_ok=True)
        with open(out / 'manifest.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['set', 'class', 'filename', 'source_path'])
            w.writerows(rows)
        print('\nOn disk:')
        for d in sorted(p for p in out.rglob('*') if p.is_dir()):
            n = len([f for f in d.iterdir() if f.suffix.lower() in EXTS])
            if n:
                print(f'  {d.relative_to(out)}: {n}')
        print('\n[OK] Done.')
    else:
        print('\nDry run only.')


if __name__ == '__main__':
    main()
