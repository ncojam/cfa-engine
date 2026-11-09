"""Вкладка «Подмена тайлов»: таблица superTilerPairs (project/src/supertiles.cpp),
сжатые тайлсеты (как их делает tools/tmx2incl.cpp с флагом c) и карты tmx.

Единицы в таблице (см. шапку supertiles.cpp): {куда, откуда} - в полутайлах (тайл*2),
сколько - в тайлах. Тайл 8x8 8bpp = 64 байта. В VRAM фона грузятся первые VRAM_TILES
тайлов сжатого тайлсета (applyTileSet), setSuperTile поверх них копирует
opt[откуда .. откуда+сколько) -> VRAM[куда ..].
"""
import base64
import json
import os
import re
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET

VRAM_TILES = 864          # memcpy( TILE_DATA, mapTileData, 64 * 864 ) в applyTileSet
UNLESS_FROM = 960         # tmx2incl флаг u: тайлы с этого номера не сжимаются

DATA_RE = re.compile(r"^(\s*)\{\s*\{([^{}]*)\}\s*,\s*\{([^{}]*)\}\s*\}\s*(,?)\s*(//.*)?$")
LABEL_RE = re.compile(r"^(\s*)//\s*\[(\d+)\]\s*(.*?)\s*->\s*\[(\d+)\]\s*(.*?)(?:\s+@\s*(.*))?\s*$")
EXPR_RE = re.compile(r"^[\d\s+\-*()]+$")


def paths(project):
    return {
        "table": os.path.join(project, "src", "supertiles.cpp"),
        "usage_tool": os.path.join(project, "tools", "supertile_usage.py"),
        "build": os.path.join(project, "build_graphics.sh"),
        "images": os.path.join(project, "images"),
        "resources": os.path.join(project, "resources"),
    }


# ------------------------------------------------------------------ таблица

def _ev(expr):
    expr = expr.strip()
    if not EXPR_RE.match(expr):
        raise ValueError("непонятное значение: %r" % expr)
    return int(eval(expr, {"__builtins__": {}}))  # только цифры и + - * ( )


def _state(s):
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 3:
        raise ValueError("ожидалось 3 числа: {%s}" % s)
    return {"raw": parts, "to": _ev(parts[0]), "from": _ev(parts[1]), "len": _ev(parts[2])}


def parse_table(text):
    lines = text.split("\n")
    start = next(i for i, l in enumerate(lines) if "superTilerPairs[]" in l and "=" in l)
    pairs, notes = [], []
    end = None
    for i in range(start + 1, len(lines)):
        l = lines[i]
        if l.strip().startswith("};"):
            end = i
            break
        m = DATA_RE.match(l)
        if m:
            p = {"line": i, "label": None, "a": _state(m.group(2)), "b": _state(m.group(3)),
                 "name_a": "", "name_b": "", "notes": notes}
            if pairs and pairs[-1].get("label_line") == i - 1:
                pass
            lm = LABEL_RE.match(lines[i - 1])
            if lm:
                p["label"] = i - 1
                p["name_a"], p["name_b"] = lm.group(3), lm.group(5)
                if notes and notes[-1] == lines[i - 1].strip():
                    notes.pop()
            pairs.append(p)
            notes = []
        elif l.strip().startswith("//"):
            notes = notes + [l.strip()]
    for p in pairs:
        p["notes"] = [n.lstrip("/").strip().strip("-").strip() for n in p["notes"]
                      if not LABEL_RE.match(n)]
    return lines, pairs, end


def _fmt_state(s, old):
    """Новые числа в формате кода; если значение не поменялось - оставляем выражение как было."""
    vals = [s["to"] * 2, s["from"] * 2, s["len"]]
    out = []
    for k, v in enumerate(vals):
        out.append(old["raw"][k] if old and _ev(old["raw"][k]) == v else str(v))
    return "{" + ",".join(out) + "}"


