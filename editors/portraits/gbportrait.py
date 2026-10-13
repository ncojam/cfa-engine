"""
Graveblood — portrait sheet <-> readable strip.

Engine layout (makePrtrt() + PlayerDrawing::drawChar()):
  sheet charNN.bmp: 128 px wide (16 tiles), 8 px technical strip on top,
  then one 128x48 block (16x6 tiles) per emotion.
  Inside a block (col c, row r in tiles) the engine assembles a 72x80 portrait:
    cols 0..5, rows 0..5  -> x = 8 + 8c,       y = 8r          (head 48x48)
    col 6,     rows 0..5  -> x = 56,           y = 8r
    col 7,     rows 0..4  -> x = 64,           y = 40 + 8r
    cols 8..15, rows 0..3 -> x = 8(c-8),       y = 48 + 8r     (body 64x32)
  Tiles not listed are never shown by the game (kept as-is when packing).

Pure Python, no Pillow. Works with uncompressed BMP:
  * 24/32-bit (true colour)  -> kept as 24-bit RGB
  * 8/4-bit (palette)        -> kept as 8-bit with the same palette
The output always has the same format as the source.
"""
import os
import struct

TILE = 8
SHEET_W = 128
STRIP_H = 8
BLOCK_H = 48
PW, PH = 72, 80


def _placements():
    out = []  # (block col, block row, portrait x, portrait y)
    for r in range(6):
        for c in range(6):
            out.append((c, r, 8 + 8 * c, 8 * r))
    for r in range(6):
        out.append((6, r, 56, 8 * r))
    for r in range(5):
        out.append((7, r, 64, 40 + 8 * r))
    for r in range(4):
        for c in range(8, 16):
            out.append((c, r, 8 * (c - 8), 48 + 8 * r))
    return out


PLACEMENTS = _placements()


class Image:
    """w, h; px = bytearray top-down, row-major, `bpp` bytes per pixel (1 = palette index, 3 = RGB)."""

    def __init__(self, w, h, bpp, palette=None, fill=None):
        self.w, self.h, self.bpp = w, h, bpp
        self.palette = list(palette or [])
        fill = fill if fill is not None else bytes(bpp)
        self.px = bytearray(fill) * (w * h)

    def get(self, x, y):
        i = (y * self.w + x) * self.bpp
        return bytes(self.px[i:i + self.bpp])

    def set(self, x, y, v):
        i = (y * self.w + x) * self.bpp
        self.px[i:i + self.bpp] = v

    def row(self, y):
        return self.px[y * self.w * self.bpp:(y + 1) * self.w * self.bpp]

    def color(self, x, y):
        v = self.get(x, y)
        return self.palette[v[0]] if self.bpp == 1 else tuple(v)

    def copy_tile(self, src, sx, sy, dx, dy, size=TILE):
        b = self.bpp
        for yy in range(size):
            so = ((sy + yy) * src.w + sx) * b
            do = ((dy + yy) * self.w + dx) * b
            self.px[do:do + size * b] = src.px[so:so + size * b]

    @property
    def kind(self):
        return '%d-бит' % (8 if self.bpp == 1 else 24)


# ------------------------------------------------------------------ BMP I/O

