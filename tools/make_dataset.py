"""
מארגן גנרי: ממאגר גולמי לתיקיות עבודה (benchmark + pool).

עובד על כל מאגר שבנוי כתיקיית-על עם תת-תיקייה לכל מחלקה.

העיקרון החשוב - קיבוץ:
תמונות רבות במאגרים רפואיים חולקות מקור אחד: אותו מטופל, אותה שקופית,
אותה בדיקה. אם שתיים מהן מתפצלות בין אימון למבחן, המודל יכול לזהות את
*המקור* במקום את *הממצא*, והציון מתנפח בלי שאיש ישים לב.
--group-regex מגדיר איך לחלץ את מזהה המקור משם הקובץ, וכל קבוצה הולכת
בשלמותה לצד אחד בלבד.

  מלריה:   "(.+?)_cell_"            -> מזהה שקופית
  ריאות:   "(person\\d+_\\w+?)_"      -> מטופל+סוג
  ללא:     לא לציין - כל תמונה עצמאית

הרצה:
    py tools/make_dataset.py --source <raw> --out <work> --group-regex "(.+?)_cell_"
"""
import argparse
import csv
import random
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

EXTS = ('.png', '.jpg', '.jpeg')
SEED = 20260817


def class_dirs(root: Path):
    out = []
    for d in sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name.lower()):
        if any(f.suffix.lower() in EXTS for f in d.iterdir() if f.is_file()):
            out.append(d)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--bench-per-class', type=int, default=100)
    ap.add_argument('--pool-per-class', type=int, default=800)
    ap.add_argument('--group-regex', default=None)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    src, out = Path(args.source), Path(args.out)
    if not src.is_dir():
        sys.exit(f'לא נמצא: {src}')
    classes = class_dirs(src)
    if len(classes) < 2:
        sys.exit(f'נדרשות לפחות שתי תת-תיקיות מחלקה תחת {src}')

    rx = re.compile(args.group_regex) if args.group_regex else None
    rng = random.Random(SEED)

    print(f'Source: {src}')
    print(f'Output: {out}')
    print(f'Mode:   {"DRY RUN" if args.dry_run else "COPY"}')
    print(f'Group:  {args.group_regex or "(none - each image independent)"}\n')

    rows, summary = [], []
    for d in classes:
        files = [f for f in sorted(d.iterdir())
                 if f.is_file() and f.suffix.lower() in EXTS]
        groups = defaultdict(list)
        for f in files:
            m = rx.match(f.name) if rx else None
            groups[m.group(1) if m else f.name].append(f)

        keys = sorted(groups)
        rng.shuffle(keys)

        # ה-benchmark נבחר ראשון, ברמת קבוצה. ה-pool נבנה ממה שנשאר בלבד,
        # ולכן אף מקור לא יכול להופיע בשני הצדדים.
        def take(key_list, target):
            used, picked = [], []
            for k in key_list:
                if len(picked) >= target:
                    break
                used.append(k)
                picked.extend(groups[k])
            return set(used), picked[:target]

        bench_keys, bench = take(keys, args.bench_per_class)
        rest = [k for k in keys if k not in bench_keys]
        _, pool = take(rest, args.pool_per_class)

        for dest, imgs in (('benchmark', bench), ('pool', pool)):
            dd = out / dest / d.name
            if not args.dry_run:
                dd.mkdir(parents=True, exist_ok=True)
                for f in imgs:
                    shutil.copy2(f, dd / f.name)
            for f in imgs:
                rows.append([dest, d.name, f.name, str(f)])

        summary.append((d.name, len(files), len(groups), len(bench), len(pool)))

    print(f'{"class":<16}{"images":>9}{"groups":>9}{"bench":>8}{"pool":>8}')
    print('-' * 50)
    for r in summary:
        print(f'{r[0]:<16}{r[1]:>9,}{r[2]:>9,}{r[3]:>8}{r[4]:>8}')

    if not args.dry_run:
        out.mkdir(parents=True, exist_ok=True)
        with open(out / 'manifest.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['set', 'class', 'filename', 'source_path'])
            w.writerows(rows)

        bench_rows = [(r[2], r[1]) for r in rows if r[0] == 'benchmark']
        with open(out / 'benchmark_answers.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f); w.writerow(['image', 'true_label']); w.writerows(bench_rows)
        names = [r[0] for r in bench_rows]
        rng.shuffle(names)
        with open(out / 'benchmark_blank.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f); w.writerow(['image', 'my_label', 'confidence_1_5', 'notes'])
            for n in names:
                w.writerow([n, '', '', ''])

        print('\nOn disk:')
        for dest in ('benchmark', 'pool'):
            for d in classes:
                dd = out / dest / d.name
                n = len([f for f in dd.iterdir() if f.suffix.lower() in EXTS]) if dd.is_dir() else 0
                print(f'  {dest}/{d.name}: {n}')
        print('\n[OK] Done.')
    else:
        print('\nDry run only.')


if __name__ == '__main__':
    main()
