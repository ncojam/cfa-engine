"""Вкладка «Тайлсет»: чистка тайлсета, упаковка нарисованной картинки в тайлы, сжатие, экспорт tmx.

Как это устроено в движке (см. tools/tmx2incl.cpp, stcore.py):
  * tmx хранит НОМЕР ЯЧЕЙКИ в bmp (gid-1). Дубли и отражения при сборке (tmx2incl bct) схлопываются:
    в ROM и VRAM попадают только уникальные тайлы («сжатый» набор, порядок - по первой ячейке bmp);
  * в VRAM фона грузятся первые VRAM_TILES (864) сжатых тайлов, остальные лежат в ROM и приезжают
    только через подмену (supertiles.cpp, числа «куда/откуда» - в сжатой нумерации).
Отсюда правила инструмента:
  * «удалить тайл» = закрасить ячейку маджентой (прозрачный тайл уже есть в наборе). Номера ячеек не
    меняются, поэтому tmx и wangset'ы в .tsx целы; сжатая нумерация сдвигается - supertiles.cpp
    пересчитывается по содержимому тайлов;
  * новые тайлы кладутся в свободные/новые ячейки; повтор и отражение стоят 0 тайлов VRAM,
    но отражённая копия нужна как ячейка (tmx не умеет флипы).
Тайл - 64 пикселя; идентичность - по 5 старшим битам канала (как ColorCompEqual в tmx2incl).
Ориентация o: бит 0 - зеркало по X, бит 1 - по Y; композиция ориентаций = XOR.
"""
import base64
import hashlib
import heapq
import json
import os
import re
import shutil
import struct
import time
import xml.etree.ElementTree as ET
import zlib

import stcore

T = 8
TP = T * T
MAG_PIX = bytes((255, 0, 255))
MAG_TILE = MAG_PIX * TP
MAG_KEY = ((31 << 10) | 31)
SKIP_MAP = re.compile(r"scrapped|good|red$|replac|for replacing")


# ------------------------------------------------------------------ тайлы: ключи и отражения

def _perm(o):
    p = [0] * TP
    for y in range(T):
        for x in range(T):
            sx = T - 1 - x if o & 1 else x
            sy = T - 1 - y if o & 2 else y
            p[y * T + x] = sy * T + sx
    return p


PERM = [_perm(o) for o in range(4)]


def flip_key(k, o):
    if o == 0:
        return k
    p = PERM[o]
    return tuple(k[i] for i in p)


def flip_rgb(rgb, o):
    if o == 0:
        return rgb
    p = PERM[o]
    return b"".join(rgb[3 * i:3 * i + 3] for i in p)


