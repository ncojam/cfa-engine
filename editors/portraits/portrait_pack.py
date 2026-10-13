#!/usr/bin/env python3
"""
Разобрать читаемые ленты обратно в формат движка.

  editors/portraits/charNN_faces.bmp  ->  project/images/charNN.bmp

Число эмоций = ширина ленты / 72 (можно добавлять кадры справа).
Если в ленте эмоций меньше, чем в листе, недостающие (последние) остаются из оригинала;
удалить их можно только явно: --trim.
Формат результата — как у текущего project/images/charNN.bmp (24 бита или 8 бит с той же
палитрой; для палитры чужой цвет = ошибка). Тайлы, которые игра не показывает
(техническая полоска и пустые куски блоков), переносятся из оригинала без изменений.
Перед перезаписью старый файл копируется в editors/portraits/backups/.

  python3 portrait_pack.py                # все найденные charNN_faces.bmp
  python3 portrait_pack.py 0 9
  python3 portrait_pack.py --dry-run      # только проверить
"""
import argparse
import glob
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gbportrait as gp  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('chars', nargs='*', help='номера или имена: 0 9 char04 (по умолчанию все *_faces.bmp)')
    ap.add_argument('--src', default=HERE, help='где лежат charNN_faces.bmp')
    ap.add_argument('--out', default=os.path.normpath(os.path.join(HERE, '..', '..', 'project', 'images')))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--trim', action='store_true',
                    help='удалить из листа эмоции, которых нет в ленте (по умолчанию они сохраняются)')
    a = ap.parse_args()

    ids = gp.char_ids(a.chars) if a.chars else sorted(
        os.path.basename(p)[:-len('_faces.bmp')] for p in glob.glob(os.path.join(a.src, 'char*_faces.bmp')))
    stamp = time.strftime('%Y%m%d_%H%M%S')
    ok = 0
    for cid in ids:
        src = os.path.join(a.src, cid + '_faces.bmp')
        dst = os.path.join(a.out, cid + '.bmp')
        if not os.path.isfile(src):
            print('  %s: нет файла %s' % (cid, src))
            continue
        try:
            strip = gp.read_bmp(src)
            base = gp.read_bmp(dst) if os.path.isfile(dst) else None
            if base is not None:
                strip = gp.convert_like(strip, base, src)   # формат и палитра — как у оригинала
            sheet = gp.pack(strip, base, trim=a.trim)
            n_strip = strip.w // gp.PW
            n_base = gp.emotion_count(base) if base is not None else 0
            note = ''
            if n_strip < n_base:
                note = ('  [в ленте %d из %d эмоций: %s]' % (n_strip, n_base,
                        'лишние будут УДАЛЕНЫ (--trim)' if a.trim else 'эмоции %d..%d оставлены из оригинала' % (n_strip, n_base - 1)))
            if base is not None and sheet.px == base.px and sheet.h == base.h:
                print('  %s: без изменений' % cid)
                continue
            if a.dry_run:
                print('  %s: %d эмоц. — будет записан %s%s' % (cid, gp.emotion_count(sheet), dst, note))
                continue
            if base is not None:
                bdir = os.path.join(HERE, 'backups', stamp)
                os.makedirs(bdir, exist_ok=True)
                shutil.copy2(dst, os.path.join(bdir, cid + '.bmp'))
            os.makedirs(a.out, exist_ok=True)
            gp.write_bmp(dst, sheet)
            print('  %s: %d эмоц. -> %s%s' % (cid, gp.emotion_count(sheet), os.path.relpath(dst), note))
            ok += 1
        except Exception as e:  # noqa: BLE001
            print('  %s: ОШИБКА — %s' % (cid, e))
    print('записано: %d' % ok + ('' if a.dry_run else '  (бэкапы: editors/portraits/backups/)'))


if __name__ == '__main__':
    main()
