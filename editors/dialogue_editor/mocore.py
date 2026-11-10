"""Вкладка «Миссии»: порядок прохождения — массив missionOrder[] в project/src/mission_order.cpp.

Модель: {"order": [{"id": 0, "note": "Вступление"}, ...]}
Переписывается только тело массива; остальной файл (nextMissionAfter и т.д.) не трогаем.
"""
import re

ARR_RE = re.compile(r'(const int missionOrder\[\]\s*=\s*\{\n)(.*?)(\n\};)', re.S)


def parse(text):
    m = ARR_RE.search(text)
    order = []
    for line in (m.group(2).split('\n') if m else []):
        k = re.match(r'\s*(-?\d+)\s*,?\s*(?://\s?(.*))?$', line)
        if k:
            order.append({"id": int(k.group(1)), "note": (k.group(2) or '').strip()})
    return {"order": order}


def validate(model, known_ids):
    errs = []
    ids = [o.get('id') for o in model.get('order', [])]
    if not ids:
        errs.append('порядок пуст')
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        errs.append('миссии повторяются: %s' % ', '.join(map(str, dup)))
    bad = [i for i in ids if i not in known_ids]
    if bad:
        errs.append('нет таких миссий в dPointers: %s' % ', '.join(map(str, bad)))
    return errs


def generate(old_text, model):
    lines = []
    for o in model['order']:
        note = (o.get('note') or '').replace('\n', ' ').strip()
        num = '%d,' % int(o['id'])
        lines.append('\t%-4s// %s' % (num, note) if note else '\t' + num)
    body = '\n'.join(lines)
    if not ARR_RE.search(old_text):
        raise ValueError('mission_order.cpp: не найден массив missionOrder[]')
    return ARR_RE.sub(lambda m: m.group(1) + body + m.group(3), old_text, count=1)
