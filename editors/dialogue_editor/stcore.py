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
