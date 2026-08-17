"""
מבחן היתכנות: האם משימת הסיווג "קלה מדי" לסולם הניסויים?

השאלה המעשית: אם המודל מגיע לתקרה כבר עם 50 תמונות, אז עקומת הלמידה שטוחה,
יחסי האיזון כמעט לא משפיעים, ואין מה לתקן - וארבעת הניסויים מאבדים את החוד.

הסקריפט מאמן בגדלים עולים ומדפיס את העקומה. שתי שכבות תכונות:
  - אם TensorFlow מותקן: תכונות MobileNetV2 (קרוב למה ש-Teachable Machine עושה)
  - אחרת: תכונות פשוטות (סטטיסטיקות צבע + היסטוגרמות)

דווקא הנפילה לתכונות הפשוטות היא אינפורמטיבית: אם *הן* כבר מפרידות היטב,
זו עדות חזקה שהאות רדוד והמשימה קלה.

הרצה:
    py tools/feasibility_test.py --data "C:\\Users\\ronda\\Desktop\\malaria"
"""
import argparse
import os
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

SIZES = [10, 25, 50, 100, 200, 400]
TEST_PER_CLASS = 300
SEED = 20260817
IMG = 96


def find_class_dirs(root: Path):
    """מאתר שתי תיקיות מחלקה, בכל עומק סביר."""
    best = None
    for d in [root, *[p for p in root.rglob('*') if p.is_dir()]]:
        subs = [s for s in d.iterdir() if s.is_dir()] if d.is_dir() else []
        imgy = [s for s in subs
                if any(f.suffix.lower() in ('.png', '.jpg', '.jpeg')
                       for f in list(s.iterdir())[:40] if f.is_file())]
        if len(imgy) == 2:
            best = sorted(imgy, key=lambda p: p.name.lower())
            break
    return best


def simple_features(path):
    """סטטיסטיקות צבע + היסטוגרמה. זול, ומספיק כדי לחשוף אות רדוד."""
    im = Image.open(path).convert('RGB').resize((IMG, IMG))
    a = np.asarray(im, dtype=np.float32) / 255.0
    feats = []
    for c in range(3):
        ch = a[:, :, c]
        feats += [ch.mean(), ch.std(), np.percentile(ch, 10), np.percentile(ch, 90)]
        feats += np.histogram(ch, bins=16, range=(0, 1), density=True)[0].tolist()
    g = a.mean(axis=2)
    # שיעור הפיקסלים הכהים - הטפיל במלריה מופיע ככתם כהה
    feats += [(g < 0.35).mean(), (g < 0.20).mean(), g.std()]
    return np.array(feats, dtype=np.float32)


def build_extractor():
    try:
        import tensorflow as tf
        base = tf.keras.applications.MobileNetV2(
            input_shape=(224, 224, 3), include_top=False, pooling='avg', weights='imagenet')
        pre = tf.keras.applications.mobilenet_v2.preprocess_input

        def extract(paths):
            arrs = []
            for p in paths:
                im = Image.open(p).convert('RGB').resize((224, 224))
                arrs.append(np.asarray(im, dtype=np.float32))
            return base.predict(pre(np.stack(arrs)), verbose=0)
        return extract, 'MobileNetV2 (כמו Teachable Machine)'
    except Exception:
        def extract(paths):
            return np.stack([simple_features(p) for p in paths])
        return extract, 'תכונות פשוטות (TensorFlow לא מותקן)'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    args = ap.parse_args()

    root = Path(args.data)
    if not root.is_dir():
        sys.exit(f'לא נמצא: {root}')
    dirs = find_class_dirs(root)
    if not dirs:
        sys.exit(f'לא נמצאו שתי תיקיות מחלקה תחת {root}')

    rng = random.Random(SEED)
    pools = []
    for d in dirs:
        files = [p for p in d.iterdir()
                 if p.suffix.lower() in ('.png', '.jpg', '.jpeg')]
        rng.shuffle(files)
        pools.append(files)

    print(f'מחלקות: {dirs[0].name} ({len(pools[0])})  |  {dirs[1].name} ({len(pools[1])})')
    extract, how = build_extractor()
    print(f'תכונות: {how}\n')

    # ערכת מבחן קבועה, נלקחת קודם - כדי שלא תיכנס לאימון באף גודל
    test_paths, test_y = [], []
    for lbl, pool in enumerate(pools):
        take = pool[:TEST_PER_CLASS]
        test_paths += take
        test_y += [lbl] * len(take)
    print(f'מחשב תכונות לערכת מבחן ({len(test_paths)} תמונות)...')
    Xte = extract(test_paths)
    yte = np.array(test_y)

    print(f'\n{"לכל מחלקה":>12}{"סה״כ אימון":>12}{"דיוק":>9}')
    print('-' * 34)
    results = []
    for n in SIZES:
        tr_paths, tr_y = [], []
        for lbl, pool in enumerate(pools):
            take = pool[TEST_PER_CLASS:TEST_PER_CLASS + n]
            if len(take) < n:
                print(f'  (רק {len(take)} זמינות למחלקה {dirs[lbl].name})')
            tr_paths += take
            tr_y += [lbl] * len(take)
        Xtr = extract(tr_paths)
        clf = LogisticRegression(max_iter=3000)
        clf.fit(Xtr, np.array(tr_y))
        acc = accuracy_score(yte, clf.predict(Xte))
        results.append((n, acc))
        print(f'{n:>12}{n*2:>12}{acc:>8.1%}')

    print('\n--- מסקנה ---')
    first, last = results[0][1], results[-1][1]
    gain = last - first
    at50 = next((a for n, a in results if n == 50), None)
    print(f'מ-{SIZES[0]} ל-{SIZES[-1]} לכל מחלקה: {first:.1%} -> {last:.1%}  (שיפור {gain:+.1%})')
    if at50 is not None:
        print(f'עם 50 לכל מחלקה כבר מגיעים ל-{at50:.1%} '
              f'({at50/last:.0%} מהביצועים הסופיים)')
    if gain < 0.05:
        print('\n[!] העקומה שטוחה - המשימה קלה. ניסויי גודל/איזון יניבו מעט מאוד.')
    elif gain < 0.15:
        print('\n[~] שיפור מתון. ניסוי עקומת הלמידה יעבוד, אך בטווח צר.')
    else:
        print('\n[OK] שיפור ברור לאורך העקומה - הניסוי יניב ממצא משמעותי.')


if __name__ == '__main__':
    main()