def save_table(text, edits):
    """edits: [{idx (номер пары или null для новой), a:{to,from,len} в тайлах, b, name_a, name_b}]"""
    lines, pairs, end = parse_table(text)
    appended = []
    for e in edits:
        idx = e.get("idx")
        if idx is None:
            appended.append(e)
            continue
        p = pairs[idx]
        line = lines[p["line"]]
        m = DATA_RE.match(line)
        lines[p["line"]] = "%s{ %s, %s }%s%s" % (
            m.group(1), _fmt_state(e["a"], p["a"]), _fmt_state(e["b"], p["b"]), m.group(4) or ",",
            (" " + m.group(5)) if m.group(5) else "")
        prev = LABEL_RE.match(lines[p["label"]]) if p["label"] is not None else None
        label = "%s// [%d] %s -> [%d] %s   @ %s" % (m.group(1), 2 * idx, e.get("name_a") or "?",
                                                2 * idx + 1, e.get("name_b") or "?",
                                                (prev.group(6) if prev and prev.group(6) else "-"))
        if p["label"] is not None:
            lines[p["label"]] = label   # "@ ..." потом пересчитает supertile_usage.py --write
        else:
            lines.insert(p["line"], label)
            end += 1
            # следующие пары сдвинулись на строку
            for q in pairs[idx + 1:]:
                q["line"] += 1
                if q["label"] is not None:
                    q["label"] += 1
    if appended:
        # у последней старой строки должна быть запятая
        last = end - 1
        while last > 0 and not DATA_RE.match(lines[last]):
            last -= 1
        m = DATA_RE.match(lines[last])
        if m and not m.group(4):
            lines[last] = "%s{ {%s}, {%s} },%s" % (m.group(1), m.group(2).strip(), m.group(3).strip(),
                                                   (" " + m.group(5)) if m.group(5) else "")
        new = []
        n = len(pairs)
        for k, e in enumerate(appended):
            i = n + k
            new.append("\t// [%d] %s -> [%d] %s   @ -" % (2 * i, e.get("name_a") or "?", 2 * i + 1, e.get("name_b") or "?"))
            new.append("\t{ %s, %s }," % (_fmt_state(e["a"], None), _fmt_state(e["b"], None)))
        lines[end:end] = new
    return "\n".join(lines)


def load_usage(project):
    """Запускает tools/supertile_usage.py --json из проекта (вся логика карт/дверей живёт там)."""
    tool = paths(project)["usage_tool"]
    if not os.path.isfile(tool):
        return {"use": {}, "errors": ["нет %s — список «где используется» недоступен" % tool]}
    r = subprocess.run([sys.executable, tool, "--json"], capture_output=True, text=True,
                       encoding="utf-8", cwd=project, timeout=60)
    try:
        return json.loads(r.stdout)
    except ValueError:
        return {"use": {}, "errors": ["supertile_usage.py: " + (r.stderr or r.stdout)[-400:]]}


def refresh_usage(project):
    tool = paths(project)["usage_tool"]
    if os.path.isfile(tool):
        subprocess.run([sys.executable, tool, "--write"], capture_output=True, cwd=project, timeout=60)


# ------------------------------------------------------------------ тайлсеты / карты