def read_bmp(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    if data[:2] != b'BM':
        raise ValueError('%s: это не BMP' % path)
    off = struct.unpack_from('<I', data, 10)[0]
    hsz = struct.unpack_from('<I', data, 14)[0]
    if hsz == 12:
        w, h, _, bpp = struct.unpack_from('<HHHH', data, 18)
        comp, used, pal_entry = 0, 0, 3
    else:
        w, h, _, bpp, comp = struct.unpack_from('<iiHHI', data, 18)
        used = struct.unpack_from('<I', data, 46)[0]
        pal_entry = 4
    if comp not in (0, 3):
        raise ValueError('%s: сжатый BMP (тип %d) не поддерживается — пересохраните без сжатия' % (path, comp))
    if comp == 3 and bpp != 32:
        raise ValueError('%s: BMP с битовыми масками (%d бит) не поддерживается' % (path, bpp))
    top_down = h < 0
    h = abs(h)
    stride = ((w * bpp + 31) // 32) * 4
    if bpp <= 8:
        n = used or (1 << bpp)
        po = 14 + hsz
        palette = []
        for i in range(n):
            b, g, r = data[po + i * pal_entry: po + i * pal_entry + 3]
            palette.append((r, g, b))
        img = Image(w, h, 1, palette)
    elif bpp in (24, 32):
        img = Image(w, h, 3)
    else:
        raise ValueError('%s: %d-битный BMP не поддерживается' % (path, bpp))
    for y in range(h):
        src = data[off + (y if top_down else h - 1 - y) * stride:][:stride]
        o = y * w * img.bpp
        if bpp == 8:
            img.px[o:o + w] = src[:w]
        elif bpp == 4:
            for x in range(w):
                b = src[x >> 1]
                img.px[o + x] = (b >> 4) if x % 2 == 0 else (b & 15)
        elif bpp == 1:
            for x in range(w):
                img.px[o + x] = (src[x >> 3] >> (7 - (x & 7))) & 1
        else:
            step = bpp // 8
            for x in range(w):
                b, g, r = src[x * step:x * step + 3]
                img.px[o + x * 3:o + x * 3 + 3] = bytes((r, g, b))
    return img


def write_bmp(path, img):
    w, h = img.w, img.h
    if img.bpp == 1:
        bits, pal = 8, list(img.palette) or [(0, 0, 0)]
    else:
        bits, pal = 24, []
    stride = ((w * bits + 31) // 32) * 4
    off = 14 + 40 + len(pal) * 4
    size = off + stride * h
    out = bytearray()
    out += b'BM' + struct.pack('<IHHI', size, 0, 0, off)
    out += struct.pack('<IiiHHIIiiII', 40, w, h, 1, bits, 0, stride * h, 2835, 2835, len(pal), 0)
    for r, g, b in pal:
        out += bytes((b, g, r, 0))
    for y in range(h - 1, -1, -1):
        row = img.row(y)
        if img.bpp == 3:
            row = bytearray(row)
            row[0::3], row[2::3] = row[2::3], row[0::3]  # RGB -> BGR
        out += row + b'\0' * (stride - len(row))
    tmp = path + '.tmp'
    with open(tmp, 'wb') as fh:
        fh.write(out)
    os.replace(tmp, path)


def convert_like(img, ref, path='image'):
    """Return img in the pixel format of `ref` (24-bit RGB or ref's palette)."""
    if ref.bpp == 3:
        if img.bpp == 3:
            return img
        out = Image(img.w, img.h, 3)
        for y in range(img.h):
            for x in range(img.w):
                out.set(x, y, bytes(img.color(x, y)))
        return out
    # ref is paletted: exact colour match against ref.palette
    if img.bpp == 1 and img.palette[:len(ref.palette)] == ref.palette[:len(img.palette)]:
        img.palette = ref.palette
        return img
    lut = {}
    for i, c in enumerate(ref.palette):
        lut.setdefault(c, i)
    out = Image(img.w, img.h, 1, ref.palette)
    bad = {}
    for y in range(img.h):
        for x in range(img.w):
            c = img.color(x, y)
            v = lut.get(c)
            if v is None:
                bad.setdefault(c, (x, y))
                v = 0
            out.set(x, y, bytes((v,)))
    if bad:
        sample = ', '.join('#%02x%02x%02x в точке %d,%d' % (c + xy) for c, xy in list(bad.items())[:5])
        raise ValueError('%s: %d цвет(ов) нет в палитре оригинала: %s' % (path, len(bad), sample))
    return out


# ------------------------------------------------------------------ conversion

def emotion_count(sheet):
    return max(0, (sheet.h - STRIP_H) // BLOCK_H)


def unpack(sheet):
    """sheet (engine layout) -> strip of N portraits 72x80, left to right. Same pixel format."""
    if sheet.w != SHEET_W:
        raise ValueError('лист должен быть шириной %d px, а он %d' % (SHEET_W, sheet.w))
    n = emotion_count(sheet)
    bg = sheet.get(0, 0)  # technical strip = background colour
    out = Image(PW * max(n, 1), PH, sheet.bpp, sheet.palette, fill=bg)
    for e in range(n):
        by = STRIP_H + BLOCK_H * e
        for c, r, px, py in PLACEMENTS:
            out.copy_tile(sheet, c * TILE, by + r * TILE, PW * e + px, py)
    return out


def pack(strip, base=None, trim=False):
    """strip of portraits -> engine sheet (strip must already be in base's format).
    Tiles the game never shows are taken from `base`. If the strip has fewer emotions than
    `base`, the missing ones are kept from `base` (unless trim=True)."""
    if strip.h != PH or strip.w % PW:
        raise ValueError('лента должна быть высотой %d px и шириной кратной %d, а она %dx%d'
                         % (PH, PW, strip.w, strip.h))
    n = strip.w // PW
    h = STRIP_H + BLOCK_H * n
    if base is not None and not trim:
        h = max(h, base.h)
    ref = base if base is not None else strip
    out = Image(SHEET_W, h, ref.bpp, ref.palette, fill=ref.get(0, 0))
    if base is not None:
        rb = SHEET_W * base.bpp
        for y in range(min(h, base.h)):
            out.px[y * rb:(y + 1) * rb] = base.row(y)
    for e in range(n):
        by = STRIP_H + BLOCK_H * e
        for c, r, px, py in PLACEMENTS:
            out.copy_tile(strip, PW * e + px, py, c * TILE, by + r * TILE)
    return out


def char_ids(args):
    if not args:
        return ['char%02d' % i for i in range(40)]
    res = []
    for a in args:
        a = os.path.basename(a)
        a = a.split('.')[0].replace('_faces', '')
        if a.isdigit():
            a = 'char%02d' % int(a)
        res.append(a)
    return res
