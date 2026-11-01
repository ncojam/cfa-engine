"""
Большой арт (x10) -> пиксельная лента, и «пиксельартный прогон» по ленте.
Python 3 stdlib only.

    charNN_faces_big.bmp  (эмоции 720x800 слева направо, фон — маджента)
        -> big_to_strip()  -> charNN_faces.bmp (72x80 на эмоцию, цвета из палитры)
    charNN_faces.bmp -> pixelart_pass() -> charNN_faces.bmp

Палитра: первые 2 тайла 8x8 (16x8 px слева сверху) project/images/chr_spr_witch.bmp.
"""
import gbportrait as gp

SCALE = 10
PW, PH = gp.PW, gp.PH          # 72 x 80


# ------------------------------------------------------------------ colour helpers

def dist(a, b):
    """'redmean' — дешёвая перцептивная дистанция."""
    rm = (a[0] + b[0]) >> 1
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return (((512 + rm) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rm) * db * db) >> 8)


def luma(c):
    return c[0] * 299 + c[1] * 587 + c[2] * 114


def load_palette(path):
    img = gp.read_bmp(path)
    pal = []
    for t in range(2):
        for y in range(8):
            for x in range(8):
                c = tuple(img.color(t * 8 + x, y))
                if c not in pal:
                    pal.append(c)
    return pal


def bg_of(pal, img=None):
    if img is not None:
        return tuple(img.color(0, 0))
    return pal[0]


# ------------------------------------------------------------------ 1. resize x10 + palette

LINE = ('line',)
_W1 = [5 - abs(i - 4.5) + 0.5 for i in range(SCALE)]   # тент (≈билинейный фильтр) 1..5..1


def _bg_amount(c, bg):
    """0..1 — насколько пиксель «фон». Учитывает сглаженную кромку лайн+маджента."""
    if c == bg:
        return 1.0
    r, g, b = c
    br, bgc, bb = bg
    # кромка = смесь фона и тёмного лайна: r/b пропорциональны фону, g почти 0
    if bgc < 40 and br > 200 and bb > 200 and g < 28 and abs(r - b) < 28 and r > 40:
        return min(1.0, (r + b) / (br + bb))
    return 0.0


LINE_LUMA = 70 * 1000   # тёмнее этого — лайн (luma 0..255000)
LINE_ON = 0.55          # доля лайна в блоке 10x10, с которой пиксель = лайн
LINE_GAP = 0.30         # слабый лайн: ставим, только если он соединяет разрыв линии