def graphics_lines(project):
    """Строки build_graphics.sh вида: tmx2incl bct[u] <bmp> <tmx> <name>."""
    out = []
    p = paths(project)["build"]
    if not os.path.isfile(p):
        return out
    with open(p, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.lstrip().startswith("#"):
                continue
            m = re.search(r'\b(b?c?t?u?)\s+(\S+\.bmp)\s+(\S+\.tmx)\s+(\w+)', line)
            if m and "c" in m.group(1) and "t" in m.group(1):
                out.append({"flags": m.group(1), "bmp": os.path.basename(m.group(2)),
                            "tmx": os.path.basename(m.group(3)), "name": m.group(4)})
    return out


def list_tilesets(project):
    d = paths(project)["images"]
    used = {g["bmp"]: g for g in graphics_lines(project)}
    res = []
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if f.lower().endswith(".bmp") and f.startswith("mts-"):
            g = used.get(f)
            res.append({"bmp": f, "used": bool(g), "unless": bool(g and "u" in g["flags"])})
    return res


def list_maps(project):
    d = paths(project)["resources"]
    defaults = {}
    for g in graphics_lines(project):
        defaults.setdefault(g["tmx"], g["bmp"])   # первый тайлсет карты = tileSets[0]
    maps = []
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if f.endswith(".tmx"):
            maps.append({"tmx": f, "tileset": defaults.get(f)})
    return maps


def read_bmp24(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:2] != b"BM":
        raise ValueError("%s: не BMP" % path)
    off = struct.unpack_from("<I", data, 10)[0]
    w, h = struct.unpack_from("<ii", data, 18)
    bpp, comp = struct.unpack_from("<HI", data, 28)
    if bpp != 24 or comp != 0:
        raise ValueError("%s: нужен 24-битный BMP без сжатия (как в tmx2incl)" % path)
    if w % 8 or h % 8:
        raise ValueError("%s: размеры не кратны 8" % path)
    return w, h, off, data


def compress_tileset(path, unless=False):
    """Повтор tmx2incl (bc / bcu): палитра, сжатые тайлы и таблица opt (raw -> optIndex | orient<<10)."""
    w, h, off, data = read_bmp24(path)
    stride = (w * 3 + 3) & ~3
    pal, pal_idx = [], {}
    bitmap = bytearray(w * h)
    for y in range(h):
        row = off + stride * (h - y - 1)
        for x in range(w):
            b, g, r = data[row + 3 * x], data[row + 3 * x + 1], data[row + 3 * x + 2]
            key = (r >> 3, g >> 3, b >> 3)   # ColorCompEqual: важны только старшие 5 бит
            i = pal_idx.get(key)
            if i is None:
                if len(pal) >= 256:
                    raise ValueError("%s: больше 256 цветов" % path)
                i = pal_idx[key] = len(pal)
                pal.append((r, g, b))
            bitmap[x + y * w] = i
    tw, th = w // 8, h // 8
    tiles = []
    for ty in range(th):
        for tx in range(tw):
            tiles.append(bytes(b"".join(bytes(bitmap[(ty * 8 + yy) * w + tx * 8:(ty * 8 + yy) * w + tx * 8 + 8])
                                        for yy in range(8))))

    def flips(t):
        rows = [t[k * 8:k * 8 + 8] for k in range(8)]
        hf = b"".join(r[::-1] for r in rows)
        vf = b"".join(rows[::-1])
        hv = b"".join(r[::-1] for r in rows[::-1])
        return (t, hf, vf, hv)    # orient 0, 1 (X), 2 (Y), 3 (XY) - как tileCompareOrient

    roots = {}       # байты тайла -> номер первого такого исходного тайла (он всегда «корень»)
    index = list(range(len(tiles)))
    orient = [0] * len(tiles)
    for i, t in enumerate(tiles):
        if not (unless and i >= UNLESS_FROM):
            best = None
            for o, ft in enumerate(flips(t)):
                j = roots.get(ft)
                if j is not None and (best is None or j < best[0]):
                    best = (j, o)
            if best:
                index[i], orient[i] = best
                continue
        roots.setdefault(t, i)
    opt_tiles, opt_of = [], {}
    opt = []
    for i in range(len(tiles)):
        if index[i] == i:
            opt_of[i] = len(opt_tiles)
            opt_tiles.append(tiles[i])
        opt.append(opt_of[index[i]] | (orient[i] << 10))
    return {"bmp": os.path.basename(path), "w": tw, "h": th, "rawCount": len(tiles),
            "optCount": len(opt_tiles), "pal": pal, "opt": opt,
            "tiles": base64.b64encode(b"".join(opt_tiles)).decode("ascii")}


def read_tmx(path):
    root = ET.parse(path).getroot()
    layers = []
    for l in root.iter("layer"):
        name = l.get("name") or ""
        d = l.find("data")
        if d is None or (d.get("encoding") or "") != "csv":
            continue
        vals = [int(v) & 0x1FFFFFFF for v in re.split(r"[,\s]+", d.text.strip()) if v]
        # tmx2incl: gid 0 -> 0, иначе gid-1 (номер исходного тайла)
        layers.append({"name": name, "w": int(l.get("width")), "h": int(l.get("height")),
                       "walls": "wall" in name.lower(), "data": [v - 1 if v else 0 for v in vals]})
    return {"tmx": os.path.basename(path), "layers": layers}


# ------------------------------------------------------------------ fgtile на карте (чтение / правка tmx)

FG_OBJ_RE = re.compile(r'([ \t]*)<object\b([^>]*?)(/?)>(?:(.*?)</object>)?[ \t]*\r?\n?', re.S)
FG_PROP_RE = re.compile(r'<property name="(\w+)"(?: type="\w+")? value="([^"]*)"\s*/>')


def _attr(tag, name):
    m = re.search(r'\b%s="([^"]*)"' % name, tag)
    return m.group(1) if m else None


def fg_kind(p):
    """trigger - подмена тайлов (turn 0/1, без portTo), door - дверь со switch2dial/switchTile, other - прочее."""
    is_door = p.get("portTo", "33") != "33"
    if (not is_door and p.get("turn", "0") in ("0", "1") and p.get("num") not in ("99", "10")
            and p.get("treetype") not in (None, "1", "20")):
        return "trigger"
    if is_door and (p.get("switch2dial", "-1") != "-1" or p.get("switchTile", "-1") != "-1"):
        return "door"
    return "other"


def read_fgtiles(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    out = []
    for m in FG_OBJ_RE.finditer(text):
        tag = m.group(2)
        if _attr(tag, "type") != "fgtile":
            continue
        props = dict(FG_PROP_RE.findall(m.group(4) or ""))
        out.append({"id": int(_attr(tag, "id")), "x": float(_attr(tag, "x") or 0), "y": float(_attr(tag, "y") or 0),
                    "w": float(_attr(tag, "width") or 16), "h": float(_attr(tag, "height") or 16),
                    "props": props, "kind": fg_kind(props)})
    return out


def _num(v):
    v = float(v)
    return str(int(v)) if v == int(v) else ("%g" % v)


def _set_attr(tag, name, value):
    if re.search(r'\b%s="[^"]*"' % name, tag):
        return re.sub(r'\b(%s)="[^"]*"' % name, lambda m: '%s="%s"' % (m.group(1), value), tag, count=1)
    return tag + ' %s="%s"' % (name, value)


def _props_xml(props, ind, nl):
    lines = [ind + " <properties>"]
    for k in sorted(props):
        lines.append('%s  <property name="%s" value="%s"/>' % (ind, k, props[k]))
    lines.append(ind + " </properties>")
    return nl.join(lines)


def save_fgtiles(path, changed, added, deleted):
    """changed: [{id, x, y, w, h, props}] (props - полный набор: чего нет - удаляется),
    added: [{x, y, w, h, props}], deleted: [id]. Правит только эти объекты, остальное байт-в-байт.
    -> {временный индекс добавленного: новый id}"""
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    nl = "\r\n" if "\r\n" in text else "\n"
    byid = {int(c["id"]): c for c in changed}
    dele = set(int(d) for d in deleted)

    def repl(m):
        tag = m.group(2)
        if _attr(tag, "type") != "fgtile":
            return m.group(0)
        oid = int(_attr(tag, "id"))
        if oid in dele:
            return ""
        c = byid.get(oid)
        if not c:
            return m.group(0)
        ind = m.group(1)
        for k, v in (("x", c["x"]), ("y", c["y"]), ("width", c["w"]), ("height", c["h"])):
            tag = _set_attr(tag, k, _num(v))
        body = m.group(4) or ""
        old = dict(FG_PROP_RE.findall(body))
        props = {k: str(v) for k, v in c["props"].items()}
        if old == props and not m.group(3):
            return "%s<object%s>%s</object>%s" % (ind, tag, body, m.group(0)[len(m.group(0).rstrip("\r\n")):])
        tail = m.group(0)[len(m.group(0).rstrip("\r\n")):] or nl
        if body and "<properties>" in body:
            # меняем значения на месте, лишние убираем, новые - перед </properties>
            def prepl(pm):
                k = pm.group(1)
                if k not in props:
                    return "\x00"
                return pm.group(0).replace('value="%s"' % pm.group(2), 'value="%s"' % props[k], 1)
            body = FG_PROP_RE.sub(prepl, body)
            body = re.sub(r'[ \t]*\x00[ \t]*\r?\n?', "", body)
            add = [k for k in sorted(props) if k not in old]
            if add:
                pind = re.search(r'([ \t]*)<property ', body)
                pind = pind.group(1) if pind else ind + "  "
                ins = "".join('%s<property name="%s" value="%s"/>%s' % (pind, k, props[k], nl) for k in add)
                body = re.sub(r'([ \t]*</properties>)', lambda mm: ins + mm.group(1), body, count=1)
            return "%s<object%s>%s</object>%s" % (ind, tag, body, tail)
        return "%s<object%s>%s%s%s%s</object>%s" % (ind, tag, nl, _props_xml(props, ind, nl), nl, ind, tail)

    text = FG_OBJ_RE.sub(repl, text)
    ids = {}
    if added:
        mm = re.search(r'<map\b[^>]*\bnextobjectid="(\d+)"', text)
        nid = int(mm.group(1)) if mm else 1 + max([int(x) for x in re.findall(r'<object id="(\d+)"', text)] or [0])
        # группа объектов, где уже лежат fgtile / актёры
        grp = None
        for g in re.finditer(r'<objectgroup\b[^>]*>(.*?)</objectgroup>', text, re.S):
            if 'type="fgtile"' in g.group(1) or grp is None:
                grp = g
                if 'type="fgtile"' in g.group(1):
                    break
        if grp is None:
            raise ValueError("в карте нет <objectgroup> — некуда добавить fgtile")
        ind = re.search(r'\n([ \t]*)<object ', grp.group(0))
        ind = ind.group(1) if ind else "  "
        blocks = []
        for k, a in enumerate(added):
            props = {kk: str(v) for kk, v in a["props"].items()}
            blocks.append('%s<object id="%d" name="Fgtile" type="fgtile" x="%s" y="%s" width="%s" height="%s">%s%s%s%s</object>%s'
                          % (ind, nid, _num(a["x"]), _num(a["y"]), _num(a["w"]), _num(a["h"]), nl,
                             _props_xml(props, ind, nl), nl, ind, nl))
            ids[k] = nid
            nid += 1
        end = grp.end() - len("</objectgroup>")
        # вставляем перед строкой с </objectgroup>
        line_start = text.rfind("\n", 0, end) + 1
        text = text[:line_start] + "".join(blocks) + text[line_start:]
        text = re.sub(r'(<map\b[^>]*\bnextobjectid=")\d+(")', lambda m2: m2.group(1) + str(nid) + m2.group(2), text, count=1)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return ids
