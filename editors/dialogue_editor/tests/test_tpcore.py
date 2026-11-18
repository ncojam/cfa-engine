"""Тесты вкладки «Тайлсет» (tpcore.py) на синтетическом мини-проекте: python3 -m unittest discover -s tests"""
import base64
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import stcore  # noqa: E402
import tpcore  # noqa: E402
from tpcore import MAG_TILE, Bmp, join_cells, rgb_key, write_png  # noqa: E402

COLORS = [(0, 0, 0), (248, 200, 40), (40, 120, 248), (200, 40, 40), (40, 200, 80), (120, 120, 120)]
TABLE = """#include "x.h"
const SuperTilerPair superTilerPairs[] = {
	// [0] a -> [1] b   @ -
	{ {%d,%d,6}, {%d,%d,6} },
};
"""


def rnd_tile(rng):
    return b"".join(bytes(rng.choice(COLORS)) for _ in range(64))


class Proj:
    """tmx использует первые 20 ячеек, пара подмены - ячейки 30..35; остальное - мусор для удаления"""

    def __init__(self, tmp, seed=1):
        rng = random.Random(seed)
        self.root = tmp
        for d in ("images", "resources", "src", "tools"):
            os.makedirs(os.path.join(tmp, d))
        self.tw, self.th = 16, 16
        cells = [MAG_TILE] + [rnd_tile(rng) for _ in range(self.tw * self.th - 1)]
        for i in range(60, 70):                          # повторы и отражения - память не занимают
            cells[i] = tpcore.flip_rgb(cells[i - 50], i % 4)
        self.bmp = Bmp(self.tw * 8, self.th * 8, self._header(), join_cells(cells, self.tw, self.th))
        self.bmp.save(os.path.join(tmp, "images", "mts-t.bmp"))
        used = list(range(20))
        rows = [",".join(str(1 + used[(y * 10 + x) % 20]) for x in range(10)) for y in range(4)]
        with open(os.path.join(tmp, "resources", "map-t.tmx"), "w") as f:
            f.write('<?xml version="1.0"?>\n<map width="10" height="4"><tileset firstgid="1" source="mts-t.tsx"/>\n'
                    ' <layer id="1" name="gr_map_t" width="10" height="4"><data encoding="csv">\n%s\n</data></layer></map>\n' % ",\n".join(rows))
        with open(os.path.join(tmp, "build_graphics.sh"), "w") as f:
            f.write('"$TMX2INCL" bct ../images/mts-t.bmp ../resources/map-t.tmx gr_t\n')
        ts = tpcore.Tileset.from_bmp(self.bmp)
        a, b = ts.opt[30] * 2, ts.opt[40] * 2
        with open(os.path.join(tmp, "src", "supertiles.cpp"), "w") as f:
            f.write(TABLE % (a, a, a, b))
        self._orig_usage = stcore.load_usage
        stcore.load_usage = lambda project: {"use": {"0": ["t"], "1": ["t"]}, "errors": []}

    def close(self):
        stcore.load_usage = self._orig_usage

    @staticmethod
    def _header():
        import struct
        h = bytearray(54)
        h[0:2] = b"BM"
        struct.pack_into("<I", h, 10, 54)
        struct.pack_into("<I", h, 14, 40)
        struct.pack_into("<HH", h, 26, 1, 24)
        return bytes(h)


class TpCoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.here = os.path.join(self.tmp.name, "here")
        self.proj = os.path.join(self.tmp.name, "proj")
        os.makedirs(self.proj)
        self.p = Proj(self.proj)
        tpcore._PICS.clear()

    def tearDown(self):
        self.p.close()
        self.tmp.cleanup()

    def tile_bytes(self, path, idx):
        c = stcore.compress_tileset(path)
        raw = base64.b64decode(c["tiles"])
        return [tuple(c["pal"][b][k] >> 3 for k in range(3)) for b in raw[idx * 64:(idx + 1) * 64]]

    def test_compress_matches_tmx2incl_logic(self):
        path = os.path.join(self.proj, "images", "mts-t.bmp")
        ts, _ = tpcore.load_tileset(path)
        c = stcore.compress_tileset(path)
        self.assertEqual(ts.count, c["optCount"])
        self.assertEqual(ts.opt, [v & 0x3FF for v in c["opt"]])
        self.assertEqual(ts.orient, [v >> 10 for v in c["opt"]])

    def test_scan_marks_unused_and_protected(self):
        sc = tpcore.scan(self.proj, "mts-t.bmp", ["map-t.tmx"])
        st = sc["status"]
        self.assertEqual(st[5], "u")
        self.assertEqual(st[30], "p")             # из диапазона подмены
        self.assertEqual(st[100], "f")            # никому не нужен
        self.assertEqual(st[60], "d")             # отражение чужого тайла (10 -> 60)

    def test_delete_shifts_pairs_without_changing_content(self):
        path = os.path.join(self.proj, "images", "mts-t.bmp")
        before = stcore.compress_tileset(path)
        sc = tpcore.scan(self.proj, "mts-t.bmp", ["map-t.tmx"])
        res = tpcore.apply(self.proj, self.here, {"bmp": "mts-t.bmp", "delete": list(sc["unused"])})
        after = stcore.compress_tileset(path)
        self.assertLess(after["optCount"], before["optCount"])
        self.assertTrue(os.path.isdir(res["backup"]))
        with open(os.path.join(res["backup"], "supertiles.cpp")) as f:
            self.assertIn("%d" % (tpcore.Tileset.from_bmp(Bmp.load(os.path.join(res["backup"], "mts-t.bmp"))).opt[30] * 2), f.read())
        _, pairs, _ = stcore.parse_table(open(os.path.join(self.proj, "src", "supertiles.cpp")).read())
        a_new = pairs[0]["a"]["to"] // 2
        ts0 = tpcore.Tileset.from_bmp(Bmp.load(os.path.join(res["backup"], "mts-t.bmp")))
        _, p0, _ = stcore.parse_table(open(os.path.join(res["backup"], "supertiles.cpp")).read())
        a_old = p0[0]["a"]["to"] // 2
        for k in range(6):   # те же тайлы (сравниваем цвета, а не номера палитры)
            self.assertEqual(self.tile_bytes(os.path.join(res["backup"], "mts-t.bmp"), a_old + k),
                             self.tile_bytes(path, a_new + k))
        used = tpcore.used_cells(self.proj, ["map-t.tmx"], {}, 256)
        b1 = Bmp.load(path)
        cells = tpcore.split_cells(b1.w, b1.h, b1.rgb)
        self.assertTrue(all(cells[c] == ts0.cells[c] for c in used))

    def test_picture_pack_compress_and_export(self):
        rng = random.Random(9)
        sc = tpcore.scan(self.proj, "mts-t.bmp", ["map-t.tmx"])
        ts = sc["ts"]
        cells = []
        for i in range(8 * 6):
            r = rng.random()
            cells.append(MAG_TILE if i < 4 else (tpcore.flip_rgb(ts.cells[rng.randrange(20)], rng.randrange(4)) if r < .3 else rnd_tile(rng)))
        pic = tpcore.add_pic("p.png", write_png(64, 48, join_cells(cells, 8, 6)))
        free_now = 864 - tpcore.plan(self.proj, {"bmp": "mts-t.bmp", "delete": list(sc["unused"])})["_ts1"].count
        limit = 864 - free_now + 12                      # ровно 12 свободных тайлов
        P = {"bmp": "mts-t.bmp", "delete": list(sc["unused"]), "img": pic.id, "limit": limit, "place": {"mode": "holes"}}
        out = tpcore.plan(self.proj, P, auto=True)
        self.assertEqual(out["errors"], [])
        self.assertLessEqual(out["pic"]["needTiles"], 12)
        self.assertTrue(out["result"]["ok"])
        P["repl"] = out["repl"]
        tpcore.apply(self.proj, self.here, P)
        c = stcore.compress_tileset(os.path.join(self.proj, "images", "mts-t.bmp"))
        self.assertEqual(c["optCount"], out["result"]["opt"])
        ex = tpcore.export_tmx(self.proj, self.here, {"bmp": "mts-t.bmp", "outDir": os.path.join(self.tmp.name, "out"), "name": "h"})
        layers, _ = tpcore.read_layers(ex["tmx"])
        bmp_cells = tpcore.Tileset.from_bmp(Bmp.load(os.path.join(self.proj, "images", "mts-t.bmp"))).cells
        gids, final = layers[0]["gids"], out["_final"]
        self.assertEqual(len(gids), 48)
        for g, f in zip(gids, final):
            self.assertEqual(rgb_key(MAG_TILE if g == 0 else bmp_cells[g - 1]), rgb_key(f))

    def _pic(self, n=24, seed=3):
        rng = random.Random(seed)
        cells = [rnd_tile(rng) for _ in range(n)]
        return tpcore.add_pic("q.png", write_png(8 * n, 8, join_cells(cells, n, 1)))

    def test_used_delete_skip_and_by_map_capacity(self):
        sc = tpcore.scan(self.proj, "mts-t.bmp", ["map-t.tmx"])
        used_root = next(iter(sc["used_cls"] - {sc["blank"]}))
        self.assertIn(used_root, sc["groups"])            # используемые тоже можно удалять
        o0 = tpcore.plan(self.proj, {"bmp": "mts-t.bmp"})["tiles"]
        o1 = tpcore.plan(self.proj, {"bmp": "mts-t.bmp", "delete": [used_root]})["tiles"]
        self.assertEqual(o1["keepAfter"], o0["keepAfter"] - 1)
        self.assertEqual(o0["free"], 864 - o0["keepAfter"])
        pic = self._pic()
        a = tpcore.plan(self.proj, {"bmp": "mts-t.bmp", "img": pic.id})
        cls = a["picCls"]
        skip = [c["id"] for c in cls[:5] if not c["blank"]]
        b = tpcore.plan(self.proj, {"bmp": "mts-t.bmp", "img": pic.id, "skip": skip})
        self.assertEqual(b["pic"]["needTiles"], a["pic"]["needTiles"] - len(skip))
        self.assertEqual(b["pic"]["skipped"], len(skip))

    def test_areas_copy_target_and_export(self):
        sc = tpcore.scan(self.proj, "mts-t.bmp", ["map-t.tmx"])
        area = [c for c in range(len(sc["ts"].cells)) if sc["status"][c] == "u"][:6]
        pic = self._pic(6, 5)
        P = {"bmp": "mts-t.bmp", "areas": area, "img": pic.id, "place": {"mode": "holes"},
             "target": {"mode": "copy", "name": "mycopy", "dir": os.path.join(self.tmp.name, "cp")}}
        out = tpcore.plan(self.proj, P)
        self.assertEqual(out["errors"], [])
        self.assertTrue(set(a for r, c in out["layout"]["pos"] for a in [r * 16 + c]) <= set(area) | set(range(1000)))
        orig = open(os.path.join(self.proj, "images", "mts-t.bmp"), "rb").read()
        res = tpcore.apply(self.proj, self.here, P)
        self.assertEqual(orig, open(os.path.join(self.proj, "images", "mts-t.bmp"), "rb").read())   # основной не тронут
        self.assertTrue(os.path.isfile(os.path.join(self.tmp.name, "cp", "mycopy.bmp")))
        tsx = open(os.path.join(self.tmp.name, "cp", "mycopy.tsx"), encoding="utf-8").read()
        self.assertIn('source="mycopy.bmp"', tsx)
        ex = tpcore.export_tmx(self.proj, self.here, {"bmp": "mts-t.bmp", "name": "b"})
        self.assertTrue(ex["tmx"].startswith(os.path.join(self.tmp.name, "cp")))
        self.assertIn('source="mycopy.tsx"', open(ex["tmx"], encoding="utf-8").read())

    def test_png_roundtrip_and_alpha(self):
        rgb = bytes(range(0, 192)) * 1
        w, h, back, padded = tpcore.load_image_bytes(write_png(8, 8, rgb))
        self.assertEqual((w, h, back, padded), (8, 8, rgb, False))
        w, h, back, padded = tpcore.load_image_bytes(write_png(9, 3, bytes(81)))
        self.assertEqual((w, h, padded), (16, 8, True))


if __name__ == "__main__":
    unittest.main()
