"""Вкладка «Свет»: project/src/light_profiles.cpp (структуры — light_profiles.h).

Модель:
  {"profiles": [{"id": "room", "title": "...", "cloudSunCut": 70, "cloudDesat": 35,
                 "keys": [{"min": 0, "r": 28, "g": 13, "b": 4, "amt": 34, "sun": 0, "sky": 0, "note": "ночь"}]}],
   "levels":   [{"level": 4, "profile": "room", "note": "школа"}]}   # profile None -> без окон

Файл целиком генерируется отсюда; parse() читает ровно то, что пишет generate().
"""
import re

KEY_FIELDS = ('min', 'r', 'g', 'b', 'amt', 'sun', 'sky')
LIMITS = {'min': (0, 1440), 'r': (0, 31), 'g': (0, 31), 'b': (0, 31),
          'amt': (0, 100), 'sun': (0, 100), 'sky': (0, 100),
          'cloudSunCut': (0, 100), 'cloudDesat': (0, 100)}
ID_RE = re.compile(r'^[a-z_][a-z0-9_]*$')
MAX_KEYS = 24

HEAD = """// light_profiles.cpp — свет в помещениях и транспорте по времени суток.
// Файл ведёт редактор диалогов (вкладка «Свет»): он перезаписывает его целиком.
// Править руками можно, но держите формат — редактор читает его обратно.
// Что значат поля — light_profiles.h.
#include "light_profiles.h"
"""


def _num(s):
    return int(s.strip())


def parse(text):
    profiles = []
    for m in re.finditer(r'// ---- profile (\w+): ([^\n]*)\n'
                         r'// cloudSunCut (\d+) cloudDesat (\d+)\n'
                         r'static const LightKey lk_\w+\[\] = \{\n(.*?)\n\};', text, re.S):
        keys = []
        for line in m.group(5).split('\n'):
            k = re.match(r'\s*\{([^}]*)\},?\s*(?://\s?(.*))?$', line)
            if not k:
                continue
            vals = [_num(x) for x in k.group(1).split(',')]
            if len(vals) != len(KEY_FIELDS):
                continue
            key = dict(zip(KEY_FIELDS, vals))
            key['note'] = (k.group(2) or '').strip()
            keys.append(key)
        profiles.append({"id": m.group(1), "title": m.group(2).strip(),
                         "cloudSunCut": int(m.group(3)), "cloudDesat": int(m.group(4)), "keys": keys})
    ids = [p["id"] for p in profiles]
    levels = []
    lm = re.search(r'const LightLevel lightLevels\[\] = \{\n(.*?)\n\};', text, re.S)
    for line in (lm.group(1).split('\n') if lm else []):
        k = re.match(r'\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\},?\s*(?://\s?(.*))?$', line)
        if k:
            pi = int(k.group(2))
            levels.append({"level": int(k.group(1)), "profile": ids[pi] if 0 <= pi < len(ids) else None,
                           "note": (k.group(3) or '').strip()})
    return {"profiles": profiles, "levels": levels}


