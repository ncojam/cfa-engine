"""Вкладка «Группы»: project/src/groups.h + groups.cpp (группы персонажей, отношения между
группами, кто в какой группе, фразы групп по ситуациям).

Оба файла генерирует этот модуль (generate). Читает (parse) - регулярками по тому же формату,
поэтому ручные правки в нём сохраняются, а произвольные - нет (о чём сказано в шапке файлов).
Общие фразы (то, что говорят все, если у группы своей нет) - только читаются из dialogues.cpp
(rTalkPointers / rCritisizePointers).
"""
import re

LEVELS = [0, 1, 3, 4]          # subjectLikes: 0 ненавидит, 1 не любит, (2 - всё равно: фраза фиксированная), 3 нравится, 4 обожает
TEXT_MAX = 107                 # как ReactTalk::react0[108]
KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")

# Ситуации, которые уже подключены в коде игры (player_interaction.cpp). Новую ситуацию
# добавляют здесь + вызов Groups::phrase() в нужном месте игры.
SITUATIONS = [
    {"key": "TALK", "label": "Разговор на тему", "where": "TALK → SUBJECT", "subjects": "topics", "levels": True,
     "defaults": "rTalkPointers"},
    {"key": "CRITICIZE", "label": "Критика темы", "where": "TALK → CRITICIZE", "subjects": "topics", "levels": True,
     "defaults": "rCritisizePointers"},
    # subject = Jokes::Type, level = Jokes::Outcome (jokes.h); общие фразы - jokeLines в jokes.cpp
    {"key": "JOKE", "label": "Шутка", "where": "TALK → JOKE", "levels": True, "defaults": "jokeLines",
     "subjects": ["Подколоть", "О себе", "О ком-то (группа)", "Смешной танец"],
     "levelLabels": {"0": "😬 провал", "1": "😐 так себе", "3": "😄 смешно", "4": "🤣 очень смешно"}},
]

# Статы Вики (_stats[], player_stats_wardrobe.h) - для юмор-профиля групп
STATS = ["Kindness", "Humor", "Charisma", "Allure", "SelfEsteem", "Intellect", "Sanity", "Behaviour"]
TITLE_MAX = 14            # listSubjects-строка в игре (char[15])


def c_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def c_unstr(body):
    return re.sub(r'\\(.)', lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), body)


STR_RE = r'"((?:[^"\\\n]|\\.)*)"'


