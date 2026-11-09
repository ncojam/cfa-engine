#!/usr/bin/env python3
"""
Graveblood — Dialogue Editor (local web server, Python 3 stdlib only)

    python3 server.py              # http://127.0.0.1:8765  (opens the browser)
    python3 server.py --port 9000 --no-browser
    python3 server.py --project /cfa_engine/project

By default the project is located relative to this file: <editor>/../../project
Reads/writes  <project>/src/dialogues.cpp  and  <project>/src/dialogues.h
Backups go to <editor>/backups/ before every save.
Editor-only data (statuses, NPC per dialogue, emotion names) -> <editor>/editor_meta.json
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import threading
import time
import webbrowser
import zlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dlgcore  # noqa: E402
import stcore  # noqa: E402
import grcore  # noqa: E402
import incore  # noqa: E402

PORTRAITS_DIR = os.path.normpath(os.path.join(HERE, '..', 'portraits'))
sys.path.insert(0, PORTRAITS_DIR)
import gbportrait as gp  # noqa: E402
import bigconv  # noqa: E402

LOCK = threading.Lock()
CFG = {}


# ------------------------------------------------------------------ files

def read_text(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    for enc in ('utf-8', 'cp1251'):
        try:
            return data.decode(enc), enc, data
        except UnicodeDecodeError:
            continue
    return data.decode('latin-1'), 'latin-1', data


def write_text(path, text, enc):
    tmp = path + '.tmp_editor'
    with open(tmp, 'wb') as fh:
        fh.write(text.encode(enc))
    os.replace(tmp, path)


def files_hash():
    h = hashlib.sha1()
    for p in (CFG['cpp'], CFG['h']):
        with open(p, 'rb') as fh:
            h.update(fh.read())
    return h.hexdigest()


def backup():
    bdir = os.path.join(HERE, 'backups')
    os.makedirs(bdir, exist_ok=True)
    stamp = time.strftime('%Y%m%d_%H%M%S')
    for p in (CFG['cpp'], CFG['h']):
        base = os.path.basename(p)
        shutil.copy2(p, os.path.join(bdir, '%s.%s' % (stamp, base)))
    # keep the newest N backup pairs
    files = sorted(os.listdir(bdir))
    keep = CFG.get('keep_backups', 40) * 2
    for old in files[:-keep] if len(files) > keep else []:
        try:
            os.remove(os.path.join(bdir, old))
        except OSError:
            pass


def meta_path():
    return os.path.join(HERE, 'editor_meta.json')


def load_meta():
    try:
        with open(meta_path(), encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {"dialogues": {}, "emotions": {}}


def save_meta(meta):
    tmp = meta_path() + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, meta_path())


# ------------------------------------------------------------------ portraits

PORTRAIT_W, PORTRAIT_H = 72, 80
INC_INDEX = {}      # "char00.til.inc" -> path
PORTRAIT_CACHE = {}  # cid -> (tiles bytes, palette list) or None


def index_inc_files():
    INC_INDEX.clear()
    roots = CFG['gfx_dirs']
    for root in roots:
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if not d.startswith('.') and d not in ('backups', 'node_modules')]
            for fn in fns:
                if re.fullmatch(r'char\d\d\.(til|pal)\.inc', fn, re.I):
                    INC_INDEX.setdefault(fn.lower(), os.path.join(dp, fn))


def parse_inc_array(path, ident):
    src, _, _ = read_text(path)
    m = re.search(r'([\w\s]*?)\b' + re.escape(ident) + r'\s*\[[^\]]*\][^={;]*=\s*\{', src)
    if not m:
        m = re.search(r'([\w\s]*?)\b\w+\s*\[[^\]]*\][^={;]*=\s*\{', src)
        if not m:
            return None, None
    decl = m.group(1)
    start = m.end()
    end = src.find('}', start)
    body = re.sub(r'//[^\n]*|/\*.*?\*/', '', src[start:end], flags=re.S)
    nums = [int(x, 0) for x in re.findall(r'0[xX][0-9a-fA-F]+|\d+', body)]
    width = 1
    if re.search(r'\b(int|long|u32|uint32_t)\b', decl) and 'short' not in decl:
        width = 4
    elif re.search(r'\b(short|u16|uint16_t)\b', decl):
        width = 2
    elif nums and max(nums) > 0xFFFF:
        width = 4
    elif nums and max(nums) > 0xFF:
        width = 2
    return nums, width


def load_portrait(cid):
    if cid in PORTRAIT_CACHE:
        return PORTRAIT_CACHE[cid]
    res = None
    til = INC_INDEX.get('char%02d.til.inc' % cid)
    pal = INC_INDEX.get('char%02d.pal.inc' % cid)
    if til and pal:
        try:
            tnums, tw = parse_inc_array(til, 'char%02d_til' % cid)
            pnums, pw = parse_inc_array(pal, 'char%02d_pal' % cid)
            if tnums and pnums:
                if tw == 1:
                    tb = bytes(x & 0xFF for x in tnums)
                elif tw == 2:
                    tb = b''.join(struct.pack('<H', x & 0xFFFF) for x in tnums)
                else:
                    tb = b''.join(struct.pack('<I', x & 0xFFFFFFFF) for x in tnums)
                if pw == 4:  # two colours per word
                    pv = []
                    for x in pnums:
                        pv += [x & 0xFFFF, (x >> 16) & 0xFFFF]
                    pnums = pv
                colors = []
                for c in pnums:
                    r, g, b = c & 31, (c >> 5) & 31, (c >> 10) & 31
                    colors.append(((r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)))
                res = (tb, colors)
        except Exception as e:  # noqa: BLE001
            print('portrait %d: %s' % (cid, e))
    PORTRAIT_CACHE[cid] = res
    return res


def emotion_count(cid):
    p = load_portrait(cid)
    if not p:
        return 0
    tiles = len(p[0]) // 64
    # an emotion needs tiles 96n+16 .. 96n+16+72
    return max(0, (tiles - 16 - 72) // 96 + 1)


# Placement copied from makePrtrt() + PlayerDrawing::drawChar():
#   dest tile d (0..71)  <- src tile 96n+16+d ;  dest 80..87 <- src 96n+96+(d-80)
#   OBJ VRAM is 2D, 16 8bpp tiles per row.
def _placements():
    out = []
    t = 8  # loop 1: 4x2 sprites 16x16, cols 8..15 rows 0..3  -> x 0..64, y 48..80
    for yy in (0, 2):
        for xx in (0, 2, 4, 6):
            out += [(t, xx * 8, yy * 8 + 48), (t + 1, xx * 8 + 8, yy * 8 + 48),
                    (t + 16, xx * 8, yy * 8 + 56), (t + 17, xx * 8 + 8, yy * 8 + 56)]
            t += 2
        t += 24
    t = 0  # loop 2: 3x3 sprites 16x16, cols 0..5 rows 0..5 -> x 8..56, y 0..48
    for yy in (0, 2, 4):
        for xx in (0, 2, 4):
            out += [(t, xx * 8 + 8, yy * 8), (t + 1, xx * 8 + 16, yy * 8),
                    (t + 16, xx * 8 + 8, yy * 8 + 8), (t + 17, xx * 8 + 16, yy * 8 + 8)]
            t += 2
        t += 26
    t = 7  # loop 3: column 7, 5 tiles -> x 64, y 40..80
    for yy in range(5):
        out.append((t, 64, (yy + 5) * 8))
        t += 16
    t = 6  # loop 4: column 6, 6 tiles -> x 56, y 0..48
    for yy in range(6):
        out.append((t, 56, yy * 8))
        t += 16
    return out


PLACEMENTS = _placements()


def render_portrait(cid, emo):
    p = load_portrait(cid)
    if not p:
        return None
    tb, pal = p
    W, H = PORTRAIT_W, PORTRAIT_H
    px = bytearray(W * H * 4)
    ntiles = len(tb) // 64
    base = 96 * emo + 16
    for dest, x0, y0 in PLACEMENTS:
        src_tile = base + dest if dest < 72 else (96 * emo + 96 + (dest - 80) if 80 <= dest < 88 else -1)
        if src_tile < 0 or src_tile >= ntiles:
            continue
        off = src_tile * 64
        for y in range(8):
            for x in range(8):
                v = tb[off + y * 8 + x]
                if v == 0 or v >= len(pal):
                    continue
                r, g, b = pal[v]
                i = ((y0 + y) * W + (x0 + x)) * 4
                px[i:i + 4] = bytes((r, g, b, 255))
    return png_rgba(W, H, bytes(px))


def png_rgba(w, h, rgba):
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


# ------------------------------------------------------------------ portrait sources (BMP sheets / strips)
# sheet: project/images/charNN.bmp (engine layout)   strip: editors/portraits/charNN_faces.bmp

BMP_CACHE = {}  # path -> (mtime, strip Image)


def sheet_path(cid):
    return os.path.join(CFG['images'], 'char%02d.bmp' % cid)


def strip_path(cid):
    return os.path.join(PORTRAITS_DIR, 'char%02d_faces.bmp' % cid)


def big_path(cid):
    return os.path.join(PORTRAITS_DIR, 'char%02d_faces_big.bmp' % cid)


def spr_palette():
    return bigconv.load_palette(os.path.join(CFG['images'], 'chr_spr_witch.bmp'))


def _backup_strip(dst, stamp):
    if os.path.isfile(dst):
        bdir = os.path.join(PORTRAITS_DIR, 'backups', stamp, 'faces')
        os.makedirs(bdir, exist_ok=True)
        shutil.copy2(dst, os.path.join(bdir, os.path.basename(dst)))


def bmp_strip(path, is_sheet):
    """BMP -> readable strip (cached by mtime). None if there is no file."""
    if not os.path.isfile(path):
        return None
    mt = os.path.getmtime(path)
    c = BMP_CACHE.get(path)
    if c and c[0] == mt:
        return c[1]
    img = gp.read_bmp(path)
    strip = gp.unpack(img) if is_sheet else img
    BMP_CACHE[path] = (mt, strip)
    return strip


def bmp_info(path, is_sheet):
    if not os.path.isfile(path):
        return None
    try:
        img = gp.read_bmp(path)
        n = gp.emotion_count(img) if is_sheet else img.w // gp.PW
        return {"n": n, "w": img.w, "h": img.h, "kind": img.kind, "mtime": os.path.getmtime(path)}
    except Exception as e:  # noqa: BLE001
        return {"n": 0, "error": str(e), "mtime": os.path.getmtime(path)}


def render_bmp_emotion(path, is_sheet, emo):
    strip = bmp_strip(path, is_sheet)
    if strip is None or emo >= strip.w // gp.PW:
        return None
    W, H = gp.PW, gp.PH
    bg = strip.color(0, 0) if is_sheet else None   # sheets: tech-strip colour = transparent
    px = bytearray(W * H * 4)
    for y in range(H):
        for x in range(W):
            c = strip.color(emo * W + x, y)
            if c == bg:
                continue
            i = (y * W + x) * 4
            px[i:i + 4] = bytes((c[0], c[1], c[2], 255))
    return png_rgba(W, H, bytes(px))


# ------------------------------------------------------------------ overworld sprites (one idle frame per character)
# Как в движке: NPC-кадр 16x32 = тайлы (32 + legsColor*8 + subtype) + lin*16, 2 тайла в ширину, 4 строки
# (ActorNPC::copyFrameGfx), с листа chr_spr[gfxFrom] (persons.cpp) или с gr_chars (mss-chars.bmp) при gfxFrom = -1.
# Вика — vika00 (mss-vika00.bmp), idle: тайл 16 (player_drawing.cpp). Прозрачный цвет — (0,0) spr_palette.bmp.

SPRITE_INFO = {"key": None, "chars": {}}


def _src(name):
    p = os.path.join(os.path.dirname(CFG['cpp']), name)
    return read_text(p)[0] if os.path.isfile(p) else ''


def _sprite_sheets():
    """идентификатор tmx2incl (chr_spr_lidia, gr_chars, vika00) -> имя BMP, по build_graphics.sh"""
    out = {}
    for fn in ('build_graphics.sh', 'build_graphics.bat'):
        p = os.path.join(CFG['project'], fn)
        if os.path.isfile(p):
            for m in re.finditer(r'\s+b\s+"?[^\s"]*?([\w.-]+\.bmp)"?\s+(\w+)', read_text(p)[0]):
                out.setdefault(m.group(2), m.group(1))
    out.setdefault('gr_chars', 'mss-chars.bmp')
    out.setdefault('vika00', 'mss-vika00.bmp')
    return out


def _mission_npcs():
    src = re.sub(r'//[^\n]*|/\*.*?\*/', '', _src('mission_objects.h'), flags=re.S)
    res = []
    for arr in re.finditer(r'\[\s*\]\s*=\s*\{(.*?)\};', src, re.S):
        for ent in re.split(r'\bnullptr\b', arr.group(1)):
            vals = re.findall(r'"((?:[^"\\]|\\.)*)"', ent)
            d = dict(zip(vals[0::2], vals[1::2]))
            try:
                if 'charID' in d and 'legsColor' in d:
                    res.append((int(d['charID']), int(d.get('gfxFrom', -1)), int(d['legsColor']), int(d.get('subtype', 0))))
            except ValueError:
                pass
    return res


def sprite_table():
    files = [os.path.join(os.path.dirname(CFG['cpp']), f) for f in ('mission_objects.h', 'persons.cpp')]
    key = tuple(os.path.getmtime(f) if os.path.isfile(f) else 0 for f in files)
    if SPRITE_INFO['key'] == key:
        return SPRITE_INFO['chars']
    sheets = _sprite_sheets()
    m = re.search(r'\bchr_spr\s*\[[^\]]*\]\s*=\s*\{(.*?)\};', _src('persons.cpp'), re.S)
    chr_spr = re.findall(r'(\w+?)_til\b|\bnullptr\b', m.group(1)) if m else []
    from collections import Counter
    npcs = _mission_npcs()
    # листы скейтеров (ActorSkater.cpp): линия 0 = 8 px, idle — линия 1 = тайл 16, legsColor не используется
    skater = set(re.findall(r'\bsheet\s*=\s*(chr_spr_\w+?)_til', _src('ActorSkater.cpp')))
    out = {0: {"sheet": sheets['vika00'], "tile": 16, "from": "Вика: основной тайлсет"}}
    ids = {c for c, *_ in npcs} | {i for i, n in enumerate(chr_spr) if n and n != 'chr_spr_items'}
    for cid in sorted(ids - {0}):
        own = [(g, l, s) for c, g, l, s in npcs if c == cid and l != 1 and 0 <= g < len(chr_spr)
               and chr_spr[g] and chr_spr[g] != 'chr_spr_items']
        shared = [(l, s) for c, g, l, s in npcs if c == cid and l != 1 and g == -1]
        if own:
            (g, l, s), _ = Counter(own).most_common(1)[0]
            out[cid] = {"sheet": sheets.get(chr_spr[g], chr_spr[g] + '.bmp'),
                        "tile": 16 if chr_spr[g] in skater else 32 + l * 8 + s,
                        "from": 'свой лист %s (gfxFrom %d)' % (chr_spr[g], g)}
        elif cid < len(chr_spr) and chr_spr[cid] and chr_spr[cid] != 'chr_spr_items':
            out[cid] = {"sheet": sheets.get(chr_spr[cid], chr_spr[cid] + '.bmp'), "tile": 16 if chr_spr[cid] in skater else 32,
                        "from": 'свой лист %s (в mission_objects не найден, кадр 0)' % chr_spr[cid]}
        elif shared:
            (l, s), n = Counter(shared).most_common(1)[0]
            out[cid] = {"sheet": sheets['gr_chars'], "tile": 32 + l * 8 + s,
                        "from": 'общий лист, mission_objects: legsColor %d, subtype %d (%d раз)' % (l, s, n)}
    SPRITE_INFO.update(key=key, chars=out)
    return out


def render_sprite(cid):
    info = sprite_table().get(cid)
    if not info:
        return None
    path = os.path.join(CFG['images'], info['sheet'])
    if not os.path.isfile(path):
        return None
    mt = os.path.getmtime(path)
    c = BMP_CACHE.get(path)
    img = c[1] if c and c[0] == mt else gp.read_bmp(path)
    BMP_CACHE[path] = (mt, img)
    pal = os.path.join(CFG['images'], 'spr_palette.bmp')
    key = gp.read_bmp(pal).color(0, 0) if os.path.isfile(pal) else (255, 0, 255)
    W, H = 16, 32
    px = bytearray(W * H * 4)
    t0 = info['tile']
    for lin in range(4):
        for tx in range(2):
            t = t0 + lin * 16 + tx
            sx, sy = (t % 16) * 8, (t // 16) * 8
            for y in range(8):
                for x in range(8):
                    if sy + y >= img.h:
                        continue
                    col = img.color(sx + x, sy + y)
                    if col == key:
                        continue
                    i = ((lin * 8 + y) * W + tx * 8 + x) * 4
                    px[i:i + 4] = bytes((col[0], col[1], col[2], 255))
    return png_rgba(W, H, bytes(px))


def api_portraits_status():
    out = {}
    try:
        sprites = sprite_table()
    except Exception as e:  # noqa: BLE001
        print('sprites: %s' % e)
        sprites = {}
    for cid in range(40):
        sh = bmp_info(sheet_path(cid), True)
        st = bmp_info(strip_path(cid), False)
        bg = os.path.isfile(big_path(cid))
        inc = INC_INDEX.get('char%02d.til.inc' % cid)
        if not (sh or st or bg or inc or cid in sprites):
            continue
        out[cid] = {"sprite": sprites.get(cid), "sheet": sh, "strip": st,
                    "big": {"mtime": os.path.getmtime(big_path(cid))} if bg else None, "inc": emotion_count(cid) if inc else 0,
                    "incMtime": os.path.getmtime(inc) if inc else None}
    return {"chars": out, "images": CFG['images'], "stripsDir": PORTRAITS_DIR}


def api_portraits_convert(body):
    """direction 'unpack' (sheet -> strip) | 'pack' (strip -> sheet). Same rules as the CLI scripts."""
    direction, ids = body.get('direction'), [int(x) for x in body.get('chars', [])]
    dry, trim = bool(body.get('dryRun')), bool(body.get('trim'))
    stamp = time.strftime('%Y%m%d_%H%M%S')
    log = []
    for cid in ids:
        name = 'char%02d' % cid
        try:
            if direction == 'unpack':
                src = sheet_path(cid)
                if not os.path.isfile(src):
                    log.append({"cid": cid, "ok": False, "msg": 'нет ' + src}); continue
                sheet = gp.read_bmp(src)
                strip = gp.unpack(sheet)
                back = gp.pack(strip, base=sheet)
                if back.px != sheet.px[:len(back.px)]:
                    raise ValueError('проверка туда-обратно не сошлась')
                dst = strip_path(cid)
                if os.path.isfile(dst) and os.path.getmtime(dst) > os.path.getmtime(src) and not body.get('force'):
                    log.append({"cid": cid, "ok": False, "newer": True,
                                "msg": 'лента новее листа — не перезаписываю (можно принудительно)'}); continue
                if not dry:
                    if os.path.isfile(dst):
                        bdir = os.path.join(PORTRAITS_DIR, 'backups', stamp, 'faces')
                        os.makedirs(bdir, exist_ok=True)
                        shutil.copy2(dst, os.path.join(bdir, os.path.basename(dst)))
                    gp.write_bmp(dst, strip)
                log.append({"cid": cid, "ok": True, "msg": '%s → %s_faces.bmp, %d эмоц.%s' % (
                    name, name, gp.emotion_count(sheet), ' (проверка)' if dry else '')})
            elif direction == 'pack':
                src, dst = strip_path(cid), sheet_path(cid)
                if not os.path.isfile(src):
                    log.append({"cid": cid, "ok": False, "msg": 'нет ' + src}); continue
                strip = gp.read_bmp(src)
                base = gp.read_bmp(dst) if os.path.isfile(dst) else None
                if base is not None:
                    strip = gp.convert_like(strip, base, src)
                sheet = gp.pack(strip, base, trim=trim)
                n_strip, n_base = strip.w // gp.PW, gp.emotion_count(base) if base is not None else 0
                note = ''
                if n_strip < n_base:
                    note = ' [в ленте %d из %d: %s]' % (n_strip, n_base, 'лишние удалены' if trim else 'остальные из оригинала')
                if base is not None and sheet.px == base.px and sheet.h == base.h:
                    log.append({"cid": cid, "ok": True, "msg": name + ': без изменений'}); continue
                if not dry:
                    if base is not None:
                        bdir = os.path.join(PORTRAITS_DIR, 'backups', stamp)
                        os.makedirs(bdir, exist_ok=True)
                        shutil.copy2(dst, os.path.join(bdir, name + '.bmp'))
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    gp.write_bmp(dst, sheet)
                log.append({"cid": cid, "ok": True, "msg": '%s_faces.bmp → %s.bmp, %d эмоц.%s%s' % (
                    name, name, gp.emotion_count(sheet), note, ' (проверка)' if dry else '')})
            elif direction == 'big':      # charNN_faces_big.bmp -> charNN_faces.bmp
                src, dst = big_path(cid), strip_path(cid)
                if not os.path.isfile(src):
                    log.append({"cid": cid, "ok": False, "msg": 'нет ' + src}); continue
                strip = bigconv.big_to_strip(gp.read_bmp(src), spr_palette())
                if not dry:
                    _backup_strip(dst, stamp)
                    gp.write_bmp(dst, strip)
                log.append({"cid": cid, "ok": True, "msg": '%s_faces_big.bmp → %s_faces.bmp, %d эмоц.%s' % (
                    name, name, strip.w // gp.PW, ' (проверка)' if dry else '')})
            elif direction == 'pixelart':  # пиксельартный прогон по ленте
                dst = strip_path(cid)
                if not os.path.isfile(dst):
                    log.append({"cid": cid, "ok": False, "msg": 'нет ' + dst}); continue
                out, st = bigconv.pixelart_pass(gp.read_bmp(dst), spr_palette())
                if not dry:
                    _backup_strip(dst, stamp)
                    gp.write_bmp(dst, out)
                log.append({"cid": cid, "ok": True, "msg": '%s: локти %d, ступеньки %d, сглаживание %d%s' % (
                    name, st['elbows'], st['stairs'], st['aa'], ' (проверка)' if dry else '')})
            else:
                raise ValueError('direction?')
        except Exception as e:  # noqa: BLE001
            log.append({"cid": cid, "ok": False, "msg": '%s: ОШИБКА — %s' % (name, e)})
    return {"log": log}


# ------------------------------------------------------------------ API

def load_font():
    """font[] from sys8.font.h (same table BubbleGum::setFont(font) uses)."""
    cand = os.path.join(os.path.dirname(CFG['cpp']), 'sys8.font.h')
    if not os.path.isfile(cand):
        cand = None
        for dp, dns, fns in os.walk(CFG['project']):
            dns[:] = [d for d in dns if not d.startswith('.')]
            if 'sys8.font.h' in fns:
                cand = os.path.join(dp, 'sys8.font.h')
                break
    if not cand:
        return None
    with open(cand, 'rb') as fh:
        src = fh.read().decode('latin-1')
    m = re.search(r'\bfont\s*\[\s*\]\s*=\s*\{(.*?)\};', src, re.S)
    if not m:
        return None
    body = re.sub(r'//[^\n]*|/\*.*?\*/', '', m.group(1), flags=re.S)
    return [int(x, 0) for x in re.findall(r'0[xX][0-9a-fA-F]+|\d+', body)]


def load_mission_order():
    """Порядок прохождения миссий из src/mission_order.cpp (массив missionOrder[]).

    Возвращает список ID миссий (индексы dPointers) или [], если файла нет.
    Редактор только показывает миссии в этом порядке; dPointers не трогает.
    """
    path = os.path.join(os.path.dirname(CFG['cpp']), 'mission_order.cpp')
    if not os.path.exists(path):
        return []
    src = read_text(path)[0]
    m = re.search(r'missionOrder\s*\[\s*\d*\s*\]\s*=\s*\{(.*?)\}', src, re.S)
    if not m:
        return []
    body = re.sub(r'//[^\n]*', '', m.group(1))
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    return [int(x) for x in re.findall(r'-?\d+', body)]


def api_load():
    cpp, _, _ = read_text(CFG['cpp'])
    model = dlgcore.load_model(cpp)
    chars = []
    pers = os.path.join(os.path.dirname(CFG['cpp']), 'persons.cpp')
    if os.path.exists(pers):
        chars = dlgcore.parse_characters(read_text(pers)[0])
    portraits = {}
    for cid in range(max(len(chars), 40)):
        n = emotion_count(cid)
        if n:
            portraits[cid] = n
    return {
        "model": model,
        "hash": files_hash(),
        "characters": chars,
        "portraits": portraits,
        "meta": load_meta(),
        "order": load_mission_order(),
        "font": load_font(),
        "paths": {"cpp": CFG['cpp'], "h": CFG['h'], "gfx": CFG['gfx_dirs'],
                  "incFound": len(INC_INDEX)},
        "limits": {str(k): v for k, v in dlgcore.STR_LIMITS.items()},
    }


def api_save(body):
    if body.get('hash') != files_hash() and not body.get('force'):
        return 409, {"error": "Файлы диалогов изменились на диске после загрузки. "
                              "Перезагрузите или сохраните принудительно."}
    cpp, enc_c, _ = read_text(CFG['cpp'])
    h, enc_h, _ = read_text(CFG['h'])
    new_cpp, new_h = dlgcore.save_model(cpp, h, body['model'])
    changed = (new_cpp != cpp) or (new_h != h)
    if changed:
        backup()
        if new_cpp != cpp:
            write_text(CFG['cpp'], new_cpp, enc_c)
        if new_h != h:
            write_text(CFG['h'], new_h, enc_h)
    # return the freshly parsed model so raw texts / spans are in sync
    model = dlgcore.load_model(new_cpp)
    return 200, {"ok": True, "changed": changed, "hash": files_hash(), "model": model}


# ------------------------------------------------------------------ вкладка «Подмена тайлов»

TILESET_CACHE = {}


def _st_table():
    return stcore.paths(CFG['project'])['table']


def _st_hash():
    with open(_st_table(), 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()


def api_tiles_state():
    p = _st_table()
    if not os.path.isfile(p):
        return {"error": "нет %s" % p}
    with open(p, encoding='utf-8') as f:
        _, pairs, _ = stcore.parse_table(f.read())
    for x in pairs:   # в тайлах, как их видит редактор
        for k in ('a', 'b'):
            s = x[k]
            x[k] = {"to": s["to"] // 2, "from": s["from"] // 2, "len": s["len"],
                    "odd": bool(s["to"] % 2 or s["from"] % 2)}
        x.pop('line', None); x.pop('label', None)
    usage = stcore.load_usage(CFG['project'])
    return {"pairs": pairs, "areas": stcore.load_areas(CFG['project']), "use": usage.get("use", {}), "levels": usage.get("levels", {}), "errors": usage.get("errors", []),
            "tilesets": stcore.list_tilesets(CFG['project']), "maps": stcore.list_maps(CFG['project']),
            "vramTiles": stcore.VRAM_TILES, "hash": _st_hash(), "table": p}


def _safe_name(name, ext):
    name = os.path.basename(name or '')
    if not name.endswith(ext):
        raise ValueError('bad name')
    return name


def api_tiles_tileset(bmp, unless):
    path = os.path.join(stcore.paths(CFG['project'])['images'], _safe_name(bmp, '.bmp'))
    key = (path, os.path.getmtime(path), unless)
    if key not in TILESET_CACHE:
        TILESET_CACHE.clear()
        TILESET_CACHE[key] = stcore.compress_tileset(path, unless)
    return TILESET_CACHE[key]


def api_tiles_map(tmx):
    return stcore.read_tmx(os.path.join(stcore.paths(CFG['project'])['resources'], _safe_name(tmx, '.tmx')))


def _tmx_path(tmx):
    return os.path.join(stcore.paths(CFG['project'])['resources'], _safe_name(tmx, '.tmx'))


def _file_hash(p):
    with open(p, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()


def api_tiles_fg(tmx):
    p = _tmx_path(tmx)
    return {"tmx": os.path.basename(p), "list": stcore.read_fgtiles(p), "hash": _file_hash(p)}


def api_tiles_save(body):
    fg = body.get('fg') or []
    if not body.get('force'):
        if body.get('edits') and body.get('hash') != _st_hash():
            return 409, {"error": "supertiles.cpp изменился на диске после загрузки. Перечитайте или сохраните принудительно."}
        for f in fg:
            if _file_hash(_tmx_path(f['tmx'])) != f.get('hash'):
                return 409, {"error": "%s изменился на диске после загрузки (Tiled?). Перечитайте или сохраните принудительно." % f['tmx']}
    stamp = time.strftime('%Y%m%d_%H%M%S')
    new_ids = {}
    for f in fg:
        tp = _tmx_path(f['tmx'])
        os.makedirs(os.path.join(HERE, 'backups'), exist_ok=True)
        shutil.copy2(tp, os.path.join(HERE, 'backups', '%s_%s' % (stamp, os.path.basename(tp))))
        new_ids[f['tmx']] = stcore.save_fgtiles(tp, f.get('changed') or [], f.get('added') or [], f.get('deleted') or [])
    if body.get('areas') is not None:
        ap = stcore.paths(CFG['project'])['areas']
        if os.path.isfile(ap):
            os.makedirs(os.path.join(HERE, 'backups'), exist_ok=True)
            shutil.copy2(ap, os.path.join(HERE, 'backups', '%s_%s' % (stamp, os.path.basename(ap))))
        stcore.save_areas(CFG['project'], body['areas'])
    p = _st_table()
    with open(p, encoding='utf-8') as f:
        old = f.read()
    new = stcore.save_table(old, body.get('edits') or [])
    if new != old:
        os.makedirs(os.path.join(HERE, 'backups'), exist_ok=True)
        shutil.copy2(p, os.path.join(HERE, 'backups', 'supertiles_%s.cpp' % time.strftime('%Y%m%d_%H%M%S')))
        with open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(new)
    if new != old or fg:
        stcore.refresh_usage(CFG['project'])
    return 200, dict(api_tiles_state(), ok=True, changed=(new != old) or bool(fg) or body.get('areas') is not None, newIds=new_ids)


# ------------------------------------------------------------------ вкладка «Группы»

def _gr_paths():
    src = os.path.join(CFG['project'], 'src')
    return os.path.join(src, 'groups.h'), os.path.join(src, 'groups.cpp')


def _gr_hash():
    hh = hashlib.sha1()
    for p in _gr_paths():
        if os.path.isfile(p):
            with open(p, 'rb') as f:
                hh.update(f.read())
    return hh.hexdigest()


def _gr_names():
    pers = os.path.join(CFG['project'], 'src', 'persons.cpp')
    return dlgcore.parse_characters(read_text(pers)[0]) if os.path.isfile(pers) else []


def api_groups_state():
    hp, cp = _gr_paths()
    if not (os.path.isfile(hp) and os.path.isfile(cp)):
        return {"error": "нет %s / %s" % (hp, cp)}
    with open(hp, encoding='utf-8') as f:
        h = f.read()
    with open(cp, encoding='utf-8') as f:
        c = f.read()
    model = grcore.parse(h, c)
    dlg = read_text(CFG['cpp'])[0]
    defaults = grcore.parse_defaults(dlg)
    jp = os.path.join(CFG['project'], 'src', 'jokes.cpp')
    if os.path.isfile(jp):
        defaults['JOKE'] = grcore.parse_joke_defaults(read_text(jp)[0])
    return {"model": model, "situations": grcore.SITUATIONS, "levels": grcore.LEVELS, "textMax": grcore.TEXT_MAX,
            "stats": grcore.STATS, "titleMax": grcore.TITLE_MAX,
            "subjects": grcore.parse_subjects(dlg)[:9], "defaults": defaults,
            "names": _gr_names(), "hash": _gr_hash(), "files": [hp, cp]}


def api_groups_save(body):
    if body.get('hash') != _gr_hash() and not body.get('force'):
        return 409, {"error": "groups.h/.cpp изменились на диске после загрузки. Перечитайте или сохраните принудительно."}
    model = body['model']
    errs = grcore.validate(model)
    if errs:
        return 400, {"error": "; ".join(errs[:5])}
    h, c = grcore.generate(model, _gr_names())
    changed = False
    stamp = time.strftime('%Y%m%d_%H%M%S')
    for path, text in zip(_gr_paths(), (h, c)):
        old = open(path, encoding='utf-8').read() if os.path.isfile(path) else None
        if old != text:
            if old is not None:
                os.makedirs(os.path.join(HERE, 'backups'), exist_ok=True)
                shutil.copy2(path, os.path.join(HERE, 'backups', '%s_%s' % (stamp, os.path.basename(path))))
            with open(path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(text)
            changed = True
    return 200, dict(api_groups_state(), ok=True, changed=changed)


# ------------------------------------------------------------------ вкладка «NPC» (колесо взаимодействий)

def _npc_path():
    return os.path.join(CFG['project'], 'src', 'interactions.cpp')


ICON_CACHE = {}


def api_npc_state():
    p = _npc_path()
    if not os.path.isfile(p):
        return {"error": "нет %s" % p}
    with open(p, encoding='utf-8') as f:
        text = f.read()
    model = incore.parse(text)
    icons = None
    sheet = os.path.join(CFG['project'], 'images', 'mss-01.bmp')
    if os.path.isfile(sheet):
        key = (sheet, os.path.getmtime(sheet))
        if key not in ICON_CACHE:
            ICON_CACHE.clear()
            ICON_CACHE[key] = incore.icon_sheet(sheet)
        icons = ICON_CACHE[key]
    dlg = read_text(CFG['cpp'])[0]
    m = re.search(r"listSubjects\s*\[[^\]]*\]\s*\[[^\]]*\]\s*=\s*\{(.*?)\};", dlg, re.S)
    subjects = [grcore.c_unstr(x) for x in re.findall(grcore.STR_RE, re.sub(r"//[^\n]*", "", m.group(1)))] if m else []
    return {"model": model, "handlers": [dict(does=k[0], attr=k[1], **v) for k, v in incore.HANDLERS.items()],
            "slots": incore.slots(model["npc"]), "icons": icons, "subjects": subjects,
            "nameMax": incore.NAME_MAX, "hash": _file_hash(p), "file": p, "code": text}


def api_npc_save(body):
    p = _npc_path()
    if body.get('hash') != _file_hash(p) and not body.get('force'):
        return 409, {"error": "interactions.cpp изменился на диске после загрузки. Перечитайте или сохраните принудительно."}
    model = body['model']
    errs = incore.validate(model)
    if errs:
        return 400, {"error": "; ".join(errs[:5])}
    text = incore.generate(model)
    with open(p, encoding='utf-8') as f:
        old = f.read()
    if text != old:
        os.makedirs(os.path.join(HERE, 'backups'), exist_ok=True)
        shutil.copy2(p, os.path.join(HERE, 'backups', '%s_interactions.cpp' % time.strftime('%Y%m%d_%H%M%S')))
        with open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    return 200, dict(api_npc_state(), ok=True, changed=text != old)


def api_npc_preview(body):
    model = body['model']
    return {"code": incore.generate(model), "slots": incore.slots(model["npc"]), "errors": incore.validate(model)}


class Handler(BaseHTTPRequestHandler):
    server_version = 'GBDialogueEditor/1.0'

    def log_message(self, fmt, *args):
        if CFG.get('verbose'):
            sys.stderr.write(fmt % args + '\n')

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n).decode('utf-8') or '{}')

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path in ('/', '/index.html'):
                return self._static('index.html')
            if path.startswith('/static/'):
                return self._static(path[len('/static/'):])
            if path == '/api/load':
                with LOCK:
                    return self._send(200, api_load())
            m = re.fullmatch(r'/api/portrait/(\d+)/(\d+)\.png', path)
            if m:
                with LOCK:
                    png = render_portrait(int(m.group(1)), int(m.group(2)))
                if png is None:
                    return self._send(404, {"error": "no portrait"})
                return self._send(200, png, 'image/png')
            if path.startswith('/api/tiles/'):
                q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
                with LOCK:
                    if path == '/api/tiles/state':
                        return self._send(200, api_tiles_state())
                    if path == '/api/tiles/tileset':
                        return self._send(200, api_tiles_tileset(q.get('bmp'), q.get('unless') == '1'))
                    if path == '/api/tiles/fg':
                        return self._send(200, api_tiles_fg(q.get('tmx')))
                    if path == '/api/tiles/map':
                        return self._send(200, api_tiles_map(q.get('tmx')))
            if path == '/api/npc/state':
                with LOCK:
                    return self._send(200, api_npc_state())
            if path == '/api/groups/state':
                with LOCK:
                    return self._send(200, api_groups_state())
            if path == '/api/portraits/status':
                with LOCK:
                    return self._send(200, api_portraits_status())
            m = re.fullmatch(r'/api/sprite/(\d+)\.png', path)
            if m:
                with LOCK:
                    png = render_sprite(int(m.group(1)))
                if png is None:
                    return self._send(404, {"error": "no sprite"})
                return self._send(200, png, 'image/png')
            m = re.fullmatch(r'/api/(sheet|strip)/(\d+)/(\d+)\.png', path)
            if m:
                cid, emo = int(m.group(2)), int(m.group(3))
                is_sheet = m.group(1) == 'sheet'
                with LOCK:
                    png = render_bmp_emotion(sheet_path(cid) if is_sheet else strip_path(cid), is_sheet, emo)
                if png is None:
                    return self._send(404, {"error": "no portrait"})
                return self._send(200, png, 'image/png')
            return self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            return self._send(500, {"error": str(e)})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._body()
            with LOCK:
                if path == '/api/save':
                    code, res = api_save(body)
                    return self._send(code, res)
                if path == '/api/meta':
                    save_meta(body)
                    return self._send(200, {"ok": True})
                if path == '/api/portraits/convert':
                    return self._send(200, api_portraits_convert(body))
                if path == '/api/npc/save':
                    code, res = api_npc_save(body)
                    return self._send(code, res)
                if path == '/api/npc/preview':
                    return self._send(200, api_npc_preview(body))
                if path == '/api/groups/save':
                    code, res = api_groups_save(body)
                    return self._send(code, res)
                if path == '/api/tiles/save':
                    code, res = api_tiles_save(body)
                    return self._send(code, res)
                if path == '/api/rescan':
                    index_inc_files()
                    PORTRAIT_CACHE.clear()
                    return self._send(200, {"ok": True, "incFound": len(INC_INDEX)})
            return self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            return self._send(500, {"error": str(e)})

    def _static(self, rel):
        rel = rel.replace('\\', '/')
        full = os.path.normpath(os.path.join(HERE, 'static', rel))
        if not full.startswith(os.path.join(HERE, 'static')) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        ext = os.path.splitext(full)[1].lower()
        ctype = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                 '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml'}.get(ext, 'application/octet-stream')
        with open(full, 'rb') as fh:
            return self._send(200, fh.read(), ctype)


def main():
    ap = argparse.ArgumentParser(description='Graveblood dialogue editor')
    ap.add_argument('--project', default=os.path.normpath(os.path.join(HERE, '..', '..', 'project')),
                    help='game project dir (default: <editor>/../../project)')
    ap.add_argument('--gfx', action='append', default=None,
                    help='dir(s) to search for charNN.til.inc / charNN.pal.inc (default: whole project)')
    ap.add_argument('--images', default=None,
                    help='dir with portrait sheets charNN.bmp (default: <project>/images)')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--no-browser', action='store_true')
    ap.add_argument('-v', '--verbose', action='store_true')
    a = ap.parse_args()

    CFG['project'] = a.project
    CFG['cpp'] = os.path.join(a.project, 'src', 'dialogues.cpp')
    CFG['h'] = os.path.join(a.project, 'src', 'dialogues.h')
    CFG['gfx_dirs'] = a.gfx or [a.project]
    CFG['verbose'] = a.verbose
    CFG['images'] = a.images or os.path.join(a.project, 'images')
    for p in (CFG['cpp'], CFG['h']):
        if not os.path.isfile(p):
            sys.exit('Не найден файл: %s  (укажите --project)' % p)
    index_inc_files()
    url = 'http://%s:%d/' % (a.host, a.port)
    print('Graveblood Dialogue Editor')
    print('  dialogues : %s' % CFG['cpp'])
    print('  portraits : %d .inc files found' % len(INC_INDEX))
    print('  open      : %s   (Ctrl+C to stop)' % url)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nbye')


if __name__ == '__main__':
    main()