def rgb_key(rgb):
    return tuple(((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3) for i in range(0, TP * 3, 3))


def is_blank(key):
    return all(v == MAG_KEY for v in key)


# ------------------------------------------------------------------ BMP / PNG

class Bmp:
    """24-битный BMP: заголовок хранится как есть, чтобы переписать файл с минимумом отличий."""

    def __init__(self, w, h, header, rgb):
        self.w, self.h, self.header, self.rgb = w, h, header, rgb   # rgb - сверху вниз, w*h*3 байт

    @staticmethod
    def load(path):
        with open(path, "rb") as f:
            return Bmp.from_bytes(f.read(), path)

    @staticmethod
    def from_bytes(data, what="BMP"):
        if data[:2] != b"BM":
            raise ValueError("%s: не BMP" % what)
        off = struct.unpack_from("<I", data, 10)[0]
        w, h = struct.unpack_from("<ii", data, 18)
        bpp, comp = struct.unpack_from("<HI", data, 28)
        if bpp != 24 or comp != 0:
            raise ValueError("%s: нужен 24-битный BMP без сжатия" % what)
        if h < 0:
            raise ValueError("%s: BMP «сверху вниз» не поддерживается" % what)
        stride = (w * 3 + 3) & ~3
        rgb = bytearray(w * h * 3)
        for y in range(h):
            row = data[off + stride * (h - 1 - y): off + stride * (h - 1 - y) + w * 3]
            o = y * w * 3
            rgb[o:o + w * 3:3] = row[2::3]
            rgb[o + 1:o + w * 3:3] = row[1::3]
            rgb[o + 2:o + w * 3:3] = row[0::3]
        return Bmp(w, h, bytes(data[:off]), bytes(rgb))

    def save(self, path):
        stride = (self.w * 3 + 3) & ~3
        pad = b"\x00" * (stride - self.w * 3)
        rows = []
        for y in range(self.h - 1, -1, -1):
            r = self.rgb[y * self.w * 3:(y + 1) * self.w * 3]
            b = bytearray(len(r))
            b[0::3], b[1::3], b[2::3] = r[2::3], r[1::3], r[0::3]
            rows.append(bytes(b) + pad)
        body = b"".join(rows)
        head = bytearray(self.header)
        struct.pack_into("<I", head, 2, len(head) + len(body))
        struct.pack_into("<i", head, 22, self.h)
        struct.pack_into("<I", head, 34, len(body))
        struct.pack_into("<i", head, 18, self.w)
        tmp = path + ".tmp_tilepack"
        with open(tmp, "wb") as f:
            f.write(bytes(head) + body)
        os.replace(tmp, path)


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else (b if pb <= pc else c)


def read_png(data):
    """-> (w, h, rgb). Прозрачные пиксели (alpha < 128) становятся маджентой."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG")
    pos, plte, trns, idat = 8, None, None, []
    hdr = None
    while pos < len(data):
        ln, typ = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif typ == b"PLTE":
            plte = body
        elif typ == b"tRNS":
            trns = body
        elif typ == b"IDAT":
            idat.append(body)
        elif typ == b"IEND":
            break
    if not hdr:
        raise ValueError("PNG без IHDR")
    w, h, depth, ctype, _, _, inter = hdr
    if inter:
        raise ValueError("PNG с интерлейсом не поддерживается - пересохраните без него")
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(ctype)
    if ch is None or depth not in (1, 2, 4, 8, 16) or (depth < 8 and ctype not in (0, 3)):
        raise ValueError("формат PNG не поддерживается (тип %s, %s бит)" % (ctype, depth))
    raw = zlib.decompress(b"".join(idat))
    bpp = max(1, ch * depth // 8)
    stride = (w * ch * depth + 7) // 8
    rows, prev = [], bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]
        cur = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                cur[i] = (cur[i] + (((cur[i - bpp] if i >= bpp else 0) + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                cur[i] = (cur[i] + _paeth(cur[i - bpp] if i >= bpp else 0, prev[i], prev[i - bpp] if i >= bpp else 0)) & 255
        rows.append(cur)
        prev = cur
    out = bytearray(w * h * 3)
    for y, r in enumerate(rows):
        if depth == 16:
            r = r[0::2]
        if depth < 8:
            mask = (1 << depth) - 1
            vals = []
            for i in range(w):
                bit = i * depth
                vals.append((r[bit >> 3] >> (8 - depth - (bit & 7))) & mask)
        else:
            vals = None
        for x in range(w):
            if ctype == 3:
                i = vals[x] if vals else r[x]
                c = plte[3 * i:3 * i + 3]
                a = trns[i] if trns and i < len(trns) else 255
            elif ctype == 0:
                v = vals[x] * 255 // ((1 << depth) - 1) if vals else r[x]
                c, a = bytes((v, v, v)), 255
            elif ctype == 4:
                c, a = bytes((r[2 * x],) * 3), r[2 * x + 1]
            elif ctype == 2:
                c, a = r[3 * x:3 * x + 3], 255
            else:
                c, a = r[4 * x:4 * x + 3], r[4 * x + 3]
            o = (y * w + x) * 3
            out[o:o + 3] = c if a >= 128 else MAG_PIX
    return w, h, bytes(out)


def write_png(w, h, rgb):
    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + rgb[y * w * 3:(y + 1) * w * 3] for y in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def png_b64(w, h, rgb):
    return "data:image/png;base64," + base64.b64encode(write_png(w, h, rgb)).decode("ascii")


def load_image_bytes(data):
    """PNG или 24-битный BMP -> (w, h, rgb), размеры добиваются маджентой до кратных 8."""
    if data[:2] == b"BM":
        b = Bmp.from_bytes(data, "картинка")
        w, h, rgb = b.w, b.h, b.rgb
    else:
        w, h, rgb = read_png(data)
    padded = False
    if w % T or h % T:
        nw, nh = (w + T - 1) // T * T, (h + T - 1) // T * T
        out = bytearray(MAG_PIX * (nw * nh))
        for y in range(h):
            out[y * nw * 3:y * nw * 3 + w * 3] = rgb[y * w * 3:(y + 1) * w * 3]
        w, h, rgb, padded = nw, nh, bytes(out), True
    return w, h, rgb, padded


# ------------------------------------------------------------------ набор тайлов + «сжатие» как в tmx2incl

def split_cells(w, h, rgb):
    tw, th = w // T, h // T
    cells = []
    for ty in range(th):
        for tx in range(tw):
            cells.append(b"".join(rgb[((ty * T + y) * w + tx * T) * 3:((ty * T + y) * w + tx * T + T) * 3] for y in range(T)))
    return cells


def join_cells(cells, tw, th):
    out = bytearray(tw * T * th * T * 3)
    for ty in range(th):
        for y in range(T):
            row = b"".join(cells[ty * tw + tx][y * T * 3:(y + 1) * T * 3] for tx in range(tw))
            o = (ty * T + y) * tw * T * 3
            out[o:o + len(row)] = row
    return bytes(out)


class Tileset:
    """Ячейки + результат tmx2incl: cls[i] - корневая ячейка класса (повтор/отражение), orient[i] - ориентация
    относительно корня, opt[i] - номер в сжатом наборе, opt_root[k] - корневая ячейка k-го сжатого тайла."""

    def __init__(self, tw, th, cells, keys=None):
        self.tw, self.th, self.cells = tw, th, cells
        self.keys = keys if keys is not None else [rgb_key(c) for c in cells]
        roots, self.cls, self.orient = {}, [], []
        for i, k in enumerate(self.keys):
            best = None
            for o in range(4):
                j = roots.get(flip_key(k, o))
                if j is not None and (best is None or j < best[0]):
                    best = (j, o)
            if best:
                self.cls.append(best[0])
                self.orient.append(best[1])
            else:
                self.cls.append(i)
                self.orient.append(0)
                roots[k] = i
        self.opt_root = [i for i in range(len(cells)) if self.cls[i] == i]
        of = {r: n for n, r in enumerate(self.opt_root)}
        self.opt = [of[self.cls[i]] for i in range(len(cells))]
        self.count = len(self.opt_root)
        self._exact = None
        self._flipmap = None

    @staticmethod
    def from_bmp(b):
        return Tileset(b.w // T, b.h // T, split_cells(b.w, b.h, b.rgb))

    @property
    def exact(self):
        """точный ключ -> наименьшая ячейка с таким содержимым"""
        if self._exact is None:
            d = {}
            for i, k in enumerate(self.keys):
                d.setdefault(k, i)
            self._exact = d
        return self._exact

    @property
    def flipmap(self):
        """ключ любого отражения корня -> (корень, o): rep_нового == flip(rep_корня, o)"""
        if self._flipmap is None:
            d = {}
            for r in self.opt_root:
                for o in range(4):
                    d.setdefault(flip_key(self.keys[r], o), (r, o))
            self._flipmap = d
        return self._flipmap

    def to_bmp(self, header):
        return Bmp(self.tw * T, self.th * T, header, join_cells(self.cells, self.tw, self.th))

    def derive(self, blank=(), put=None, new_th=None):
        """копия: ячейки blank закрашены маджентой, put {ячейка: rgb} записаны, высота - new_th тайлов"""
        cells, keys = list(self.cells), list(self.keys)
        mk = rgb_key(MAG_TILE)
        for c in blank:
            cells[c], keys[c] = MAG_TILE, mk
        th = new_th or self.th
        if th > self.th:
            extra = (th - self.th) * self.tw
            cells += [MAG_TILE] * extra
            keys += [mk] * extra
        for c, rgb in (put or {}).items():
            cells[c], keys[c] = rgb, rgb_key(rgb)
        return Tileset(self.tw, th, cells, keys)


_TS_CACHE = {}


def load_tileset(path):
    key = (path, os.path.getmtime(path))
    if key not in _TS_CACHE:
        _TS_CACHE.clear()
        b = Bmp.load(path)
        _TS_CACHE[key] = (Tileset.from_bmp(b), b)
    return _TS_CACHE[key]


# ------------------------------------------------------------------ карты

_MAP_CACHE = {}


def read_layers(path):
    """слои tmx: [{name, visible, w, h, gids}] (gid без флагов), firstgid'ы тайлсетов"""
    key = (path, os.path.getmtime(path))
    if key in _MAP_CACHE:
        return _MAP_CACHE[key]
    root = ET.parse(path).getroot()
    firsts = [int(t.get("firstgid", "1")) for t in root.findall("tileset")]
    layers = []
    for l in root.iter("layer"):
        d = l.find("data")
        if d is None or (d.get("encoding") or "") != "csv":
            continue
        gids = [int(v) & 0x1FFFFFFF for v in re.split(r"[,\s]+", d.text.strip()) if v]
        layers.append({"name": l.get("name") or "", "visible": l.get("visible") != "0",
                       "w": int(l.get("width")), "h": int(l.get("height")), "gids": gids})
    _MAP_CACHE.clear()
    _MAP_CACHE[key] = (layers, firsts)
    return _MAP_CACHE[key]


def map_name(tmx):
    return tmx[len("map-"):-len(".tmx")] if tmx.startswith("map-") else tmx[:-len(".tmx")]


def default_layers(layers):
    """по умолчанию тайлы ВСЕХ слоёв считаются занятыми: скрытые слои (стены, эскиз) в Tiled нужны глазу"""
    return [l["name"] for l in layers]


def used_cells(project, tmxs, layer_sel, n, all_layers=False):
    """множество ячеек bmp, на которые ссылаются слои выбранных карт"""
    res = set()
    for tmx in tmxs:
        layers, firsts = read_layers(os.path.join(stcore.paths(project)["resources"], os.path.basename(tmx)))
        first = firsts[0] if firsts else 1
        want = None if all_layers else set(layer_sel.get(tmx) or default_layers(layers))
        for l in layers:
            if want is not None and l["name"] not in want:
                continue
            for g in set(l["gids"]):
                if g >= first and g - first < n:
                    res.add(g - first)
    return res


# ------------------------------------------------------------------ контекст: что используется / защищено

def ts_path(project, bmp):
    return os.path.join(stcore.paths(project)["images"], os.path.basename(bmp))


def bmp_maps(project, bmp):
    """карты, собираемые с этим bmp (строки build_graphics.sh), без черновиков"""
    res = []
    for g in stcore.graphics_lines(project):
        if g["bmp"] == os.path.basename(bmp) and g["tmx"] not in res and not SKIP_MAP.search(g["tmx"]):
            res.append(g["tmx"])
    return res


_USAGE = {}


def _head(path, n=6000):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read(n)


def map_tileset_bmp(project, tmx):
    """bmp, на который (через .tsx) ссылается первый тайлсет карты, или ''"""
    res = stcore.paths(project)["resources"]
    try:
        m = re.search(r'<tileset\b[^>]*\bsource="([^"]+)"', _head(os.path.join(res, tmx)))
        if not m:
            return ""
        t = re.search(r'<image\b[^>]*\bsource="([^"]+)"', _head(os.path.normpath(os.path.join(res, m.group(1)))))
        return os.path.basename(t.group(1)) if t else ""
    except OSError:
        return ""


def all_maps(project):
    """все tmx из resources: [{tmx, bmp}] - bmp тайлсета по .tsx (для подсказки, выбор - за пользователем)"""
    res = stcore.paths(project)["resources"]
    return [{"tmx": f, "bmp": map_tileset_bmp(project, f)} for f in sorted(os.listdir(res)) if f.endswith(".tmx")]


def default_maps(project, bmp):
    """карты, предвыбранные для тайлсета: собираемые с ним по build_graphics.sh + ссылающиеся на него по .tsx"""
    res = list(bmp_maps(project, bmp))
    for m in all_maps(project):
        if m["bmp"] == os.path.basename(bmp) and m["tmx"] not in res and not SKIP_MAP.search(m["tmx"]):
            res.append(m["tmx"])
    return res


def protected_classes(project, ts, tmxs):
    """классы тайлов из диапазонов подмены (куда и откуда) пар, которые используют карты этого тайлсета"""
    info = {"pairs": [], "classes": set(), "errors": [], "ranges": []}
    table = stcore.paths(project)["table"]
    if not os.path.isfile(table):
        info["errors"].append("нет %s - подмена не учтена" % table)
        return info
    names = {map_name(t) for t in tmxs}
    ck = (project, os.path.getmtime(table))
    if _USAGE.get("k") != ck or time.time() - _USAGE.get("t", 0) > 30:
        _USAGE.update(k=ck, t=time.time(), v=stcore.load_usage(project))
    usage = _USAGE["v"]
    info["errors"] += usage.get("errors", [])
    ids = set()
    for st, wheres in (usage.get("use") or {}).items():
        if any(w.split(" ")[0] in names for w in wheres):
            ids.add(int(st) // 2)
    with open(table, encoding="utf-8") as f:
        _, pairs, _ = stcore.parse_table(f.read())
    for pi in sorted(ids):
        if pi >= len(pairs):
            continue
        for side in "ab":
            s = pairs[pi][side]
            for key in ("to", "from"):
                a = s[key] // 2
                roots = [ts.opt_root[k] for k in range(a, min(a + s["len"], ts.count))]
                info["classes"].update(roots)
                if roots:   # в этом отрезке ячеек bmp ничего нового появиться не должно: диапазон перестанет быть сплошным
                    info["ranges"].append((min(roots), max(roots)))
        info["pairs"].append(pi)
    return info


def blank_class(ts):
    """корень прозрачного тайла (все пиксели - маджента) или None"""
    r = ts.flipmap.get(tuple([MAG_KEY] * TP))
    return r[0] if r else None


def scan(project, bmp, tmxs, layer_sel=None, limit=stcore.VRAM_TILES):
    """u - используется, p - нужен подмене, d - не используется, но копия/отражение используемого,
    f - не используется. groups: корень класса -> его ячейки для ВСЕХ классов, которые можно снести
    (кроме нужных подмене и прозрачного); используемые тоже: пользователь вправе убрать то, что карта
    сейчас показывает (например старое здание)."""
    ts, _ = load_tileset(ts_path(project, bmp))
    used = used_cells(project, tmxs, layer_sel or {}, len(ts.cells))
    used_cls = {ts.cls[c] for c in used}
    prot = protected_classes(project, ts, tmxs)
    bc = blank_class(ts)
    keep_cls = set(used_cls) | prot["classes"]
    if bc is not None:
        keep_cls.add(bc)
    status, groups = [], {}
    for c in range(len(ts.cells)):
        k = ts.cls[c]
        if k in prot["classes"]:
            status.append("u" if c in used else "p")
        elif c in used:
            status.append("u")
        elif k in used_cls or k == bc:
            status.append("d")
        else:
            status.append("f")
        if k not in prot["classes"] and k != bc:
            groups.setdefault(k, []).append(c)
    unused = [k for k, cells in groups.items() if k not in used_cls]
    return {"ts": ts, "used": used, "used_cls": used_cls, "prot": prot, "keep_cls": keep_cls, "blank": bc,
            "status": "".join(status), "groups": groups, "unused": unused, "limit": limit}


# ------------------------------------------------------------------ картинка

_PICS = {}


class Pic:
    def __init__(self, w, h, rgb, name="", padded=False):
        self.w, self.h, self.rgb, self.name, self.padded = w, h, rgb, name, padded
        self.ts = Tileset(w // T, h // T, split_cells(w, h, rgb))
        self.id = hashlib.sha1(rgb + struct.pack("<II", w, h)).hexdigest()[:12]
        self.count = {}
        for c in self.ts.cls:
            self.count[c] = self.count.get(c, 0) + 1

    @property
    def classes(self):
        return self.ts.opt_root      # представитель класса - первая ячейка картинки


def add_pic(name, data):
    w, h, rgb, padded = load_image_bytes(data)
    p = Pic(w, h, rgb, name, padded)
    _PICS.clear()
    _PICS[p.id] = p
    return p


def get_pic(pid):
    p = _PICS.get(pid)
    if not p:
        raise ValueError("картинка не загружена на сервер (он перезапускался?) - загрузите её заново")
    return p


# ------------------------------------------------------------------ расстояния и подбор замен

def _vec(key):
    return tuple([(v >> 10) & 31 for v in key] + [(v >> 5) & 31 for v in key] + [v & 31 for v in key])


def _sig(key):
    """средний цвет четырёх четвертей тайла (TL, TR, BL, BR) - грубый ключ для отбора кандидатов"""
    q = []
    for qy in (0, 4):
        for qx in (0, 4):
            r = g = b = 0
            for y in range(qy, qy + 4):
                for x in range(qx, qx + 4):
                    v = key[y * T + x]
                    r += (v >> 10) & 31
                    g += (v >> 5) & 31
                    b += v & 31
            q += [r, g, b]
    return q


_SIGPERM = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]]   # перестановка четвертей при флипе o


def _sig_flip(sig, o):
    q = _SIGPERM[o]
    return [v for i in q for v in sig[3 * i:3 * i + 3]]


def tile_dist(ka, kb, o):
    """сумма квадратов разности каналов (5 бит) между ka и flip(kb, o)"""
    va, vb = _vec(ka), _vec(flip_key(kb, o))
    return sum((x - y) * (x - y) for x, y in zip(va, vb))


class Pool:
    """кандидаты на замену: id ('e<ячейка>' / 'p<ячейка>') -> ключ представителя"""

    def __init__(self, items):
        self.ids = [i for i, _ in items]
        self.keys = {i: k for i, k in items}
        self.sigs = {i: _sig(k) for i, k in items}
        self.sigf = {i: [_sig_flip(self.sigs[i], o) for o in range(4)] for i in self.ids}


def best_candidates(skey, ssig, pool, exclude, top=6):
    """лучшие замены тайла (skey): [(dist, id, o)] по возрастанию точной ошибки"""
    short = []
    for i in pool.ids:
        if i in exclude:
            continue
        sf = pool.sigf[i]
        for o in range(4):
            d = 0
            f = sf[o]
            for a, b in zip(ssig, f):
                d += (a - b) * (a - b)
            short.append((d, i, o))
    short.sort()
    seen, out = set(), []
    for _, i, o in short[:top * 3]:
        if (i, o) in seen:
            continue
        seen.add((i, o))
        out.append((tile_dist(skey, pool.keys[i], o), i, o))
        if len(seen) >= top * 2:
            break
    out.sort()
    res, ids = [], set()
    for d, i, o in out:          # по одному варианту на тайл-цель
        if i in ids:
            continue
        ids.add(i)
        res.append((d, i, o))
        if len(res) >= top:
            break
    return res


def pic_state(pic, ts1):
    """классы картинки: reuse {pid: (eid, o)} - уже есть в тайлсете (0 новых тайлов), new - список pid"""
    reuse, new = {}, []
    for r in pic.classes:
        pid = "p%d" % r
        hit = ts1.flipmap.get(pic.ts.keys[r])
        if hit:
            reuse[pid] = ("e%d" % hit[0], hit[1])
        else:
            new.append(pid)
    return reuse, new


def make_pool(ts1, pic, new, allow_existing=True, allow_new=True):
    items = []
    if allow_existing:
        items += [("e%d" % r, ts1.keys[r]) for r in ts1.opt_root]
    if allow_new:
        items += [(pid, pic.ts.keys[int(pid[1:])]) for pid in new]
    return Pool(items)


def suggest(pic, ts1, new, allow_existing=True, allow_new=True, top=5, only=None, skip=()):
    """для новых классов картинки лучшие замены: {pid: [{id, o, d}]}; цели - тайлы тайлсета и другие новые классы"""
    pool = make_pool(ts1, pic, [p for p in new if p not in skip], allow_existing, allow_new)
    res = {}
    for pid in (only if only is not None else new):
        k = pic.ts.keys[int(pid[1:])]
        res[pid] = [{"id": i, "o": o, "d": d} for d, i, o in best_candidates(k, _sig(k), pool, {pid}, top)]
    return res


def resolve(pid, repl, reuse):
    """цепочка замен -> (конечный id, o); цикл - ошибка"""
    o, seen = 0, {pid}
    while True:
        if pid in reuse:
            t, oo = reuse[pid]
            return t, o ^ oo
        r = repl.get(pid)
        if not r:
            return pid, o
        pid, o = r["to"], o ^ r["o"]
        if pid in seen:
            raise ValueError("цикл замен на %s" % pid)
        seen.add(pid)
        if pid.startswith("e"):
            return pid, o


def auto_compress(pic, ts1, new, repl, locked, need, allow_existing=True, allow_new=True, sugg=None):
    """жадно: пока замен меньше need, берём самую дешёвую (ошибка * сколько раз тайл встречается в картинке)"""
    repl = {k: dict(v) for k, v in repl.items()}
    weight = {pid: pic.count[int(pid[1:])] for pid in new}
    for pid in list(repl):                   # вклад замен, сделанных вручную
        t, _ = resolve(pid, repl, {})
        if t in weight and t != pid:
            weight[t] += weight[pid]
    removed = len(repl)
    for rnd in range(3):
        todo = [p for p in new if p not in repl and p not in locked]
        if removed >= need or not todo:
            break
        cands = sugg if (rnd == 0 and sugg) else suggest(pic, ts1, new, allow_existing, allow_new, 6, only=todo, skip=set(repl))
        heap = []
        for pid in todo:
            for c in cands.get(pid, []):
                heapq.heappush(heap, (weight[pid] * c["d"], pid, c["id"], c["o"], c["d"]))
        while heap and removed < need:
            cost, pid, tid, o, d = heapq.heappop(heap)
            if pid in repl or pid in locked or (tid.startswith("p") and tid in repl):
                continue
            cur = weight[pid] * d
            if cur > cost + 1e-9:            # вес цели вырос - цена поменялась
                heapq.heappush(heap, (cur, pid, tid, o, d))
                continue
            try:
                t, _ = resolve(tid, repl, {})
            except ValueError:
                continue
            if t == pid:
                continue
            repl[pid] = {"to": tid, "o": o, "d": d}
            if tid.startswith("p"):
                weight[tid] += weight[pid]
            removed += 1
    return repl


# ------------------------------------------------------------------ итоговая картинка и содержимое ячеек

def final_cells(pic, ts1, reuse, repl, skip=()):
    """для каждой ячейки картинки итоговое содержимое rgb (после замен) и признак «изменено»"""
    out, changed = [], 0
    for c in range(len(pic.ts.cells)):
        pid = "p%d" % pic.ts.cls[c]
        if pid in skip:                      # неучтённый тайл: в тайлсет не идёт, на карте - пустая клетка
            out.append(MAG_TILE)
            changed += 1
            continue
        t, o = resolve(pid, repl, reuse)
        p = pic.ts.orient[c]
        if t == pid and o == 0:
            rgb = pic.ts.cells[c]
        elif t.startswith("e"):
            rgb = flip_rgb(ts1.cells[int(t[1:])], o ^ p)
        else:
            rgb = flip_rgb(pic.ts.cells[int(t[1:])], o ^ p)
        if rgb_key(rgb) != pic.ts.keys[c]:
            changed += 1
        out.append(rgb)
    return out, changed


def pic_error(pic, final):
    tot, mx = 0, 0
    for c, rgb in enumerate(final):
        ka, kb = pic.ts.keys[c], rgb_key(rgb)
        if ka != kb:
            d = sum((x - y) ** 2 for x, y in zip(_vec(ka), _vec(kb)))
            tot += d
            mx = max(mx, d)
    return tot, mx


# ------------------------------------------------------------------ раскладка новых ячеек

def needed_cells(pic, ts1, final):
    """уникальное содержимое, которого ещё нет в тайлсете: [{key, rgb, cells}] в порядке картинки.
    Полностью прозрачные тайлы - это пустая клетка tmx (gid 0), в тайлсет не идут."""
    items, index = [], {}
    for c, rgb in enumerate(final):
        k = rgb_key(rgb)
        if is_blank(k) or k in ts1.exact:
            continue
        if k not in index:
            index[k] = len(items)
            items.append({"key": k, "rgb": rgb, "cells": []})
        items[index[k]]["cells"].append(c)
    return items


def runs_of(pic, items):
    """горизонтальные куски картинки, которые идут подряд и нуждаются в новых ячейках: [[индексы items]]"""
    owner = {}
    for n, it in enumerate(items):
        owner[it["cells"][0]] = n          # ячейка, где тайл появился впервые
    runs, cur = [], []
    for c in range(len(pic.ts.cells)):
        if c in owner:
            if cur and c % pic.ts.tw == 0:
                runs.append(cur)
                cur = []
            cur.append(owner[c])
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return runs


def layout(runs, n_items, width, mode):
    """-> ([(row, col)] для каждого item, rows). scan: сплошная лента в порядке картинки;
    packed: куски не рвутся, длинные - первыми, пустоты в хвостах строк добиваются короткими."""
    width = max(1, width)
    pos = [None] * n_items
    if mode == "scan":
        k = 0
        for run in runs:
            for n in run:
                pos[n] = (k // width, k % width)
                k += 1
        return pos, (k + width - 1) // width
    chunks = []
    for run in runs:
        for i in range(0, len(run), width):
            chunks.append(run[i:i + width])
    chunks.sort(key=lambda r: -len(r))
    used = []
    for ch in chunks:
        for r, u in enumerate(used):
            if width - u >= len(ch):
                break
        else:
            used.append(0)
            r = len(used) - 1
        for i, n in enumerate(ch):
            pos[n] = (r, used[r] + i)
        used[r] += len(ch)
    return pos, len(used)


# ------------------------------------------------------------------ подмена тайлов: пересчёт после сдвига

def pair_edits(project, old_ts, new_ts, pair_ids):
    """пересчитать «куда/откуда» пар по содержимому тайлов -> (edits для stcore.save_table, ошибки)"""
    table = stcore.paths(project)["table"]
    with open(table, encoding="utf-8") as f:
        text = f.read()
    _, pairs, _ = stcore.parse_table(text)
    edits, errs = [], []
    for pi in pair_ids:
        p = pairs[pi]
        e = {"idx": pi, "name_a": p["name_a"], "name_b": p["name_b"]}
        changed = False
        for side in "ab":
            s = p[side]
            ns = {"len": s["len"]}
            for key in ("to", "from"):
                if s[key] % 2:
                    errs.append("пара %d: нечётное значение %s=%d (полутайлы) - сдвиг невозможен" % (pi, key, s[key]))
                    ns[key] = s[key] // 2
                    continue
                a = s[key] // 2
                if a + s["len"] > old_ts.count:
                    errs.append("пара %d: %s выходит за сжатый набор (%d+%d > %d)" % (pi, key, a, s["len"], old_ts.count))
                    ns[key] = a
                    continue
                idx = []
                for k in range(a, a + s["len"]):
                    r = old_ts.opt_root[k]
                    if new_ts.cls[r] != r or new_ts.keys[r] != old_ts.keys[r]:
                        errs.append("пара %d: тайл %d (%s) потерял корневую ячейку или перевернулся" % (pi, k, key))
                    idx.append(new_ts.opt[r])
                if any(b - a2 != 1 for a2, b in zip(idx, idx[1:])):
                    errs.append("пара %d: диапазон %s=%d..%d перестал быть сплошным (новые тайлы встали внутрь)" % (pi, key, a, a + s["len"] - 1))
                ns[key] = idx[0] if idx else a
                changed = changed or ns[key] != a
            e[side] = ns
        if changed:
            edits.append(e)
    return text, edits, errs


# ------------------------------------------------------------------ главный расчёт плана

def colors_of(cells):
    s = set()
    for c in cells:
        for i in range(0, TP * 3, 3):
            s.add((c[i] >> 3, c[i + 1] >> 3, c[i + 2] >> 3))
    return s


PAL_MAX = 255            # цветов в палитре (с маджентой), 5 бит на канал


def reduce_colors(final, base, cap=PAL_MAX):
    """если цветов (5 бит) станет больше cap, самые редкие/близкие новые цвета заменяются ближайшими:
    финальные ячейки меняются (только новые цвета, цвета самого тайлсета base не трогаются) -> (ячейки, сколько цветов слито)"""
    w = {}
    for c in final:
        for i in range(0, TP * 3, 3):
            col = (c[i] >> 3, c[i + 1] >> 3, c[i + 2] >> 3)
            if col not in base:
                w[col] = w.get(col, 0) + 1
    over = len(base) + len(w) - cap
    if over <= 0:
        return final, 0
    targets = set(base) | set(w)
    d2 = lambda a, b: (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

    def nearest(c):
        best = None
        for t in targets:
            if t != c:
                d = d2(c, t)
                if best is None or d < best[0]:
                    best = (d, t)
        return best
    near = {c: nearest(c) for c in w}
    mapping = {}
    for _ in range(over):
        c = min(near, key=lambda x: w[x] * near[x][0])
        d, t = near.pop(c)
        mapping[c] = t
        targets.discard(c)
        if t in w:
            w[t] += w[c]
        for x in near:
            if near[x][1] in (c, t):
                near[x] = nearest(x)
    def fin(col):
        while col in mapping:
            col = mapping[col]
        return col
    out = []
    for c in final:
        b = bytearray(c)
        for i in range(0, TP * 3, 3):
            col = (c[i] >> 3, c[i + 1] >> 3, c[i + 2] >> 3)
            if col in mapping:
                n = fin(col)
                b[i], b[i + 1], b[i + 2] = n[0] << 3, n[1] << 3, n[2] << 3
        out.append(bytes(b))
    return out, len(mapping)


def canon(key):
    return min(flip_key(key, o) for o in range(4))


def plan(project, P, images=False, auto=False, with_suggest=False):
    """P: bmp, maps, layers, limit, delete [корни классов], img, repl, locked, auto{existing,new},
    layout{mode,width}, place{mode,row,col}. Ничего не пишет на диск."""
    bmp = P["bmp"]
    tmxs = P.get("maps") or bmp_maps(project, bmp)
    limit = int(P.get("limit") or stcore.VRAM_TILES)
    sc = scan(project, bmp, tmxs, P.get("layers"), limit)
    ts0 = sc["ts"]
    out = {"limit": limit, "errors": [], "warnings": []}
    # --- шаги 1-2: удаление и место
    dele = [int(x) for x in P.get("delete") or [] if int(x) in sc["groups"]]
    del_cells = [c for r in dele for c in sc["groups"][r]]
    areas = sorted({int(c) for c in P.get("areas") or [] if 0 <= int(c) < len(ts0.cells)})
    byc = {}
    for d in range(len(ts0.cells)):
        byc.setdefault(ts0.cls[d], []).append(d)
    pmap = {}                                # ячейка области -> ячейка с её отражением по X (уже есть в тайлсете)
    for c in areas:
        cand = [d for d in byc[ts0.cls[c]] if ts0.orient[d] == ts0.orient[c] ^ 1]
        if cand:
            pmap[c] = min(cand, key=lambda d: (d in areas, d))
    areas_all = sorted(set(areas) | set(pmap.values()))
    ts1 = ts0.derive(blank=del_cells + areas_all)
    pcls = sc["prot"]["classes"]
    keep_cells = set(sc["used"]) | {c for c in range(len(ts0.cells)) if ts0.cls[c] in pcls}

    def keep_of(ts):
        k = {ts.cls[c] for c in keep_cells}
        b = blank_class(ts)
        if b is not None:
            k.add(b)
        return k
    keep0, keep1 = keep_of(ts0), keep_of(ts1)
    skip = set(P.get("skip") or [])
    out["tiles"] = {"raw": len(ts0.cells), "opt": ts0.count, "optAfterDelete": ts1.count, "deleted": len(dele),
                    "deletedCells": len(del_cells), "displayed": len(sc["used_cls"]),
                    "protectedOnly": len(pcls - sc["used_cls"]), "freeable": len(sc["groups"]),
                    "unusedClasses": len(sc["unused"]), "keepBefore": len(keep0), "keepAfter": len(keep1),
                    "leftover": ts1.count - len(keep1), "free": limit - len(keep1),
                    "beyond": max(0, ts1.count - limit), "areas": len(areas), "mirrorAreas": len(set(pmap.values()) - set(areas)), "mirrorCells": sorted(set(pmap.values()) - set(areas)),
                    "usedInAreas": sum(1 for c in areas if c in sc["used"])}
    if out["tiles"]["usedInAreas"]:
        out["warnings"].append("%d используемых картой ячеек лежат в областях подмены: их содержимое будет перезаписано" % out["tiles"]["usedInAreas"])
    out["pairs"] = sc["prot"]["pairs"]
    out["warnings"] += sc["prot"]["errors"]
    if sc["blank"] is None:
        out["warnings"].append("в тайлсете нет полностью прозрачного (маджента) тайла: удаление и пустые клетки добавят один тайл")
    out["_sc"], out["_ts0"], out["_ts1"], out["_ts2"] = sc, ts0, ts1, ts1
    if not P.get("img"):
        return out
    # --- шаг 3: картинка
    pic = get_pic(P["img"])
    reuse_all, new_all = pic_state(pic, ts1)
    bk = blank_class(pic.ts)
    skip = {p for p in skip if p in reuse_all or p in new_all}
    reuse = {k: v for k, v in reuse_all.items() if k not in skip}
    new = [p for p in new_all if p not in skip]
    repl = {k: v for k, v in (P.get("repl") or {}).items() if k in new and v.get("to") not in skip}
    locked = set(P.get("locked") or [])
    ac = P.get("auto") or {}
    free = limit - len(keep1)
    extra = len({(ts1.cls[ts1.exact[k]] if k in ts1.exact else ts1.flipmap[k][0]) for k in (pic.ts.keys[int(p[1:])] for p in reuse)
                 if not is_blank(k)} - keep1)
    sugg = None
    if with_suggest or auto:
        sugg = suggest(pic, ts1, new, ac.get("existing", True), ac.get("new", True))
        out["suggest"] = sugg
    if auto:
        left = len([p for p in new if p not in repl])
        repl = auto_compress(pic, ts1, new, repl, locked, len(repl) + max(0, left - max(0, free - extra)),
                             ac.get("existing", True), ac.get("new", True), sugg)
    for pid_, r in repl.items():
        resolve(pid_, repl, reuse)          # цикл замен -> ValueError
        if "d" not in r:                    # цена ручной замены
            tk = ts1.keys[int(r["to"][1:])] if r["to"].startswith("e") else pic.ts.keys[int(r["to"][1:])]
            r["d"] = tile_dist(pic.ts.keys[int(pid_[1:])], tk, r["o"])
    final, changed = final_cells(pic, ts1, reuse, repl, skip)
    final, merged = reduce_colors(final, colors_of(ts1.cells))
    if merged:
        out["warnings"].append("цветов было больше %d: %d самых близких/редких новых цветов слито с похожими" % (PAL_MAX, merged))
    err_total, err_max = pic_error(pic, final)
    items = needed_cells(pic, ts1, final)
    # новых тайлов VRAM: классы нужных ячеек, которых ещё нет в наборе (зеркальные копии существующих - бесплатно)
    need_set = set()
    for rgb in final:
        k = rgb_key(rgb)
        if is_blank(k):
            continue
        hit = ts1.flipmap.get(k)
        if hit is None:
            need_set.add(("n", canon(k)))
        elif hit[0] not in keep1:
            need_set.add(("e", hit[0]))
    need_tiles = len(need_set)
    out["pic"] = {"id": pic.id, "name": pic.name, "w": pic.ts.tw, "h": pic.ts.th, "cells": len(pic.ts.cells),
                  "padded": pic.padded, "blankCells": sum(1 for k in pic.ts.keys if is_blank(k)),
                  "uniqueExact": len(set(pic.ts.keys)), "classes": len(pic.classes), "reused": len(reuse),
                  "new": len(new), "replaced": len(repl), "needTiles": need_tiles, "newCells": len(items),
                  "fits": need_tiles <= free, "overflow": max(0, need_tiles - free), "changedCells": changed,
                  "skipped": len(skip), "free": free, "mergedColors": merged, "cellCls": list(pic.ts.cls),
                  "errTotal": err_total, "errMax": err_max,
                  "colors": len(colors_of(pic.ts.cells)), "newColors": len(colors_of(pic.ts.cells) - colors_of(ts1.cells))}
    out["classes"] = [{"id": p, "cell": int(p[1:]), "count": pic.count[int(p[1:])], "skip": p in skip}
                      for p in new_all if p in new or p in skip]
    out["picCls"] = [{"id": "p%d" % r, "cell": r, "count": pic.count[r], "reuse": ("p%d" % r) in reuse_all,
                      "skip": ("p%d" % r) in skip, "blank": r == bk} for r in pic.classes]
    out["reuse"] = {k: {"to": v[0], "o": v[1]} for k, v in reuse.items()}
    out["repl"] = repl
    # --- шаг 4-5: раскладка и размещение
    lay, place = P.get("layout") or {}, P.get("place") or {}
    mode = lay.get("mode", "packed")
    col0 = max(0, min(int(place.get("col", 0) or 0), ts0.tw - 1))
    width = max(1, min(int(lay.get("width") or ts0.tw), ts0.tw - col0))
    pos, rows = layout(runs_of(pic, items), len(items), width, mode)
    pmode = place.get("mode", "append")
    row0 = ts0.th if pmode != "cell" else max(0, int(place.get("row", ts0.th) or 0))
    abs_cells = [(row0 + r) * ts0.tw + col0 + c for r, c in pos]
    new_th = max(ts0.th, row0 + rows) if items else ts0.th
    refs = used_cells(project, tmxs, {}, len(ts0.cells), all_layers=True) if items else set()
    roots = set(ts1.opt_root)
    prot, ranges = sc["prot"]["classes"], sc["prot"]["ranges"]
    bl_root = blank_class(ts1)
    aset = set(areas_all) - {bl_root}

    def usable(a, key):
        """в ячейку a можно положить тайл key: она пуста и не нужна, не лежит внутри диапазона подмены и
        (для отражённой копии защищённого тайла) не раньше его корня - иначе корень перевернётся"""
        if a in aset:                        # область подмены: можно писать в любую (кроме корня прозрачного тайла)
            return True
        if a < len(ts0.cells) and (not is_blank(ts1.keys[a]) or a in refs or a in roots):
            return False
        if any(lo <= a <= hi for lo, hi in ranges):
            return False
        hit = ts1.flipmap.get(key)
        return not (hit and hit[0] in prot and a < hit[0])

    conflicts = []
    if items and pmode == "holes":
        taken, abs_cells = set(), [None] * len(items)
        # оригиналы - в область, их отражения по X - в ячейки, где лежали отражения прежних тайлов области
        mir = {c: d for c, d in pmap.items() if c in aset and d in aset}
        groups = {}
        for n, it in enumerate(items):
            groups.setdefault(canon(it["key"]), []).append(n)
        pairs_ = []
        for ns in groups.values():
            vx = [n for n in ns[1:] if items[n]["key"] == flip_key(items[ns[0]]["key"], 1)]
            pairs_.append((ns[0], vx[0] if vx else None))
        with_p = [c for c in areas if c in mir]
        without = [c for c in areas if c in aset and c not in mir]
        for b_, v_ in [p for p in pairs_ if p[1] is not None]:
            c = next((c for c in with_p if c not in taken and mir[c] not in taken and mir[c] != c), None)
            if c is not None:                 # у разных ячеек области отражение может быть общим - берём каждую ячейку один раз
                abs_cells[b_], abs_cells[v_] = c, mir[c]
                taken.update((c, mir[c]))
        rest = [c for c in without + with_p if c not in taken]
        for b_, v_ in [p for p in pairs_ if p[1] is None]:
            rest = [c for c in rest if c not in taken]
            if rest:
                abs_cells[b_] = rest.pop(0)
                taken.add(abs_cells[b_])
        free_cells = sorted(aset) + [c for c in range(len(ts0.cells))
                                     if c not in aset and is_blank(ts1.keys[c]) and c not in refs and c not in roots]
        tail = len(ts0.cells)
        for n in [n for run in runs_of(pic, items) for n in run if abs_cells[n] is None]:
            for c in free_cells:
                if c not in taken and usable(c, items[n]["key"]):
                    abs_cells[n] = c
                    break
            else:
                abs_cells[n] = tail
                tail += 1
            taken.add(abs_cells[n])
        if len(set(abs_cells)) != len(abs_cells):
            raise ValueError("внутренняя ошибка раскладки: две ячейки картинки попали в одну - пришлите область подмены и картинку")
        new_th = max(ts0.th, (max(abs_cells) // ts0.tw) + 1)
        rows, row0, col0 = new_th - ts0.th, ts0.th, 0
    elif items:
        conflicts = [a for n, a in enumerate(abs_cells) if not usable(a, items[n]["key"])]
    out["layout"] = {"mode": mode, "width": width, "rows": rows, "row0": row0, "col0": col0, "newTh": new_th,
                     "pos": [[a // ts0.tw, a % ts0.tw] for a in abs_cells], "conflicts": conflicts}
    ts2 = None if conflicts else ts1.derive(put={a: items[n]["rgb"] for n, a in enumerate(abs_cells)}, new_th=new_th)
    out["_pic"], out["_final"], out["_items"], out["_ts2"] = pic, final, items, ts2
    conflict_msg = None
    if ts2 is None:
        conflict_msg = "%d ячеек выбранного участка заняты (не пустые, нужны карте или корень тайла) - выберите другое место" % len(conflicts)
        out["errors"].append(conflict_msg)
    else:
        shown = {ts2.cls[c] for c in used_cells(project, tmxs, P.get("layers") or {}, len(ts0.cells))}
        for rgb in final:
            k = rgb_key(rgb)
            if not is_blank(k):
                shown.add(ts2.cls[ts2.exact[k]])
        over = [r for r in shown if ts2.opt[r] >= limit]
        cols = len(colors_of(ts2.cells))
        out["result"] = {"opt": ts2.count, "maxShown": max((ts2.opt[r] for r in shown), default=0), "overLimit": len(over),
                         "ok": not over, "colors": cols, "newRaw": ts2.tw * ts2.th - len(ts0.cells), "th": ts2.th}
        if out["pairs"]:
            _, edits, errs = pair_edits(project, ts0, ts2, out["pairs"])
            out["result"]["pairEdits"] = len(edits)
            out["errors"] += errs
        if over:
            hint = (" (по карте всё помещается - удалите оставшиеся неиспользуемые тайлы: %d шт. или отметьте области подмены)" % out["tiles"]["leftover"]
                    if need_tiles <= free else ": сожмите сильнее, пометьте неучтённые или освободите место")
            out["errors"].append("%d тайлов карты/картинки окажутся за пределом VRAM (%d)%s" % (len(over), limit, hint))
        if cols > PAL_MAX:
            out["errors"].append("в тайлсете получится %d цветов (максимум %d - иначе tmx2incl откажется собирать)" % (cols, PAL_MAX))
    if (P.get("target") or {}).get("mode") == "copy":      # отдельная копия: основной тайлсет не трогаем, проверки - подсказки
        out["warnings"] += [e for e in out["errors"] if e != conflict_msg]
        out["errors"] = [e for e in out["errors"] if e == conflict_msg]
    if images:
        out["images"] = {"final": png_b64(pic.w, pic.h, join_cells(final, pic.ts.tw, pic.ts.th)),
                         "after": png_b64(ts2.tw * T, ts2.th * T, join_cells(ts2.cells, ts2.tw, ts2.th)) if ts2 else None}
    return out


def public(out):
    return {k: v for k, v in out.items() if not k.startswith("_")}


# ------------------------------------------------------------------ запись

def update_tsx(project, bmp, tw, th, force=None, image=None, name=None):
    """размеры картинки и tilecount в .tsx, который смотрит на этот bmp -> (путь|None, новый текст);
    image/name - переписать источник картинки и имя тайлсета (для копии)"""
    res = stcore.paths(project)["resources"]
    for f in sorted(os.listdir(res)):
        if not f.endswith(".tsx"):
            continue
        p = os.path.join(res, f)
        with open(p, encoding="utf-8", newline="") as fh:
            text = fh.read()
        m = re.search(r'<image\b[^>]*\bsource="([^"]*)"', text)
        if m and (f == force if force else os.path.basename(m.group(1)) == os.path.basename(bmp)):
            new = re.sub(r'(<image\b[^>]*\bwidth=")\d+(")', lambda x: x.group(1) + str(tw * T) + x.group(2), text, count=1)
            new = re.sub(r'(<image\b[^>]*\bheight=")\d+(")', lambda x: x.group(1) + str(th * T) + x.group(2), new, count=1)
            new = re.sub(r'(<tileset\b[^>]*\btilecount=")\d+(")', lambda x: x.group(1) + str(tw * th) + x.group(2), new, count=1)
            if image:
                new = re.sub(r'(<image\b[^>]*\bsource=")[^"]*(")', lambda x: x.group(1) + image + x.group(2), new, count=1)
            if name:
                new = re.sub(r'(<tileset\b[^>]*\bname=")[^"]*(")', lambda x: x.group(1) + name + x.group(2), new, count=1)
            return p, new
    return None, ""


def minimal_tsx(name, image, tw, th):
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<tileset version="1.10" tiledversion="1.12.2" name="%s" tilewidth="8" tileheight="8" tilecount="%d" columns="%d">\n'
            ' <image source="%s" trans="ff00ff" width="%d" height="%d"/>\n</tileset>\n') % (name, tw * th, tw, image, tw * T, th * T)


def _safe_name(n, default):
    return re.sub(r"[^\w\-]+", "_", n or "") or default


def _abs(project, d):
    return d if os.path.isabs(d) else os.path.join(project, d)


def apply(project, here, P):
    """записать bmp (+ supertiles.cpp, .tsx). main: в основной тайлсет с бэкапом; copy: отдельные файлы
    <dir>/<name>.bmp|.tsx (+ supertiles.cpp), основной тайлсет не трогаем"""
    out = plan(project, P)
    ts0, ts2 = out["_ts0"], out["_ts2"]
    if P.get("img") and ts2 is out["_ts1"]:
        raise ValueError("не посчитано размещение картинки")
    if ts2 is None:
        raise ValueError("; ".join(out["errors"]))
    tg = P.get("target") or {}
    copy = tg.get("mode") == "copy"
    if out["errors"] and not P.get("force"):
        raise ValueError("; ".join(out["errors"]))
    if not P.get("img") and not out["tiles"]["deleted"] and not out["tiles"]["areas"] and not copy:
        raise ValueError("нечего применять: ничего не выбрано")
    src = ts_path(project, P["bmp"])
    _, b0 = load_tileset(src)
    text, edits, perrs = pair_edits(project, ts0, ts2, out["pairs"]) if out["pairs"] else ("", [], [])
    if perrs and not (P.get("force") or copy):
        raise ValueError("; ".join(perrs))
    here_tp = os.path.join(here, "backups", "tilepack")
    os.makedirs(here_tp, exist_ok=True)
    msgs, info = [], {}
    if copy:
        odir = _abs(project, tg.get("dir") or os.path.join("resources", "tilepack_out"))
        name = _safe_name(tg.get("name"), os.path.splitext(os.path.basename(src))[0] + "_new")
        os.makedirs(odir, exist_ok=True)
        path = os.path.join(odir, name + ".bmp")
        ts2.to_bmp(b0.header).save(path)
        msgs.append("копия тайлсета: %s (%d x %d тайлов, в сжатом наборе %d); основной %s не тронут"
                    % (path, ts2.tw, ts2.th, ts2.count, os.path.basename(src)))
        tp, txt = update_tsx(project, P["bmp"], ts2.tw, ts2.th, os.path.basename(P.get("tsx") or "") or None,
                             image=name + ".bmp", name=name)
        if not tp:
            txt = minimal_tsx(name, name + ".bmp", ts2.tw, ts2.th)
            msgs.append("подходящего .tsx не нашлось - записан минимальный (без wangset и свойств)")
        tsx_path = os.path.join(odir, name + ".tsx")
        with open(tsx_path, "w", encoding="utf-8", newline="") as f:
            f.write(txt)
        msgs.append("%s: копия описания тайлсета%s" % (tsx_path, " (wangsets, свойства сохранены)" if tp else ""))
        if edits:
            with open(os.path.join(odir, "supertiles.cpp"), "w", encoding="utf-8", newline="\n") as f:
                f.write(stcore.save_table(text, edits))
            msgs.append("supertiles.cpp (копия с пересчитанными парами %s) в %s - рабочий supertiles.cpp не тронут"
                        % (", ".join(str(e["idx"]) for e in edits), odir))
        for e in perrs:
            msgs.append("предупреждение: " + e)
        info = {"bmp": path, "tsx": tsx_path, "dir": odir, "name": name, "copy": True}
        bdir = odir
    else:
        path = src
        bdir = os.path.join(here_tp, time.strftime("%Y%m%d_%H%M%S"))
        os.makedirs(bdir, exist_ok=True)
        shutil.copy2(path, os.path.join(bdir, os.path.basename(path)))
        table = stcore.paths(project)["table"]
        if os.path.isfile(table):
            shutil.copy2(table, os.path.join(bdir, os.path.basename(table)))
        ts2.to_bmp(b0.header).save(path)
        msgs.append("%s записан: %d x %d тайлов, в сжатом наборе %d" % (os.path.basename(path), ts2.tw, ts2.th, ts2.count))
        if edits:
            with open(table, "w", encoding="utf-8", newline="\n") as f:
                f.write(stcore.save_table(text, edits))
            msgs.append("supertiles.cpp: пересчитаны пары %s" % ", ".join(str(e["idx"]) for e in edits))
            stcore.refresh_usage(project)
        tsx_path = ""
        if (ts2.tw, ts2.th) != (ts0.tw, ts0.th):
            tp, new = update_tsx(project, P["bmp"], ts2.tw, ts2.th, os.path.basename(P.get("tsx") or "") or None)
            if tp:
                shutil.copy2(tp, os.path.join(bdir, os.path.basename(tp)))
                with open(tp, "w", encoding="utf-8", newline="") as f:
                    f.write(new)
                tsx_path = tp
                msgs.append("%s: размер картинки и tilecount обновлены" % os.path.basename(tp))
            else:
                msgs.append("ни один .tsx не ссылается на %s - размер тайлсета в Tiled обновите сами" % P["bmp"])
        else:
            tp, _ = update_tsx(project, P["bmp"], ts2.tw, ts2.th, os.path.basename(P.get("tsx") or "") or None)
            tsx_path = tp or ""
        info = {"bmp": path, "tsx": tsx_path, "dir": "", "name": "", "copy": False}
        msgs.append("бэкап (старый bmp и supertiles.cpp со старой разметкой): %s" % bdir)
    if P.get("img"):     # итоговая картинка нужна для шага 6 (после записи «замены» уже не восстановить)
        pic, final = out["_pic"], out["_final"]
        png = write_png(pic.w, pic.h, join_cells(final, pic.ts.tw, pic.ts.th))
        for p in {os.path.join(bdir, "final.png"), os.path.join(here_tp, "last_final.png")}:
            with open(p, "wb") as f:
                f.write(png)
    with open(os.path.join(here_tp, "last.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False)
    return {"ok": True, "messages": msgs, "backup": bdir if not copy else "", "target": info}


# ------------------------------------------------------------------ tmx с готовым зданием

def export_tmx(project, here, P):
    """tmx с картинкой на текущем (уже записанном) bmp; итоговое содержимое - из last_final.png шага 5"""
    src_png = P.get("finalPng") or os.path.join(here, "backups", "tilepack", "last_final.png")
    if not os.path.isfile(src_png):
        raise ValueError("нет итоговой картинки - сначала выполните шаг 5 (запись bmp)")
    with open(src_png, "rb") as f:
        w, h, rgb = read_png(f.read())
    cells = split_cells(w, h, rgb)
    last = {}
    lj = os.path.join(here, "backups", "tilepack", "last.json")
    if os.path.isfile(lj) and not P.get("bmpPath"):
        try:
            with open(lj, encoding="utf-8") as f:
                last = json.load(f)
        except (OSError, ValueError):
            last = {}
    bmp_file = P.get("bmpPath") or last.get("bmp") or ts_path(project, P["bmp"])
    tsx_file = P.get("tsxPath") or last.get("tsx") or ""
    ts, _ = load_tileset(bmp_file)
    gids, missing = [], 0
    for c in cells:
        k = rgb_key(c)
        if is_blank(k):
            gids.append(0)
        elif k in ts.exact:
            gids.append(ts.exact[k] + 1)
        else:
            gids.append(0)
            missing += 1
    if missing:
        raise ValueError("%d тайлов картинки не нашлись в %s - bmp изменился после шага 5?" % (missing, os.path.basename(bmp_file)))
    res = stcore.paths(project)["resources"]
    odir = _abs(project, P.get("outDir") or last.get("dir") or os.path.join("resources", "tilepack_out"))
    os.makedirs(odir, exist_ok=True)
    name = re.sub(r"[^\w\-]+", "_", P.get("name") or "building") or "building"
    layer = re.sub(r'[<>&"]', "", P.get("layer") or "building")
    tsx_abs = tsx_file or os.path.join(res, os.path.basename(P.get("tsx") or os.path.splitext(os.path.basename(P["bmp"]))[0] + ".tsx"))
    tsx = os.path.basename(tsx_abs)
    tw, th = w // T, h // T
    src = os.path.relpath(tsx_abs, odir).replace("\\", "/")
    body = ",\n".join(",".join(str(g) for g in gids[y * tw:(y + 1) * tw]) for y in range(th))
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<map version="1.10" tiledversion="1.12.2" orientation="orthogonal" renderorder="right-down" width="%d" height="%d" '
           'tilewidth="8" tileheight="8" infinite="0" nextlayerid="2" nextobjectid="1">\n'
           ' <tileset firstgid="1" source="%s"/>\n'
           ' <layer id="1" name="%s" width="%d" height="%d">\n'
           '  <data encoding="csv">\n%s\n</data>\n </layer>\n</map>\n') % (tw, th, src, layer, tw, th, body)
    tmx_path = os.path.join(odir, name + ".tmx")
    with open(tmx_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(xml)
    png_path = os.path.join(odir, name + "_compressed.png")
    shutil.copyfile(src_png, png_path)
    msgs = ["tmx: %s (%d x %d тайлов, слой «%s»)" % (tmx_path, tw, th, layer)]
    if not os.path.isfile(tsx_abs):
        msgs.append("тайлсет %s не найден - поправьте путь в tmx" % tsx_abs)
    return {"ok": True, "tmx": tmx_path, "png": png_path, "messages": msgs}