def validate(model):
    errs = []
    ids = [p.get('id') for p in model.get('profiles', [])]
    if not ids:
        errs.append('нужен хотя бы один профиль')
    if len(set(ids)) != len(ids):
        errs.append('id профилей повторяются')
    for p in model.get('profiles', []):
        pid = p.get('id') or '?'
        if not ID_RE.match(p.get('id') or ''):
            errs.append('%s: id — латиница/цифры/_ с маленькой буквы' % pid)
        for f in ('cloudSunCut', 'cloudDesat'):
            lo, hi = LIMITS[f]
            if not lo <= int(p.get(f, -1)) <= hi:
                errs.append('%s: %s вне %d..%d' % (pid, f, lo, hi))
        keys = p.get('keys') or []
        if not 2 <= len(keys) <= MAX_KEYS:
            errs.append('%s: точек должно быть 2..%d' % (pid, MAX_KEYS))
            continue
        if keys[0]['min'] != 0 or keys[-1]['min'] != 1440:
            errs.append('%s: первая точка — 00:00, последняя — 24:00' % pid)
        for a, b in zip(keys, keys[1:]):
            if b['min'] < a['min']:
                errs.append('%s: точки не по порядку времени' % pid)
                break
        for k in keys:
            for f in KEY_FIELDS:
                lo, hi = LIMITS[f]
                if not lo <= int(k.get(f, -1)) <= hi:
                    errs.append('%s: %s=%s вне %d..%d' % (pid, f, k.get(f), lo, hi))
    seen = set()
    for lv in model.get('levels', []):
        n = lv.get('level')
        if not isinstance(n, int) or not 0 <= n <= 127:
            errs.append('уровень %r: номер 0..127' % n)
        if n in seen:
            errs.append('уровень %s указан дважды' % n)
        seen.add(n)
        if lv.get('profile') is not None and lv['profile'] not in ids:
            errs.append('уровень %s: нет профиля %s' % (n, lv['profile']))
    return errs


def _comment(s):
    s = (s or '').replace('\n', ' ').replace('*/', '').strip()
    return ('   // ' + s) if s else ''


def generate(model):
    out = [HEAD]
    ids = [p['id'] for p in model['profiles']]
    for p in model['profiles']:
        out.append('// ---- profile %s: %s' % (p['id'], (p.get('title') or '').replace('\n', ' ').strip()))
        out.append('// cloudSunCut %d cloudDesat %d' % (int(p['cloudSunCut']), int(p['cloudDesat'])))
        out.append('static const LightKey lk_%s[] = {' % p['id'])
        out.append('\t//  мин    R   G   B  сила солн небо')
        for k in p['keys']:
            vals = ' %4d, %3d, %3d, %3d, %3d, %3d, %3d ' % tuple(int(k[f]) for f in KEY_FIELDS)
            note = (k.get('note') or '').strip()
            out.append('\t{%s},%s' % (vals, _comment(note)))
        out.append('};')
        out.append('')
    out.append('const LightProfile lightProfiles[] = {')
    for p in model['profiles']:
        out.append('\t{ lk_%s, %d, %d, %d },%s' % (p['id'], len(p['keys']), int(p['cloudSunCut']), int(p['cloudDesat']),
                                                _comment(p.get('title'))))
    out.append('};')
    out.append('const int lightProfileCount = %d;' % len(ids))
    out.append('')
    out.append('// Уровень -> профиль (индекс в lightProfiles; -1 — без окон: родная палитра).')
    out.append('// Уровней, которых здесь нет, свет не касается — это улица.')
    out.append('const LightLevel lightLevels[] = {')
    for lv in sorted(model['levels'], key=lambda x: x['level']):
        pi = ids.index(lv['profile']) if lv.get('profile') in ids else -1
        out.append('\t{ %2d, %2d },%s' % (lv['level'], pi, _comment(lv.get('note'))))
    out.append('};')
    out.append('const int lightLevelCount = %d;' % len(model['levels']))
    return '\n'.join(out) + '\n'


def parse_sky(tw_src):
    """skyB / skyCloudy (25x4, BGR555) из time_weather_manager.cpp — для «неба в окнах» в превью."""
    out = {}
    for key, name in (('clear', 'skyB'), ('cloudy', 'skyCloudy')):
        m = re.search(r'\b%s\s*\[\s*25\s*\]\s*\[\s*4\s*\]\s*=\s*\{(.*?)\};' % name, tw_src, re.S)
        if not m:
            continue
        vals = [int(x, 16) for x in re.findall(r'0x[0-9A-Fa-f]+', re.sub(r'//[^\n]*', '', m.group(1)))]
        if len(vals) == 100:
            out[key] = [vals[i * 4:i * 4 + 4] for i in range(25)]
    return out
