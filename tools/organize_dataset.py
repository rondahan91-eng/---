"""
מארגן את מאגר MURA לתיקיות עבודה: איבר -> תווית -> מטופל.

מינוח: MURA מתייגת abnormal/normal (ממצא חריג מול תקין) ולא "שבר".
ממצא חריג יכול להיות שבר, אך גם חומרה מתכתית, שינויים ניווניים או גידול.
השמות כאן משקפים את מה שהתוויות באמת אומרות.

עקרון מרכזי - הפרדה ברמת המחקר (study), לא ברמת התמונה:
כל מחקר ב-MURA מכיל כמה צילומים של אותו מטופל. אם תמונה אחת ממחקר תיכנס
לאימון ואחרת לערכת המבחן, המודל נבחן על מה שכמעט ראה. לכן כל התמונות של
מחקר נתון הולכות יחד לצד אחד בלבד, והמטופלים שנבחרו ל-benchmark אינם
מופיעים כלל ב-dataset.

מבנה הפלט:
  organized/ELBOW/
      benchmark/abnormal|normal/        <- שטוח, לכלי ההערכה. נעול!
      dataset/abnormal|normal/patientXXXXX/study1_image1.png
      benchmark_answers.csv             <- מפתח תשובות (למורה)
      benchmark_blank.csv               <- לתיוג עצמאי ע"י התלמידים

הרצה:
    py tools/organize_dataset.py --dry-run   # רק מדווח
    py tools/organize_dataset.py             # מעתיק
    py tools/organize_dataset.py --move      # מעביר (חוסך ~3GB)
"""
import csv
import random
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

SOURCE_ROOT = Path(r'C:\Users\ronda\Desktop\קבצים להנדסה ביו-רפואית')
STAGING = Path(r'C:\mura_download')
OUT_ROOT = SOURCE_ROOT / 'organized'
INDEX_CSV = Path(r'C:\Users\ronda\Downloads\mura_v1_1.csv')

BENCHMARK_PER_PART = 100      # 50 חריג + 50 תקין
SEED = 20260812               # קבוע -> אותה חלוקה בכל הרצה

PATH_RE = re.compile(r'(train|valid)/(XR_\w+)/(patient\d+)/(study\d+)_(positive|negative)/(.+)$')


def find_source_roots():
    """
    מחזיר את *כל* השורשים שמכילים עץ MURA. אם ההעברה מתיקיית הביניים נקטעה,
    הקבצים מפוצלים בין שני מקומות - ולכן צריך לחפש בשניהם ולא לבחור אחד.
    """
    roots, seen = [], set()
    for base in (SOURCE_ROOT, STAGING):
        if not base.exists():
            continue
        for c in (base, *(p for p in base.iterdir() if p.is_dir())):
            if c in seen:
                continue
            seen.add(c)
            if (c / 'train').is_dir() or (c / 'valid').is_dir():
                roots.append(c)
    return roots


