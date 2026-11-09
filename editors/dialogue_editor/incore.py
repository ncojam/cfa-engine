"""Вкладка «NPC»: колесо взаимодействий - project/src/interactions.cpp (interactNPC[], interactPET[]).

Файл генерирует этот модуль (generate), читает (parse) - регулярками по тому же формату.
Запись: { "NAME", iconNum, does, attr, attR, locked }
  does 0 - подменю: attr = номер первой из 4 записей подменю (↑ → ↓ ←)
  does 1 - список:  attr = смещение в listSubjects или спец-список (HANDLERS), attR = пунктов
  does 2 - действие: attr = код действия (HANDLERS)
  locked - заблокировано: в игре «нельзя» (Snd_Click_Cant), does/attr остаются как задуманы.
"""
import re

DIRS = ["↑", "→", "↓", "←"]
NAME_MAX = 26            # Interact::name[27]

# Что игра умеет обрабатывать (player_interaction.cpp / player_pause_menu.cpp). Ключ - (does, attr).
# Для кнопки «код» в редакторе: где искать обработчик.
HANDLERS = {
    (1, 0):  {"label": "Темы разговора (listSubjects 0..)", "code": "player_interaction.cpp: executeInteractionEffect, attrib == 0 (TALK/CRITICIZE по interactDirection)"},
    (1, 10): {"label": "Ask about (listSubjects 10..14)", "code": "player_interaction.cpp: attrib == ASK_ABOUT_LIST -> Social::ask (social.cpp), ответы - personality.cpp (вкладка «Персонажи»)"},
    (1, 15): {"label": "Совместные занятия (Companions::ACTIVITY_LIST)", "code": "player_interaction.cpp: attrib == Companions::ACTIVITY_LIST; список - Companions::listActivities"},
    (1, 50): {"label": "Шутка о группе (Jokes::GROUP_LIST)", "code": "player_interaction.cpp: attrib == Jokes::GROUP_LIST -> Jokes::tell(..., ABOUT_GROUP, группа); список - Jokes::listGroups"},
    (2, 14): {"label": "Попросить номер", "code": "player_interaction.cpp: attrib == 14"},
    (2, 40): {"label": "Шутка: подколоть", "code": "player_interaction.cpp: Jokes::isJoke(attrib) -> Jokes::tell (jokes.cpp)"},
    (2, 41): {"label": "Шутка: о себе", "code": "player_interaction.cpp: Jokes::isJoke(attrib) -> Jokes::tell (jokes.cpp)"},
    (2, 60): {"label": "Флирт: поцелуй в щёку", "code": "player_interaction.cpp: Romance::isRomance(attrib) -> Romance::act (romance.cpp), поза - kissTimer"},
    (2, 61): {"label": "Флирт: поцелуй в губы", "code": "player_interaction.cpp: Romance::act (romance.cpp): влюблённость, партнёр, ревность, новости"},
    (2, 62): {"label": "Флирт: грязная шутка", "code": "player_interaction.cpp: Romance::act (romance.cpp)"},
    (2, 63): {"label": "Флирт: разрыв (мягкий)", "code": "player_interaction.cpp: Romance::act (romance.cpp) - BREAKUP"},
    (2, 43): {"label": "Шутка: смешной танец", "code": "player_interaction.cpp: Jokes::DANCE -> сначала танец (PlayerInteraction::danceTimer), потом Jokes::tell"},
}

ENTRY_RE = re.compile(r'\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(true|false|0|1)\s*\}\s*,?[ \t]*(?://[ \t]?(.*))?')