def _block(text, start_pat):
    m = re.search(start_pat, text)
    if not m:
        raise ValueError("не найдено: " + start_pat)
    a = text.index("{", m.end() - 1)
    depth = 0
    for i in range(a, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[a + 1:i]
    raise ValueError("не закрыт блок: " + start_pat)


def parse(h_text, cpp_text):
    groups = []
    for m in re.finditer(r"^\s*G_(\w+)\s*(?:=\s*0\s*)?,\s*//\s*(.*)$", _block(h_text, r"enum\s+Group\s*\{"), re.M):
        if m.group(1) != "COUNT":
            groups.append({"key": m.group(1), "name": "", "desc": "", "title": m.group(1).title(),
                           "humorNeed": 60, "humorStat": -1, "humorStatNeed": 0})
    info = _block(cpp_text, r"const\s+GroupInfo\s+info\s*\[[^\]]*\]\s*=\s*\{")
    # { "name", "desc" [, "title", humorNeed, humorStat, humorStatNeed] }
    rx = (r"\{\s*" + STR_RE + r"\s*,\s*" + STR_RE +
          r"(?:\s*,\s*" + STR_RE + r"\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+))?\s*\}")
    for k, m in enumerate(re.finditer(rx, info)):
        if k < len(groups):
            g = groups[k]
            g["name"], g["desc"] = c_unstr(m.group(1)), c_unstr(m.group(2))
            if m.group(3) is not None:
                g["title"] = c_unstr(m.group(3))
                g["humorNeed"], g["humorStat"], g["humorStatNeed"] = int(m.group(4)), int(m.group(5)), int(m.group(6))
    keys = [g["key"] for g in groups]
    members = [keys.index(m.group(1)) if m.group(1) in keys else 0
               for m in re.finditer(r"\bG_(\w+)\s*,", _block(cpp_text, r"members\s*\[[^\]]*\]\s*=\s*\{"))]
    att_body = _block(cpp_text, r"attitudeTable\s*\[[^\]]*\]\s*\[[^\]]*\]\s*=\s*\{")
    rows = [[int(x) for x in re.findall(r"-?\d+", re.sub(r"/\*.*?\*/", "", r))]
            for r in re.findall(r"\{([^{}]*)\}", att_body)]
    n = len(groups)
    attitude = [[(rows[i][j] if i < len(rows) and j < len(rows[i]) else 0) for j in range(n)] for i in range(n)]
    phrases = []
    sit_keys = [s["key"] for s in SITUATIONS]
    ph = _block(cpp_text, r"const\s+Phrase\s+phrases\s*\[\s*\]\s*=\s*\{")
    for m in re.finditer(r"\{\s*G_(\w+)\s*,\s*SIT_(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*" + STR_RE + r"\s*\}", ph):
        if m.group(1) in keys and m.group(2) in sit_keys:
            phrases.append({"group": m.group(1), "situation": m.group(2), "subject": int(m.group(3)),
                            "level": int(m.group(4)), "text": c_unstr(m.group(5))})
    return {"groups": groups, "members": members, "attitude": attitude, "phrases": phrases}


def validate(model):
    errs = []
    keys = [g["key"] for g in model["groups"]]
    if not keys or keys[0] != "NONE":
        errs.append("первая группа должна быть NONE (без группы)")
    for k in keys:
        if not KEY_RE.match(k):
            errs.append("ключ группы %r: только A-Z, 0-9, _ и с буквы" % k)
    if len(set(keys)) != len(keys):
        errs.append("ключи групп повторяются")
    for g in model["groups"]:
        t = g.get("title") or ""
        if not t or len(t) > TITLE_MAX or any(ord(c) > 126 or ord(c) < 32 for c in t):
            errs.append("название группы %s в игре: 1..%d символов, только ASCII" % (g["key"], TITLE_MAX))
        if not (0 <= int(g.get("humorNeed", 0)) <= 250) or not (-1 <= int(g.get("humorStat", -1)) < len(STATS)):
            errs.append("юмор группы %s: порог 0..250, стат -1..%d" % (g["key"], len(STATS) - 1))
    for p in model["phrases"]:
        t = p["text"]
        if len(t) > TEXT_MAX:
            errs.append("фраза длиннее %d: %s…" % (TEXT_MAX, t[:40]))
        if any(ord(c) > 126 or ord(c) < 32 for c in t):
            errs.append("в фразе не-ASCII символ (шрифт GBA): %s…" % t[:40])
    return errs


def generate(model, char_names):
    groups, members, att = model["groups"], model["members"], model["attitude"]
    n = len(groups)
    w = max(len(g["key"]) for g in groups) + 2
    H = ["#ifndef GROUPS_H", "#define GROUPS_H", "",
         "// Группы персонажей: кто в какой группе, как группы относятся друг к другу,",
         "// фразы групп по ситуациям. Используют: Companions (кого нельзя позвать вдвоём),",
         "// player_interaction (ответы на TALK / CRITICIZE).",
         "//",
         "// groups.h / groups.cpp генерирует редактор: cfa-engine/editors/dialogue_editor,",
         "// вкладка «Группы». Править руками можно, но в том же формате строк -",
         "// редактор читает их регулярками.",
         "", "namespace Groups", "{", "", "enum Group", "{"]
    for k, g in enumerate(groups):
        H.append("\t%-*s// %s" % (w + 6, "G_%s%s," % (g["key"], " = 0" if k == 0 else ""), g["name"]))
    H += ["\tG_COUNT", "};", "", "// Ситуации, для которых у группы могут быть свои фразы", "enum Situation", "{"]
    for k, s in enumerate(SITUATIONS):
        H.append("\t%-24s// %s (%s)" % ("SIT_%s%s," % (s["key"], " = 0" if k == 0 else ""), s["label"], s["where"]))
    H += ["\tSIT_COUNT", "};", "",
          "// name/desc - для редактора; title - как группа называется в игре (список «о ком шутим»).",
          "// Юмор: шутка заходит, если юмор Вики (+ бонусы, см. jokes.cpp) >= humorNeed;",
          "// humorStat >= 0 - ещё нужен этот стат Вики (_stats[], 3 Allure = стиль, 5 Intellect) около humorStatNeed.",
          "struct GroupInfo { const char *name; const char *desc; const char *title; short humorNeed; signed char humorStat; short humorStatNeed; };",
          "// subject - номер темы (listSubjects), level - subjectLikes персонажа (0,1,3,4)",
          "struct Phrase { unsigned char group, situation, subject, level; const char *text; };", "",
          "extern const GroupInfo info[ G_COUNT ];", "",
          "int groupOf( int charID );            // G_NONE, если не знаем",
          "int attitude( int ga, int gb );       // -2 вместе не придут, -1 недолюбливают, 0 всё равно, 1..2 дружат",
          "// Своя фраза группы; pick - любое число (выбирается pick % количество).",
          "// nullptr - своей нет, говорим общую.",
          "const char *phrase( int group, int situation, int subject, int level, int pick );", "",
          "}", "", "#endif", ""]

    C = ['#include "groups.h"', '#include "persons.h"', "", "// Сгенерировано редактором (вкладка «Группы»). Формат - см. groups.h.", "",
         "namespace Groups", "{", "",
         "const GroupInfo info[ G_COUNT ] = {"]
    for g in groups:
        C.append("\t/* %-*s */ { %s, %s, %s, %d, %d, %d }," % (
            w, g["key"], c_str(g["name"]), c_str(g["desc"]), c_str(g.get("title") or g["key"].title()),
            int(g.get("humorNeed", 60)), int(g.get("humorStat", -1)), int(g.get("humorStatNeed", 0))))
    C += ["};", "", "// Кто в какой группе: индекс = charID", "static const unsigned char members[ CHAR_COUNT ] = {"]
    total = max(len(members), len(char_names), 40)
    for cid in range(total):
        gi = members[cid] if cid < len(members) else 0
        nm = char_names[cid] if cid < len(char_names) else ""
        C.append("\t%-*s// %d %s" % (w + 4, "G_%s," % groups[gi]["key"], cid, nm))
    C += ["};", "",
          "// Отношение группы строки к группе столбца (симметричная).",
          "// -2 вместе не придут, -1 недолюбливают, 0 всё равно, 1..2 дружат.",
          "static const signed char attitudeTable[ G_COUNT ][ G_COUNT ] = {",
          "\t//" + " " * (w + 7) + "".join("%5s " % g["key"][:5] for g in groups)]
    for i, g in enumerate(groups):
        C.append("\t/* %-*s */ { %s }," % (w, g["key"], ",".join("%5d" % att[i][j] for j in range(n))))
    C += ["};", "", "// Свои фразы групп. Нет фразы для группы/темы/уровня - игра берёт общую из dialogues.cpp.",
          "static const Phrase phrases[] = {"]
    order = {s["key"]: k for k, s in enumerate(SITUATIONS)}
    gk = {g["key"]: k for k, g in enumerate(groups)}
    ph = sorted((p for p in model["phrases"] if p["group"] in gk and p["text"].strip()),
                key=lambda p: (gk[p["group"]], order.get(p["situation"], 99), p["subject"], p["level"]))
    last = None
    for p in ph:
        if (p["group"], p["situation"]) != last:
            C.append("\t// ---- %s / %s" % (p["group"], p["situation"]))
            last = (p["group"], p["situation"])
        C.append("\t{ G_%s, SIT_%s, %d, %d, %s }," % (p["group"], p["situation"], p["subject"], p["level"], c_str(p["text"])))
    C += ["\t{ 0, 0, 0, 0, nullptr }", "};", "",
          "int groupOf( int charID )", "{",
          "\tif( charID < 0 || charID >= CHAR_COUNT ) { return G_NONE; }",
          "\treturn members[ charID ];", "}", "",
          "int attitude( int ga, int gb )", "{",
          "\tif( ga < 0 || ga >= G_COUNT || gb < 0 || gb >= G_COUNT ) { return 0; }",
          "\treturn attitudeTable[ ga ][ gb ];", "}", "",
          "const char *phrase( int group, int situation, int subject, int level, int pick )", "{",
          "\tint n = 0;",
          "\tfor( const Phrase *p = phrases; p->text; p++ ) {",
          "\t\tif( p->group == group && p->situation == situation && p->subject == subject && p->level == level ) { n++; }",
          "\t}",
          "\tif( n == 0 ) { return nullptr; }",
          "\tif( pick < 0 ) { pick = -pick; }",
          "\tpick %= n;",
          "\tfor( const Phrase *p = phrases; p->text; p++ ) {",
          "\t\tif( p->group == group && p->situation == situation && p->subject == subject && p->level == level ) {",
          "\t\t\tif( pick-- == 0 ) { return p->text; }",
          "\t\t}",
          "\t}",
          "\treturn nullptr;", "}", "",
          "}", ""]
    return "\n".join(H), "\n".join(C)


# ------------------------------------------------------------------ общие фразы (только чтение)

def parse_subjects(dialogues_cpp):
    m = re.search(r"listSubjects\s*\[[^\]]*\]\s*\[[^\]]*\]\s*=\s*\{(.*?)\};", dialogues_cpp, re.S)
    if not m:
        return []
    body = re.sub(r"//[^\n]*", "", m.group(1))
    out = [c_unstr(s) for s in re.findall(STR_RE, body)]
    return out


def parse_joke_defaults(jokes_cpp):
    """jokeLines[ Jokes::COUNT ][ 2 ] из jokes.cpp -> {type: [[fail, meh, laugh, big], ...]}"""
    try:
        body = _block(jokes_cpp, r"jokeLines\s*\[[^\]]*\]\s*\[[^\]]*\]\s*=\s*\{")
    except ValueError:
        return {}
    body = re.sub(r"//[^\n]*", "", body)
    out, depth, start, k = {}, 0, None, 0
    for i, ch in enumerate(body):     # верхний уровень: по блоку на тип шутки
        if ch == "{":
            depth += 1
            if depth == 1:
                start = i
        elif ch == "}":
            depth -= 1
            if depth == 0:
                out[k] = [[c_unstr(x) for x in re.findall(STR_RE, e)] for e in re.findall(r"\{([^{}]*)\}", body[start + 1:i])]
                k += 1
    return out


def parse_defaults(dialogues_cpp):
    """{SIT: {subject: [[react0, react1, react3, react4], ...вариант 2...]}}"""
    out = {}
    for s in SITUATIONS:
        m = re.search(s["defaults"] + r"\s*\[[^\]]*\]\s*=\s*\{(.*?)\};", dialogues_cpp, re.S)
        if not m:
            continue
        names = [x.strip() for x in m.group(1).split(",")]
        res = {}
        for subj, name in enumerate(names):
            if not name or name == "nullptr":
                continue
            try:
                body = _block(dialogues_cpp, r"\b" + re.escape(name) + r"\s*\[\s*\]\s*=\s*\{")
            except ValueError:
                continue
            body = re.sub(r"(?m)^\s*//[^\n]*", "", body)
            res[subj] = [[c_unstr(x) for x in re.findall(STR_RE, e)] for e in re.findall(r"\{([^{}]*)\}", body)]
        out[s["key"]] = res
    return out
