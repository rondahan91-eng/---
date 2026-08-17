"""
מארגן את מאגר צילומי החזה (Kermany) לתיקיות אימון ומבחן.

שלוש בעיות מתועדות במאגר, ואיך הן מטופלות כאן:

1. personNNNN אינו מזהה מטופל ייחודי - 979 מזהים מופיעים גם כ-bacteria וגם
   כ-virus, כלומר שתי תת-הקבוצות מוספרו בנפרד. מפתח הקיבוץ הוא person+סוג.
2. 84% ממזהי ה-test מופיעים גם ב-train (דליפה מתועדת). לכן מאחדים את שלוש
   החלוקות המקוריות ומחלקים מחדש בעצמנו.
3. תמונות NORMAL חסרות מזהה מטופל. משתמשים במזהה IM-#### כמפתח חלקי -
   הוא מקבץ לפחות את הצילומים החוזרים של אותה בדיקה.

הפרדה: כל קבוצת תמונות (אותו מטופל/בדיקה) הולכת בשלמותה לאימון או למבחן,
לעולם לא מתפצלת - אחרת המודל נבחן על מה שכמעט ראה.

מבנה הפלט:
  chest_work/
    train/NORMAL|PNEUMONIA/     400 בכל אחת (מאוזן)
    benchmark/NORMAL|PNEUMONIA/ 100 בכל אחת (מאוזן, נעול)
    benchmark_answers.csv
    benchmark_blank.csv
    manifest.csv                מקור כל תמונה, לשחזור

הרצה:
    py tools/organize_pneumonia.py --dry-run
    py tools/organize_pneumonia.py
"""
import csv
import os
import random
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

SRC = Path(r'C:\Users\ronda\Downloads\archive\chest_xray')
OUT = Path(r'C:\Users\ronda\Desktop\chest_work')

TRAIN_PER_CLASS = 400
BENCH_PER_CLASS = 100
SEED = 20260813

PNEU_RE = re.compile(r'(person\d+)_(\w+?)_', re.I)
NORM_RE = re.compile(r'(?:NORMAL2-)?IM-(\d+)-(\d+)', re.I)


def collect():
    """אוסף את כל התמונות משלוש החלוקות המקוריות ומקבץ אותן לפי מטופל/בדיקה."""
    groups = defaultdict(list)          # key -> [(path, cls, subtype)]
    for split in ('train', 'test', 'val'):
        for cls in ('NORMAL', 'PNEUMONIA'):
            d = SRC / split / cls
            if not d.is_dir():
                continue
            for fn in sorted(os.listdir(d)):
                if not fn.lower().endswith(('.jpeg', '.jpg', '.png')):
                    continue
                p = d / fn
                if cls == 'PNEUMONIA':
                    m = PNEU_RE.match(fn)
                    sub = m.group(2).lower() if m else 'unknown'
                    # split נכלל במפתח: אי אפשר לדעת אם person1 ב-train
                    # ו-person1 ב-test הם אותו אדם, אז לא מאחדים אותם
                    key = ('PNEUMONIA', split, m.group(1).lower() if m else fn, sub)
                else:
                    m = NORM_RE.match(fn)
                    sub = 'normal'
                    key = ('NORMAL', split, m.group(1) if m else fn, sub)
                groups[key].append((p, cls, sub))
    return groups


def main():
    dry = '--dry-run' in sys.argv
    if not SRC.is_dir():
        sys.exit(f'Source not found: {SRC}')

    groups = collect()
    by_cls = defaultdict(list)
    for key, items in groups.items():
        by_cls[key[0]].append((key, items))

    rng = random.Random(SEED)
    plan, summary = [], []

    for cls in ('NORMAL', 'PNEUMONIA'):
        gs = sorted(by_cls[cls], key=lambda x: str(x[0]))
        rng.shuffle(gs)

        # קודם ה-benchmark, ורק ממה שנשאר בונים את האימון - כך שאף קבוצה
        # לא יכולה להופיע בשניהם
        def take(pool, target):
            picked, imgs = [], []
            for key, items in pool:
                if len(imgs) >= target:
                    break
                picked.append(key)
                imgs.extend(items)
            return picked, imgs[:target]

        bench_keys, bench = take(gs, BENCH_PER_CLASS)
        used = set(bench_keys)
        rest = [(k, i) for k, i in gs if k not in used]
        _, train = take(rest, TRAIN_PER_CLASS)

        plan.append((cls, 'benchmark', bench))
        plan.append((cls, 'train', train))

        subs = defaultdict(int)
        for p, c, s in train:
            subs[s] += 1
        summary.append((cls, len(bench), len(train), dict(subs)))

    # ביצוע
    manifest = []
    for cls, dest, imgs in plan:
        out_dir = OUT / dest / cls
        if not dry:
            out_dir.mkdir(parents=True, exist_ok=True)
        for src_path, c, sub in imgs:
            name = f'{sub}__{src_path.name}' if cls == 'PNEUMONIA' else src_path.name
            if not dry:
                shutil.copy2(src_path, out_dir / name)
            manifest.append([dest, cls, sub, name, str(src_path)])

    if not dry:
        OUT.mkdir(parents=True, exist_ok=True)
        with open(OUT / 'manifest.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['set', 'class', 'subtype', 'filename', 'source_path'])
            w.writerows(manifest)

        bench_rows = [(r[3], r[1].lower()) for r in manifest if r[0] == 'benchmark']
        with open(OUT / 'benchmark_answers.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f); w.writerow(['image', 'true_label'])
            w.writerows(bench_rows)
        shuffled = [r[0] for r in bench_rows]
        rng.shuffle(shuffled)
        with open(OUT / 'benchmark_blank.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f); w.writerow(['image', 'my_label', 'confidence_1_5', 'notes'])
            for n in shuffled:
                w.writerow([n, '', '', ''])

    # דיווח - נספר מהדיסק ולא מהתוכנית
    print(f'Source: {SRC}')
    print(f'Output: {OUT}')
    print(f'Mode:   {"DRY RUN" if dry else "COPY"}\n')
    print(f'{"class":<12}{"benchmark":>10}{"train":>8}   train breakdown')
    print('-' * 58)
    for cls, nb, nt, subs in summary:
        bd = ', '.join(f'{k}={v}' for k, v in sorted(subs.items()))
        print(f'{cls:<12}{nb:>10}{nt:>8}   {bd}')
    print('-' * 58)

    if not dry:
        print('\nActual files on disk:')
        for dest in ('train', 'benchmark'):
            for cls in ('NORMAL', 'PNEUMONIA'):
                d = OUT / dest / cls
                n = len(list(d.glob('*'))) if d.is_dir() else 0
                print(f'  {dest}/{cls}: {n}')
        print('\n[OK] Done.')
    else:
        print('\nDry run only. Re-run without --dry-run to copy.')


if __name__ == '__main__':
    main()