def _block(text, name):
    m = re.search(r"const\s+Interact\s+%s\s*\[\s*\]\s*=\s*\{" % name, text)
    if not m:
        raise ValueError("не найдено: " + name)
    depth, a = 0, m.end() - 1
    for i in range(a, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[a + 1:i]
    raise ValueError("не закрыт блок " + name)


def _entries(body):
    out = []
    for line in body.split("\n"):
        m = ENTRY_RE.search(line)
        if m:
            note = (m.group(7) or "").strip()
            note = re.sub(r"^\[[^\]]*\]\s*", "", note)          # служебная метка «[4 ↑ TALK]» - пересоберётся
            out.append({"name": m.group(1), "icon": int(m.group(2)), "does": int(m.group(3)), "attr": int(m.group(4)),
                        "attR": int(m.group(5)), "locked": m.group(6) in ("true", "1"), "note": note})
    return out


def parse(text):
    return {"npc": _entries(_block(text, "interactNPC")), "pet": _entries(_block(text, "interactPET"))}


def parse_legacy(text):
    """Старый многострочный формат из dialogues.cpp: заблокировано = does -2, задуманное значение - в «//1»."""
    def legacy(name):
        body = _block(text, name)
        res = []
        for e in re.findall(r"\{(.*?)\}", body, re.S):
            lines = [l.strip() for l in e.strip().split("\n") if l.strip()]
            m = re.match(r'"((?:[^"\\]|\\.)*)"\s*,?\s*(?://\s*(.*))?', lines[0])
            nums = []
            locked = False
            for l in lines[1:]:
                mm = re.match(r"(-?\d+)\s*,?\s*(?://\s*(-?\d+))?", l)
                if not mm:
                    continue
                v = int(mm.group(1))
                if len(nums) == 1 and v == -2:          # поле does
                    locked = True
                    v = int(mm.group(2)) if mm.group(2) else 1
                nums.append(v)
            nums += [0] * (4 - len(nums))
            res.append({"name": m.group(1), "icon": nums[0], "does": nums[1], "attr": nums[2], "attR": nums[3],
                        "locked": locked, "note": (m.group(2) or "").strip()})
        return res
    return {"npc": legacy("interactNPC"), "pet": legacy("interactPET")}


def slots(npc):
    """Подпись каждой записи: путь в колесе («TALK ↓ JOKE»), или None, если запись недостижима."""
    label = [None] * len(npc)

    def walk(off, path, seen):
        if off in seen or off + 3 >= len(npc) + 3:
            return
        seen = seen | {off}
        for d in range(4):
            i = off + d
            if i >= len(npc):
                continue
            label[i] = (path + " " if path else "") + DIRS[d] + " " + npc[i]["name"]
            if npc[i]["does"] == 0:
                walk(npc[i]["attr"], label[i], seen)
    walk(0, "", frozenset())
    return label


def validate(model):
    errs = []
    for kind in ("npc", "pet"):
        for i, e in enumerate(model[kind]):
            if not e["name"] or len(e["name"]) > NAME_MAX or any(ord(c) > 126 or ord(c) < 32 for c in e["name"]):
                errs.append("%s[%d]: имя 1..%d символов ASCII" % (kind, i, NAME_MAX))
            if kind == "npc" and e["does"] == 0 and not (0 <= e["attr"] and e["attr"] + 3 < len(model[kind]) + 1):
                errs.append("%s[%d] %s: подменю с записи %d, а записей %d" % (kind, i, e["name"], e["attr"], len(model[kind])))
    if len(model["npc"]) % 4:
        errs.append("записей колеса NPC должно быть кратно 4 (по 4 на уровень)")
    return errs


def c_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def generate(model):
    def rows(kind):
        lab = slots(model[kind]) if kind == "npc" else ["%s %s" % (DIRS[i % 4], e["name"]) for i, e in enumerate(model[kind])]
        out = []
        for i, e in enumerate(model[kind]):
            if i % 4 == 0:
                out.append("")
            body = "{ %s, %d, %d, %d, %d, %s }," % (c_str(e["name"]), e["icon"], e["does"], e["attr"], e["attR"],
                                                    "true" if e["locked"] else "false")
            tag = "[%d %s]" % (i, lab[i] if lab[i] else "недостижима")
            out.append("\t%-58s// %s%s" % (body, tag, (" " + e["note"]) if e.get("note") else ""))
        return out
    L = ["// interactions.cpp - колесо взаимодействий с NPC и питомцами.",
         "// Генерирует редактор: cfa-engine/editors/dialogue_editor, вкладка «NPC». Руками можно, но",
         "// в том же формате строк (одна запись - одна строка), редактор читает их регулярками.",
         "//",
         "// { name, iconNum, does, attr, attR, locked }",
         "//   does 0 - подменю: attr = первая из 4 записей подменю (по порядку ↑ → ↓ ←)",
         "//   does 1 - список:  attr = смещение в listSubjects или спец-список, attR = пунктов",
         "//   does 2 - действие: attr = код действия",
         "//   locked - заблокировано: в игре звук «нельзя»; does/attr - как задумано, для разблокировки",
         "// Обработчики attr - player_interaction.cpp (executeInteractionEffect) и player_pause_menu.cpp (makeChooseList).",
         "",
         '#include "dialogues.h"',
         "",
         "const Interact interactPET[] = {"] + rows("pet") + ["};", "", "const Interact interactNPC[] = {"] + rows("npc") + \
        ["};", "", "const int interactNPCCount = (int)( sizeof( interactNPC ) / sizeof( interactNPC[ 0 ] ) );", ""]
    return "\n".join(L)


def icon_sheet(bmp_path, first_tile=512):
    """Иконки колеса: тайлы с first_tile в листе спрайтов (mss-01.bmp, 16 тайлов в ряд).
    -> {w, h, rgba (base64), transparent [r,g,b]} - часть листа от строки first_tile/16 до конца."""
    import base64
    import struct
    with open(bmp_path, "rb") as f:
        data = f.read()
    off = struct.unpack_from("<I", data, 10)[0]
    w, h = struct.unpack_from("<ii", data, 18)
    bpp = struct.unpack_from("<H", data, 28)[0]
    if bpp != 24:
        raise ValueError("%s: нужен 24-битный BMP" % bmp_path)
    stride = (w * 3 + 3) & ~3
    y0 = (first_tile // (w // 8)) * 8
    out = bytearray()
    tr = None
    for y in range(y0, h):
        row = off + stride * (h - 1 - y)
        for x in range(w):
            b, g, r = data[row + 3 * x], data[row + 3 * x + 1], data[row + 3 * x + 2]
            if tr is None:
                tr = (r, g, b)            # цвет фона листа = прозрачный
            out += bytes((r, g, b, 0 if (r, g, b) == tr else 255))
    return {"w": w, "h": h - y0, "rgba": base64.b64encode(bytes(out)).decode("ascii"),
            "perRow": w // 8, "firstTile": first_tile}