def downscale(big, bg):
    """Каждый 10x10 блок — только внутри своей эмоции (720x800 кусок), соседи не смешиваются.
    Лайн считается отдельно: блок с достаточной долей лайна = чистый цвет лайна (без смешивания),
    заливка усредняется без лайна и без фона. Блок, где фона >= половины, = фон —
    внешний контур не смешивается с маджентой и остаётся острым.
    Возвращает (grid, line_color)."""
    ow, oh = big.w // SCALE, big.h // SCALE
    out = [[bg] * ow for _ in range(oh)]
    cov = [[0.0] * ow for _ in range(oh)]
    fill = [[None] * ow for _ in range(oh)]
    lr = lg = lb = ln = 0
    for oy in range(oh):
        src = [[tuple(big.color(x, y)) for x in range(big.w)] for y in range(oy * SCALE, (oy + 1) * SCALE)]
        for ox in range(ow):
            x0 = ox * SCALE
            sw = bw = lw = cw = r = g = b = 0.0
            for j, row in enumerate(src):
                wy = _W1[j]
                for i in range(SCALE):
                    c = row[x0 + i]
                    w = wy * _W1[i]
                    sw += w
                    a = _bg_amount(c, bg)
                    if a:                      # фон / кромка лайн+маджента
                        bw += w * a
                        lw += w * (1 - a)
                        continue
                    if luma(c) < LINE_LUMA:
                        lw += w
                        lr += c[0]; lg += c[1]; lb += c[2]; ln += 1
                        # не continue: слабый лайн смешивается с заливкой, как обычный ресайз
                    cw += w
                    r += c[0] * w; g += c[1] * w; b += c[2] * w
            cov[oy][ox] = lw / sw
            if cw > 0:
                fill[oy][ox] = (int(r / cw + 0.5), int(g / cw + 0.5), int(b / cw + 0.5))
            if lw / sw >= LINE_ON:
                out[oy][ox] = LINE
            elif bw * 2 >= sw:
                pass                           # фон
            elif cw > 0:
                out[oy][ox] = fill[oy][ox]
            else:
                out[oy][ox] = LINE
    # латаем разрывы: слабый лайн, который соединяет две части линии
    for _ in range(2):
        add = []
        for oy in range(oh):
            for ox in range(ow):
                if out[oy][ox] is LINE or cov[oy][ox] < LINE_GAP:
                    continue
                e0 = (ox // PW) * PW
                def L(dx, dy):
                    x, y = ox + dx, oy + dy
                    return e0 <= x < e0 + PW and 0 <= y < oh and out[y][x] is LINE
                n8 = [L(dx, dy) for dx, dy in ((-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0))]
                # число отдельных кусков линии вокруг (переходы по кольцу 8 соседей)
                parts = sum(1 for k in range(8) if n8[k] and not n8[k - 1])
                if parts >= 2:
                    add.append((ox, oy))
        for ox, oy in add:
            out[oy][ox] = LINE
        if not add:
            break
    line = (lr // ln, lg // ln, lb // ln) if ln else (0, 0, 0)
    return out, line


def quantize(grid, pal, bg, skip=None):
    """Приводим к палитре. Если цвет сильно мимо палитры — шахматный дизеринг двумя цветами."""
    cols = [c for c in pal if c != bg]
    cache = {}
    for y, row in enumerate(grid):
        for x, c in enumerate(row):
            if c == bg or c is skip:
                continue
            m = cache.get(c)
            if m is None:
                ds = sorted(cols, key=lambda p: dist(p, c))
                best, d1 = ds[0], dist(ds[0], c)
                m = (best, best)
                if d1 > 900:   # «прям сильно отличается»
                    bp, bd = None, d1
                    near = ds[:12]
                    for i, a in enumerate(near):
                        for bb in near[i + 1:]:
                            mid = ((a[0] + bb[0]) >> 1, (a[1] + bb[1]) >> 1, (a[2] + bb[2]) >> 1)
                            d = dist(mid, c) + dist(a, bb) // 8     # не дизерим сильно разными цветами
                            if d < bd:
                                bp, bd = (a, bb), d
                    if bp and bd < d1 * 0.6:
                        m = bp
                cache[c] = m
            row[x] = m[(x + y) & 1]
    return grid


def grid_to_image(grid):
    h, w = len(grid), len(grid[0])
    img = gp.Image(w, h, 3)
    for y, row in enumerate(grid):
        img.px[y * w * 3:(y + 1) * w * 3] = bytes(v for c in row for v in c)
    return img


def image_to_grid(img):
    return [[tuple(img.color(x, y)) for x in range(img.w)] for y in range(img.h)]


def big_to_strip(big, pal):
    if big.w % (PW * SCALE) or big.h != PH * SCALE:
        raise ValueError('большой файл должен быть %dx%d на эмоцию (сейчас %dx%d)' % (PW * SCALE, PH * SCALE, big.w, big.h))
    bg = bg_of(pal, big)
    grid, line = downscale(big, bg)
    if bg not in pal:   # фон приводим к фону палитры, если он чуть другой
        pbg = min(pal, key=lambda p: dist(p, bg))
        grid = [[pbg if c == bg else c for c in row] for row in grid]
        bg = pbg
    pline = min((c for c in pal if c != bg), key=lambda p: dist(p, line))   # лайн — ровно один цвет палитры, без дизера
    quantize(grid, pal, bg, skip=LINE)
    grid = [[pline if c is LINE else c for c in row] for row in grid]
    # линия в 1 px: локти -> сглаживание, во внутренних уголках — тоже сглаживание
    cache = {}
    for e in range(len(grid[0]) // PW):
        v = View(grid, e * PW, PW, len(grid), False, False)
        _elbows(v, pline, bg, pal, cache)
        _inner_aa(v, pline, pal, bg, cache)
    return grid_to_image(grid)


# ------------------------------------------------------------------ 2. pixel-art pass

class View:
    """Сетка одной эмоции с поворотом/отражением, чтобы один код ловил все 4 направления лесенок."""

    def __init__(self, g, x0, w, h, tr, mx):
        self.g, self.x0, self.tr, self.mx = g, x0, tr, mx
        self.w, self.h = (h, w) if tr else (w, h)

    def _xy(self, x, y):
        if self.mx:
            x = self.w - 1 - x
        if self.tr:
            x, y = y, x
        return self.x0 + x, y

    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def get(self, x, y):
        if not self.inside(x, y):
            return None
        X, Y = self._xy(x, y)
        return self.g[Y][X]

    def set(self, x, y, c):
        X, Y = self._xy(x, y)
        self.g[Y][X] = c


def _line_color(v, bg):
    cnt = {}
    for y in range(v.h):
        for x in range(v.w):
            c = v.get(x, y)
            if c == bg:
                continue
            if any(v.get(x + dx, y + dy) == bg for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                cnt[c] = cnt.get(c, 0) + 1
    return max(cnt, key=cnt.get) if cnt else None


def _elbows(v, L, bg, pal, cache):
    """«Локти» — лишний пиксель в углу ступеньки (линия 2 px). Внутри фигуры он становится
    сглаживанием (цвет между заливкой и лайном), снаружи (рядом фон) — фоном, контур остаётся острым."""
    n = 0
    for y in range(v.h):
        for x in range(v.w):
            if v.get(x, y) != L:
                continue
            for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                if v.get(x + dx, y) == L and v.get(x, y + dy) == L and v.get(x - dx, y) != L \
                        and v.get(x, y - dy) != L and v.get(x + dx, y + dy) != L:
                    # концы должны остаться связаны с остальной линией
                    ok = True
                    for ex, ey in ((x + dx, y), (x, y + dy)):
                        k = sum(1 for ax in (-1, 0, 1) for ay in (-1, 0, 1) if (ax or ay)
                                and (ex + ax, ey + ay) != (x, y) and v.get(ex + ax, ey + ay) == L)
                        ok &= k >= 2
                    if not ok:
                        continue
                    a, b = v.get(x - dx, y), v.get(x, y - dy)
                    if bg in (a, b):
                        rep = bg
                    else:
                        F = a if a not in (None, L) else b
                        if F in (None, L):
                            continue
                        rep = _shade(F, L, pal, bg, cache) or F
                    v.set(x, y, rep)
                    n += 1
                    break
    return n


def _runs(v, L):
    """Горизонтальные отрезки линии по строкам: row -> [(x0, x1)]."""
    out = []
    for y in range(v.h):
        rr, x = [], 0
        while x < v.w:
            if v.get(x, y) == L:
                s = x
                while x + 1 < v.w and v.get(x + 1, y) == L:
                    x += 1
                rr.append((s, x))
            x += 1
        out.append(rr)
    return out


def _stairs(v, L):
    """Лесенки вниз-вправо: цепочки отрезков, где следующий начинается на x1+1 строкой ниже."""
    runs = _runs(v, L)
    nxt, has_prev = {}, set()
    for y in range(v.h - 1):
        starts = {r[0]: r for r in runs[y + 1]}
        for r in runs[y]:
            r2 = starts.get(r[1] + 1)
            if r2:
                nxt[(y, r)] = (y + 1, r2)
                has_prev.add((y + 1, r2))
    chains = []
    for key in nxt:
        if key in has_prev:
            continue
        ch = [key]
        while ch[-1] in nxt:
            ch.append(nxt[ch[-1]])
        if len(ch) >= 3:
            chains.append(ch)
    return chains


def _fix_stairs(v, L):
    """Только самые выбивающиеся ступеньки: 2,1,3,1 -> 2,1,2,1 (т.е. отрезки 2,3,2 -> 2,2,...)."""
    n = 0
    for ch in _stairs(v, L):
        lens = [r[1] - r[0] + 1 for _, r in ch]
        for i in range(1, len(ch) - 1):
            lo, hi, Ln = min(lens[i - 1], lens[i + 1]), max(lens[i - 1], lens[i + 1]), lens[i]
            if hi - lo > 1:
                continue                                   # кривая меняет наклон — не трогаем
            if Ln >= hi + 2:
                tgt = hi
            elif Ln <= lo - 2:
                tgt = lo
            elif lo == hi and abs(Ln - lo) == 1 and min(Ln, lo) >= 2:
                tgt = lo
            else:
                continue
            y, (x0, x1) = ch[i]
            ny, (nx0, nx1) = ch[i + 1]
            if Ln > tgt:      # отдаём хвост ступеньки следующей строке
                for _ in range(Ln - tgt):
                    rep = v.get(x1 + 1, y)
                    if rep is None or rep == L or v.get(x1, ny) is None:
                        break
                    v.set(x1, y, rep); v.set(x1, ny, L)
                    x1 -= 1; n += 1
            else:             # забираем начало следующей ступеньки
                for _ in range(tgt - Ln):
                    rep = v.get(x1 + 1, ny + 1)
                    if rep is None or rep == L or v.get(x1 + 1, y) is None:
                        break
                    v.set(x1 + 1, y, L); v.set(x1 + 1, ny, rep)
                    x1 += 1; n += 1
            lens[i] = x1 - x0 + 1
    return n


def _shade(F, L, pal, bg, cache):
    k = (F, L)
    if k not in cache:
        want = tuple(int(F[i] * 0.6 + L[i] * 0.4) for i in range(3))
        cands = [c for c in pal if c not in (bg, L, F) and luma(c) < luma(F) and dist(c, F) < 9000
                 and luma(c) > luma(L)]
        cache[k] = min(cands, key=lambda c: dist(c, want)) if cands else None
    return cache[k]


def _inner_aa(v, L, pal, bg, cache):
    """Во внутренних уголках ступенек (пиксель заливки, к которому лайн подходит с двух
    перпендикулярных сторон) ставим цвет потемнее из палитры."""
    todo = []
    for y in range(v.h):
        for x in range(v.w):
            F = v.get(x, y)
            if F in (L, bg, None):
                continue
            nb = {d: v.get(x + d[0], y + d[1]) for d in ((1, 0), (-1, 0), (0, 1), (0, -1))}
            if bg in nb.values():
                continue
            for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                if nb[(dx, 0)] == L and nb[(0, dy)] == L and nb[(-dx, 0)] != L and nb[(0, -dy)] != L \
                        and v.get(x + dx, y + dy) != L:
                    # уголок ступеньки: хотя бы одна из сторон — отрезок длиной >= 2
                    if v.get(x + dx, y - dy) == L or v.get(x - dx, y + dy) == L:
                        s = _shade(F, L, pal, bg, cache)
                        if s:
                            todo.append((x, y, s))
                    break
    for x, y, s in todo:
        v.set(x, y, s)
    return len(todo)


def pixelart_pass(img, pal):
    """Возвращает (новая Image 24-бит, статистика)."""
    g = image_to_grid(img)
    bg = tuple(img.color(0, 0))
    st = {"elbows": 0, "stairs": 0, "aa": 0}
    cache = {}
    for e in range(img.w // PW):
        base = View(g, e * PW, PW, img.h, False, False)
        L = _line_color(base, bg)
        if L is None:
            continue
        st["elbows"] += _elbows(base, L, bg, pal, cache)
        for tr in (False, True):
            for mx in (False, True):
                st["stairs"] += _fix_stairs(View(g, e * PW, PW, img.h, tr, mx), L)
        st["elbows"] += _elbows(base, L, bg, pal, cache)
        st["aa"] += _inner_aa(base, L, pal, bg, cache)
    return grid_to_image(g), st