def load_studies():
    """מקבץ לפי מחקר: {(part, patient, study): {'label':…, 'images':[(rel, fname)]}}"""
    studies = {}
    with open(INDEX_CSV, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            rel = row.get('file_name', '')
            if not rel.lower().endswith('.png'):
                continue
            m = PATH_RE.match(rel)
            if not m:
                continue
            _split, part, patient, study, label, fname = m.groups()
            key = (part, patient, study)
            rec = studies.setdefault(key, {'label': label, 'images': []})
            rec['images'].append((rel, f'{study}_{fname}'))
    return studies


def main():
    dry = '--dry-run' in sys.argv
    move = '--move' in sys.argv
    roots = find_source_roots()
    if not roots:
        sys.exit(f'Could not find the MURA tree under\n  {SOURCE_ROOT}\n  {STAGING}')

    print('Sources:')
    for r in roots:
        print(f'  {r}')
    print(f'Output: {OUT_ROOT}')
    print(f'Mode:   {"DRY RUN" if dry else ("MOVE" if move else "COPY")}\n')

    studies = load_studies()
    by_part = defaultdict(lambda: {'positive': [], 'negative': []})
    for (part, patient, study), rec in studies.items():
        by_part[part][rec['label']].append((patient, study, rec['images']))

    rng = random.Random(SEED)
    half = BENCHMARK_PER_PART // 2
    rows = []

    for part in sorted(by_part):
        short = part.replace('XR_', '')
        base = OUT_ROOT / short
        pos = sorted(by_part[part]['positive'])
        neg = sorted(by_part[part]['negative'])
        rng.shuffle(pos)
        rng.shuffle(neg)

        # בוחרים מחקרים שלמים עד שנאספו מספיק תמונות - אף מחקר לא מתפצל
        def pick(lst, target):
            locked, imgs = set(), []
            for patient, study, files in lst:
                if len(imgs) >= target:
                    break
                locked.add((patient, study))
                imgs.extend(files)
            return locked, imgs[:target]

        lock_pos, bench_pos = pick(pos, half)
        lock_neg, bench_neg = pick(neg, half)
        locked = lock_pos | lock_neg

        def transfer(rel, dest_dir, dest_name):
            # הקובץ עשוי לשבת בכל אחד מהשורשים (העברה שנקטעה פיצלה אותם)
            s = next((r / rel for r in roots if (r / rel).exists()), None)
            if s is None:
                return False
            if not dry:
                dest_dir.mkdir(parents=True, exist_ok=True)
                if move:
                    shutil.move(str(s), str(dest_dir / dest_name))
                else:
                    shutil.copy2(s, dest_dir / dest_name)
            return True

        got = miss = 0
        # נספרות התמונות שבאמת הועברו, לא אלו שנבחרו. קובץ שנבחר אך חסר
        # מהדיסק היה מדווח קודם כאילו הגיע, וערכת מבחן יצאה חסרה בשקט.
        bench_landed = {'abnormal': 0, 'normal': 0}

        # --- benchmark: שטוח, שם ייחודי הכולל מטופל ומחקר ---
        for label, imgs in (('abnormal', bench_pos), ('normal', bench_neg)):
            for rel, _ in imgs:
                m = PATH_RE.match(rel)
                _s, _p, patient, study, _l, fname = m.groups()
                ok = transfer(rel, base / 'benchmark' / label, f'{patient}_{study}_{fname}')
                got += ok
                miss += not ok
                bench_landed[label] += ok

        # --- dataset: לפי תווית ואז מטופל, בלי המחקרים הנעולים ---
        n_pat = {'abnormal': set(), 'normal': set()}
        for label_key, lst in (('abnormal', pos), ('normal', neg)):
            for patient, study, files in lst:
                if (patient, study) in locked:
                    continue
                n_pat[label_key].add(patient)
                for rel, name in files:
                    ok = transfer(rel, base / 'dataset' / label_key / patient, name)
                    got += ok
                    miss += not ok

        if not dry:
            base.mkdir(parents=True, exist_ok=True)
            def bench_name(rel):
                m = PATH_RE.match(rel)
                _s, _p, patient, study, _l, fname = m.groups()
                return f'{patient}_{study}_{fname}'
            with open(base / 'benchmark_answers.csv', 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f); w.writerow(['image', 'true_label'])
                for rel, _ in bench_pos: w.writerow([bench_name(rel), 'abnormal'])
                for rel, _ in bench_neg: w.writerow([bench_name(rel), 'normal'])
            shuffled = [bench_name(r) for r, _ in bench_pos + bench_neg]
            rng.shuffle(shuffled)
            with open(base / 'benchmark_blank.csv', 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f); w.writerow(['image', 'my_label', 'confidence_1_5', 'notes'])
                for n in shuffled: w.writerow([n, '', '', ''])

        rows.append((short, bench_landed['abnormal'], bench_landed['normal'],
                     len(n_pat['abnormal']), len(n_pat['normal']), got, miss))

    hdr = f'{"part":<10}{"bench+":>7}{"bench-":>7}{"patients+":>11}{"patients-":>11}{"files":>8}{"missing":>9}'
    print(hdr); print('-' * len(hdr))
    for r in rows:
        print(f'{r[0]:<10}{r[1]:>7}{r[2]:>7}{r[3]:>11}{r[4]:>11}{r[5]:>8}{r[6]:>9}')
    print('-' * len(hdr))
    tot_miss = sum(r[6] for r in rows)
    tot_files = sum(r[5] for r in rows)
    print(f'{"total":<10}{"":>7}{"":>7}{"":>11}{"":>11}{tot_files:>8}{tot_miss:>9}')

    if tot_miss:
        print(f'\n[i] {tot_miss:,} files from the index were not on disk '
              f'({tot_miss / (tot_files + tot_miss):.1%}).')
        print('    Expected if the download was stopped early - harmless at this scale.')
    if dry:
        print('\nDry run only. Re-run without --dry-run to write files.')
        if not move:
            print(f'Copying needs roughly the same space again (~3 GB). '
                  f'Use --move to relocate instead.')
    else:
        print('\n[OK] Done.')


def repair_benchmark():
    """
    משלים ערכות מבחן שיצאו חסרות (קבצים שנבחרו אך לא היו על הדיסק).
    לוקח *מחקרים שלמים* מתוך dataset/ כדי לא לפצל מחקר בין אימון למבחן;
    תמונות עודפות של אותם מחקרים עוברות ל-_excluded/ ולא נשארות ב-dataset.
    """
    print('Repairing short benchmarks...\n')
    print(f'{"part":<10}{"label":<10}{"before":>7}{"added":>7}{"after":>7}')
    print('-' * 41)
    for part_dir in sorted(p for p in OUT_ROOT.iterdir() if p.is_dir()):
        for label in ('abnormal', 'normal'):
            bench = part_dir / 'benchmark' / label
            if not bench.is_dir():
                continue
            before = len(list(bench.glob('*.png')))
            need = (BENCHMARK_PER_PART // 2) - before
            if need <= 0:
                continue

            pool = part_dir / 'dataset' / label
            added = 0
            # מקבצים לפי מחקר, כדי להעביר מחקר שלם ולא חלקו
            for patient_dir in sorted(p for p in pool.iterdir() if p.is_dir()):
                if added >= need:
                    break
                by_study = defaultdict(list)
                for img in sorted(patient_dir.glob('*.png')):
                    by_study[img.name.split('_')[0]].append(img)
                for study, imgs in sorted(by_study.items()):
                    if added >= need:
                        break
                    for i, img in enumerate(imgs):
                        target = bench if added < need else (part_dir / '_excluded' / label)
                        target.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(img), str(target / f'{patient_dir.name}_{img.name}'))
                        if target == bench:
                            added += 1
                    # אם התיקייה התרוקנה - מסירים אותה
                    if not any(patient_dir.iterdir()):
                        patient_dir.rmdir()

            after = len(list(bench.glob('*.png')))
            print(f'{part_dir.name:<10}{label:<10}{before:>7}{added:>7}{after:>7}')

    print('\nFinal benchmark counts:')
    for part_dir in sorted(p for p in OUT_ROOT.iterdir() if p.is_dir()):
        a = len(list((part_dir / 'benchmark' / 'abnormal').glob('*.png')))
        n = len(list((part_dir / 'benchmark' / 'normal').glob('*.png')))
        flag = '' if a == n == BENCHMARK_PER_PART // 2 else '   <-- still off'
        print(f'  {part_dir.name:<10} abnormal={a:<4} normal={n}{flag}')


if __name__ == '__main__':
    if '--repair-benchmark' in sys.argv:
        repair_benchmark()
    else:
        main()
