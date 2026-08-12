"""
מארגן את מאגר MURA לתיקיות עבודה לפי איבר התמחות.

עקרון מרכזי - הפרדה ברמת המחקר (study), לא ברמת התמונה:
ב-MURA כל מחקר מכיל כמה צילומים של אותו מטופל. אם תמונה אחת ממחקר תיכנס
לאימון ואחרת מאותו מחקר לערכת המבחן, המודל נבחן על מה שכמעט ראה והציון
מנופח. לכן *כל* התמונות של מחקר נתון הולכות יחד לצד אחד בלבד.

מבנה הפלט (שמות באנגלית בכוונה - כלים כמו Teachable Machine ו-Colab
מתקשים עם נתיבים בעברית):

  organized/
    ELBOW/
      benchmark/            <- נעול. כלי המדידה של כל השנה
        abnormal/  (50)
        normal/    (50)
      train_pool/           <- ממנו התלמידים בוחרים את המאגר האישי
        abnormal/
        normal/
      benchmark_answers.csv <- מפתח תשובות (למורה בלבד)
      benchmark_blank.csv   <- לתיוג עצמאי ע"י התלמידים
    SHOULDER/ ...

הרצה:
    py tools/organize_dataset.py            # ברירת מחדל
    py tools/organize_dataset.py --dry-run  # רק מדווח, לא מעתיק
"""
import csv
import random
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

SOURCE_ROOT = Path(r'C:\Users\ronda\Desktop\קבצים להנדסה ביו-רפואית')
OUT_ROOT = SOURCE_ROOT / 'organized'
INDEX_CSV = Path(r'C:\Users\ronda\Downloads\mura_v1_1.csv')

BENCHMARK_PER_PART = 100      # 50 חריג + 50 תקין
TRAIN_POOL_CAP = 1200         # תקרה לאיבר, כדי לא לשכפל 3GB
SEED = 20260812               # קבוע -> אותה חלוקה בכל הרצה

PATH_RE = re.compile(r'(train|valid)/(XR_\w+)/(patient\d+)/(study\d+)_(positive|negative)/')


def find_source_root():
    """התמונות עשויות לרדת עם תיקיית-על. מאתר היכן מתחיל העץ."""
    for cand in (SOURCE_ROOT, *(p for p in SOURCE_ROOT.iterdir() if p.is_dir())) \
            if SOURCE_ROOT.exists() else ():
        if (cand / 'train').is_dir() or (cand / 'valid').is_dir():
            return cand
    return None


def load_studies():
    """מקבץ את האינדקס לפי מחקר: {(part, study_key): {'label':…, 'images':[…]}}"""
    studies = {}
    with open(INDEX_CSV, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            rel = row.get('file_name', '')
            m = PATH_RE.match(rel)
            if not m or not rel.lower().endswith('.png'):
                continue
            split, part, patient, study, label = m.groups()
            key = (part, f'{split}/{patient}/{study}')
            rec = studies.setdefault(key, {'label': label, 'images': []})
            rec['images'].append(rel)
    return studies


def main():
    dry = '--dry-run' in sys.argv
    src = find_source_root()
    if src is None:
        sys.exit(f'Could not find the MURA tree under {SOURCE_ROOT}\n'
                 'Has the download finished?')
    print(f'Source: {src}')
    print(f'Output: {OUT_ROOT}')
    print(f'Mode:   {"DRY RUN (nothing copied)" if dry else "copying files"}\n')

    studies = load_studies()
    by_part = defaultdict(lambda: {'positive': [], 'negative': []})
    for (part, skey), rec in studies.items():
        by_part[part][rec['label']].append((skey, rec['images']))

    rng = random.Random(SEED)
    half = BENCHMARK_PER_PART // 2
    summary = []

    for part in sorted(by_part):
        short = part.replace('XR_', '')
        pos = sorted(by_part[part]['positive'])
        neg = sorted(by_part[part]['negative'])
        rng.shuffle(pos)
        rng.shuffle(neg)

        # בוחרים *מחקרים* עד שנאספו מספיק תמונות - כך שאף מחקר לא מתפצל
        def take(studies_list, target):
            chosen, imgs = [], []
            for skey, files in studies_list:
                if len(imgs) >= target:
                    break
                chosen.append(skey)
                imgs.extend(files)
            return chosen, imgs[:target]

        bench_pos_keys, bench_pos = take(pos, half)
        bench_neg_keys, bench_neg = take(neg, half)
        locked = set(bench_pos_keys) | set(bench_neg_keys)

        # מאגר האימון: כל מה שלא נעול, עד התקרה, בשמירה על היחס הטבעי
        pool = {'positive': [], 'negative': []}
        for label, lst in (('positive', pos), ('negative', neg)):
            for skey, files in lst:
                if skey in locked:
                    continue
                pool[label].extend(files)
        total_pool = len(pool['positive']) + len(pool['negative'])
        if total_pool > TRAIN_POOL_CAP and total_pool:
            ratio = len(pool['positive']) / total_pool
            pool['positive'] = pool['positive'][:round(TRAIN_POOL_CAP * ratio)]
            pool['negative'] = pool['negative'][:TRAIN_POOL_CAP - len(pool['positive'])]

        base = OUT_ROOT / short
        plan = [
            (base / 'benchmark' / 'abnormal', bench_pos),
            (base / 'benchmark' / 'normal', bench_neg),
            (base / 'train_pool' / 'abnormal', pool['positive']),
            (base / 'train_pool' / 'normal', pool['negative']),
        ]

        copied = missing = 0
        for dest, files in plan:
            if not dry:
                dest.mkdir(parents=True, exist_ok=True)
            for rel in files:
                s = src / rel
                if not s.exists():
                    missing += 1
                    continue
                if not dry:
                    # שם ייחודי ושטוח: patient/study/image בשם אחד
                    flat = rel.split('/', 1)[1].replace('/', '__')
                    shutil.copy2(s, dest / flat)
                copied += 1

        if not dry:
            base.mkdir(parents=True, exist_ok=True)
            with open(base / 'benchmark_answers.csv', 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['image', 'true_label'])
                for rel in bench_pos:
                    w.writerow([rel.split('/', 1)[1].replace('/', '__'), 'abnormal'])
                for rel in bench_neg:
                    w.writerow([rel.split('/', 1)[1].replace('/', '__'), 'normal'])
            with open(base / 'benchmark_blank.csv', 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['image', 'my_label', 'confidence_1_5', 'notes'])
                for rel in rng.sample(bench_pos + bench_neg, len(bench_pos + bench_neg)):
                    w.writerow([rel.split('/', 1)[1].replace('/', '__'), '', '', ''])

        summary.append((short, len(bench_pos), len(bench_neg),
                        len(pool['positive']), len(pool['negative']), missing))

    print(f'{"part":<10}{"bench+":>8}{"bench-":>8}{"pool+":>8}{"pool-":>8}{"missing":>9}')
    print('-' * 51)
    for row in summary:
        print(f'{row[0]:<10}{row[1]:>8}{row[2]:>8}{row[3]:>8}{row[4]:>8}{row[5]:>9}')
    print('-' * 51)
    tot_missing = sum(r[5] for r in summary)
    if tot_missing:
        print(f'\n[!] {tot_missing:,} files listed in the index were not found on disk.')
        print('    The download may still be running or incomplete.')
    elif dry:
        print('\nDry run OK. Re-run without --dry-run to copy.')
    else:
        print('\n[OK] Done.')


if __name__ == '__main__':
    main()
