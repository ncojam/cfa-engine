#!/usr/bin/env python3
"""
Склеить портреты из формата движка в читаемые ленты.

  project/images/charNN.bmp  ->  editors/portraits/charNN_faces.bmp
  (эмоции 72x80 слева направо: эмоция 0, 1, 2 ...)

  python3 portrait_unpack.py              # все char00..char39
  python3 portrait_unpack.py 0 9          # только char00 и char09
  python3 portrait_unpack.py --src DIR --out DIR
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gbportrait as gp  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('chars', nargs='*', help='номера или имена: 0 9 char04 (по умолчанию все 00..39)')
    ap.add_argument('--src', default=os.path.normpath(os.path.join(HERE, '..', '..', 'project', 'images')))
    ap.add_argument('--out', default=HERE)
    a = ap.parse_args()

    ok = 0
    for cid in gp.char_ids(a.chars):
        src = os.path.join(a.src, cid + '.bmp')
        if not os.path.isfile(src):
            if a.chars:
                print('  %s: нет файла %s' % (cid, src))
            continue
        try:
            sheet = gp.read_bmp(src)
            strip = gp.unpack(sheet)
            # самопроверка: склеили -> разобрали обратно -> всё видимое совпадает
            back = gp.pack(strip, base=sheet)
            if back.px != sheet.px[:len(back.px)]:
                raise ValueError('проверка туда-обратно не сошлась')
            dst = os.path.join(a.out, cid + '_faces.bmp')
            gp.write_bmp(dst, strip)
            print('  %s: %d эмоц., %s -> %s' % (cid, gp.emotion_count(sheet), sheet.kind, os.path.relpath(dst)))
            ok += 1
        except Exception as e:  # noqa: BLE001
            print('  %s: ОШИБКА — %s' % (cid, e))
    print('готово: %d файл(ов)' % ok)


if __name__ == '__main__':
    main()
