"""
גשש: מאתר את המזהה הנכון של הטבלה בתוך מאגר MURA.

הרקע: ההפניה AIMI.mura_msk_xrays.MURA-v1.1 נדחית כ"לא מלאה", ככל הנראה מפני
ששם הטבלה עצמו מכיל נקודה (MURA-v1.1) והשרת מפצל את ההפניה לפי נקודות.
הסקריפט מבקש מהשרת את רשימת הטבלאות בפועל, ואז מנסה כמה דרכי הפניה.

הרצה:
    $env:REDIVIS_API_TOKEN = "..."
    py tools/discover_redivis.py
"""
import os
import sys

ORG = 'AIMI'
DATASET = 'mura_msk_xrays'
TABLE_ID = '1157388'      # מתוך פרמטר ה-URL: rawFilesList-tables=1157388.MURA-v1.1
TABLE_NAME = 'MURA-v1.1'


def main():
    token = os.environ.get('REDIVIS_API_TOKEN', '')
    if not token:
        sys.exit('REDIVIS_API_TOKEN is not set.')
    try:
        import redivis
    except ImportError:
        sys.exit('Run:  py -m pip install redivis')

    print('=' * 64)
    print('STEP 1 - dataset reachable?')
    print('=' * 64)
    ds = None
    for label, build in [
        ('organization(AIMI).dataset(mura_msk_xrays)',
         lambda: redivis.organization(ORG).dataset(DATASET)),
        ('redivis.dataset("AIMI.mura_msk_xrays")',
         lambda: redivis.dataset(f'{ORG}.{DATASET}')),
    ]:
        try:
            d = build()
            d.get()
            props = getattr(d, 'properties', {}) or {}
            print(f'  [OK]   {label}')
            print(f'         name={props.get("name")!r}  version={props.get("version", {})}')
            ds = d
            break
        except Exception as e:
            print(f'  [fail] {label}\n         {type(e).__name__}: {str(e)[:100]}')

    if ds is None:
        print('\nDataset itself is unreachable - stopping.')
        return

    print()
    print('=' * 64)
    print('STEP 2 - tables inside the dataset (authoritative identifiers)')
    print('=' * 64)
    try:
        tables = ds.list_tables()
        print(f'  {len(tables)} table(s):')
        for t in tables:
            p = getattr(t, 'properties', {}) or {}
            print(f'     name={p.get("name")!r}')
            print(f'       id={p.get("id")!r}  files={p.get("numFiles")}  rows={p.get("numRows")}')
            print(f'       qualified={getattr(t, "qualified_reference", p.get("qualifiedReference", "?"))}')
    except Exception as e:
        print(f'  cannot list tables: {type(e).__name__}: {str(e)[:120]}')

    print()
    print('=' * 64)
    print('STEP 3 - which table reference actually works?')
    print('=' * 64)
    attempts = [
        ('by numeric id', lambda: ds.table(TABLE_ID)),
        ('by name, backticked', lambda: ds.table(f'`{TABLE_NAME}`')),
        ('by name as-is', lambda: ds.table(TABLE_NAME)),
        ('by name, underscored', lambda: ds.table(TABLE_NAME.replace('.', '_'))),
    ]
    for label, build in attempts:
        try:
            t = build()
            t.get()
            p = getattr(t, 'properties', {}) or {}
            print(f'  [OK]   {label}  ->  files={p.get("numFiles")}  rows={p.get("numRows")}')
            print(f'\n  Use this in download_mura.py:  TABLE = {build.__doc__ or label!r}')
            return
        except Exception as e:
            print(f'  [fail] {label}: {type(e).__name__}: {str(e)[:95]}')

    print('\n  None worked - send me the STEP 2 output and I will adjust.')


if __name__ == '__main__':
    main()
