"""Вкладка «Персонажи»: project/src/personality.h + personality.cpp.

* Ask about: пороги тем; шаблоны ответов (тема x ярус, «%s» - что подставить); у персонажей -
  любимая музыка, любимые места (из общего списка мест), любимая еда и мечты (по нескольку вариантов).
  Хобби не хранятся: игра берёт любимые темы разговора персонажа (subjectLikes).
* Романтика: пол, ориентация, партнёр, в кого влюблён, флаги.

Оба файла генерирует этот модуль; читает (parse) регулярками по тому же формату.
"""
import re

ASK_TOPICS = ["hobbies", "fav. music", "best places", "fav. meals", "dreams"]   # = listSubjects[10..14]
TIERS = ["не хочет говорить", "неохотно", "с удовольствием"]
TEXT_MAX = 107
ITEM_MAX = 50             # то, что подставляется в шаблон (шаблон с %s - до TEXT_MAX - ITEM_MAX + 2)
MAX_ITEMS = 3             # еды / мечт на персонажа
GENDERS = ["—", "мальчик", "девочка"]
ORIENT = ["—", "гетеро", "гей / лесби", "би", "асексуал(ка)"]
FLAGS = [(1, "NO_ROMANCE", "никакой романтики (взрослые, семья, питомцы)"),
         (2, "WONT_DATE_VIKA", "не станет встречаться с Викой"),
         (4, "CHEEK_ONLY", "только в щёку (родня): в губы - странно"),
         (8, "FAITHFUL", "однолюб: ревнует даже к поцелую в щёку, второго возлюбленного не потерпит"),
         (16, "STORY_LOVE", "по сюжету влюбляется в Вику")]
PARTNER_NONE, PARTNER_OUTSIDE = -1, -2
STR_RE = r'"((?:[^"\\\n]|\\.)*)"'


def c_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def c_unstr(b):
    return re.sub(r'\\(.)', lambda m: m.group(1), b)


def _block(text, pat):
    m = re.search(pat, text)
    if not m:
        raise ValueError("не найдено: " + pat)
    a = text.index("{", m.end() - 1)
    d = 0
    for i in range(a, len(text)):
        if text[i] == "{":
            d += 1
        elif text[i] == "}":
            d -= 1
            if d == 0:
                return text[a + 1:i]
    raise ValueError("не закрыт блок: " + pat)


def _groups(body):
    """Верхнеуровневые {...} внутри тела массива."""
    out, d, s = [], 0, None
    for i, ch in enumerate(body):
        if ch == "{":
            d += 1
            if d == 1:
                s = i
        elif ch == "}":
            d -= 1
            if d == 0:
                out.append(body[s + 1:i])
    return out


def empty_model(n_chars):
    return {"rules": [{"reluctant": 10, "happy": 40} for _ in ASK_TOPICS],
            "templates": [["", "", ""] for _ in ASK_TOPICS],
            "places": [],
            "chars": [{"music": "", "places": [], "meals": [], "dreams": []} for _ in range(n_chars)],
            "romance": [{"gender": 0, "orient": 0, "partner": PARTNER_NONE, "crush": [], "flags": 0, "note": ""}
                        for _ in range(n_chars)]}


def parse(h_text, cpp_text, n_chars):
    m = empty_model(n_chars)
    rules = re.findall(r"\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}", _block(cpp_text, r"const\s+AskRule\s+askRules\s*\[[^\]]*\]\s*=\s*\{"))
    for k, (a, b) in enumerate(rules[:len(ASK_TOPICS)]):
        m["rules"][k] = {"reluctant": int(a), "happy": int(b)}
    for k, grp in enumerate(_groups(_block(cpp_text, r"askTemplates\s*\[[^\]]*\]\s*\[[^\]]*\]\s*=\s*\{"))[:len(ASK_TOPICS)]):
        m["templates"][k] = ([c_unstr(x) for x in re.findall(STR_RE, grp)] + ["", "", ""])[:3]
    m["places"] = [c_unstr(x) for x in re.findall(STR_RE, re.sub(r"//[^\n]*", "", _block(cpp_text, r"places\s*\[[^\]]*\]\s*=\s*\{")))]
    for k, grp in enumerate(_groups(_block(cpp_text, r"const\s+CharAsk\s+charAsk\s*\[[^\]]*\]\s*=\s*\{"))[:n_chars]):
        # { "music", { p0, p1 }, { meals x3 }, { dreams x3 } }
        parts = _groups(grp)
        music = re.match(r'\s*' + STR_RE, grp)
        strs = lambda s: [c_unstr(x) for x in re.findall(STR_RE, s)]
        m["chars"][k] = {"music": c_unstr(music.group(1)) if music else "",
                         "places": [int(x) for x in re.findall(r"-?\d+", parts[0]) if int(x) >= 0] if parts else [],
                         "meals": [x for x in strs(parts[1])] if len(parts) > 1 else [],
                         "dreams": [x for x in strs(parts[2])] if len(parts) > 2 else []}
    ro = _block(cpp_text, r"const\s+Romance\s+romance\s*\[[^\]]*\]\s*=\s*\{")
    for k, mm in enumerate(re.finditer(r"\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*(\d+)\s*\}\s*,?[ \t]*(?://[ \t]*\d+[ \t]+\S+(?:[ \t]+-[ \t]+(.*))?)?", ro)):
        if k < n_chars:
            m["romance"][k] = {"gender": int(mm.group(1)), "orient": int(mm.group(2)), "partner": int(mm.group(3)),
                               "crush": [int(x) for x in mm.group(4, 5, 6) if int(x) >= 0], "flags": int(mm.group(7)),
                               "note": (mm.group(8) or "").strip()}
    return m


def _bad(t, limit):
    return len(t) > limit or any(ord(c) > 126 or ord(c) < 32 for c in t)


def validate(m):
    errs = []
    for k, r in enumerate(m["rules"]):
        if not (r["reluctant"] <= r["happy"]):
            errs.append("тема %s: «неохотно» с %d, а «с удовольствием» с %d" % (ASK_TOPICS[k], r["reluctant"], r["happy"]))
    for k, row in enumerate(m["templates"]):
        for t, s in enumerate(row):
            if _bad(s, TEXT_MAX - ITEM_MAX + 2 if "%s" in s else TEXT_MAX):
                errs.append("шаблон %s / %s: ASCII, с «%%s» до %d символов" % (ASK_TOPICS[k], TIERS[t], TEXT_MAX - ITEM_MAX + 2))
            if s.count("%") != (1 if "%s" in s else 0) or s.count("%s") > 1:
                errs.append("шаблон %s / %s: можно только одно «%%s» и без других «%%»" % (ASK_TOPICS[k], TIERS[t]))
    for p in m["places"]:
        if not p or _bad(p, ITEM_MAX):
            errs.append("место: 1..%d символов ASCII" % ITEM_MAX)
    for k, c in enumerate(m["chars"]):
        for s in [c["music"]] + c["meals"] + c["dreams"]:
            if _bad(s, ITEM_MAX) or "%" in s:
                errs.append("персонаж %d: «%s…» - до %d символов ASCII, без «%%»" % (k, s[:20], ITEM_MAX))
        if len(c["meals"]) > MAX_ITEMS or len(c["dreams"]) > MAX_ITEMS or len(c["places"]) > 2:
            errs.append("персонаж %d: еды/мечт до %d, мест до 2" % (k, MAX_ITEMS))
        if any(p >= len(m["places"]) for p in c["places"]):
            errs.append("персонаж %d: такого места нет" % k)
    for k, r in enumerate(m["romance"]):
        if len(r["crush"]) > 3:
            errs.append("персонаж %d: влюблён максимум в троих" % k)
    return errs


def generate(m, names):
    H = """#ifndef PERSONALITY_H
#define PERSONALITY_H

// Характеры персонажей: что отвечают на Ask about и романтические профили.
// personality.h / .cpp генерирует редактор: cfa-engine/editors/dialogue_editor, вкладка «Персонажи».
// Руками править можно, но в том же формате строк. Логика - social.cpp, romance.cpp.

namespace Personality
{

// ---- Ask about (TALK -> Ask about, темы = listSubjects[10..14])
enum AskTopic { ASK_HOBBIES = 0, ASK_MUSIC, ASK_PLACES, ASK_MEALS, ASK_DREAMS, ASK_COUNT };
enum AskTier { ASK_REFUSE = 0, ASK_RELUCTANT, ASK_HAPPY, ASK_TIERS };
// Ярус по «отношениям» (relationLVLS + бонус группы, social.cpp): < reluctant - не хочет,
// < happy - неохотно, дальше - с удовольствием
struct AskRule { short reluctant, happy; };
extern const AskRule askRules[ ASK_COUNT ];
// Шаблон ответа [тема][ярус]; «%s» заменяется на любимое персонажа (хобби - любимая тема разговора)
extern const char *const askTemplates[ ASK_COUNT ][ ASK_TIERS ];
enum { PLACE_COUNT = @PC@, MAX_ITEMS = @MI@ };
extern const char *const places[ PLACE_COUNT ];
struct CharAsk
{
	const char *music;                     // любимая музыка ("" - нет)
	signed char place[ 2 ];                // любимые места (индексы places, -1 - нет)
	const char *meals[ MAX_ITEMS ];        // любимая еда (nullptr - нет)
	const char *dreams[ MAX_ITEMS ];       // мечты
};
extern const CharAsk charAsk[];            // индекс = charID

// ---- Романтика
enum Gender { GENDER_NONE = 0, BOY, GIRL };
enum Orientation { OR_NONE = 0, HETERO, HOMO, BI, ACE };
enum { PARTNER_NONE = -1, PARTNER_OUTSIDE = -2 };   // нет партнёра / занят кем-то не из игры
enum Flag {
""".replace("@PC@", str(max(1, len(m["places"])))).replace("@MI@", str(MAX_ITEMS))
    for bit, key, label in FLAGS:
        H += "\t%-16s = %2d,   // %s\n" % (key, bit, label)
    H += """};
struct Romance { signed char gender, orientation, partner; signed char crush[ 3 ]; unsigned char flags; };
extern const Romance romance[];                     // индекс = charID

}

#endif
"""
    C = ['#include "personality.h"', '#include "persons.h"', "",
         "// Сгенерировано редактором (вкладка «Персонажи»). Формат - см. personality.h.", "",
         "namespace Personality", "{", "",
         "// { с какого «отношения» неохотно, с какого - с удовольствием }",
         "const AskRule askRules[ ASK_COUNT ] = {"]
    for k, r in enumerate(m["rules"]):
        C.append("\t{ %d, %d },   // %s" % (r["reluctant"], r["happy"], ASK_TOPICS[k]))
    C += ["};", "", "// [тема] = { не хочет, неохотно, с удовольствием }; %s - что подставить",
          "const char *const askTemplates[ ASK_COUNT ][ ASK_TIERS ] = {"]
    for k, f in enumerate(m["templates"]):
        C.append("\t{ %s },   // %s" % (", ".join(c_str(x) for x in f), ASK_TOPICS[k]))
    C += ["};", "", "const char *const places[ PLACE_COUNT ] = {"]
    for k, p in enumerate(m["places"] or ["somewhere"]):
        C.append("\t%s,   // %d" % (c_str(p), k))
    C += ["};", "", "// { музыка, { места }, { еда }, { мечты } }", "const CharAsk charAsk[] = {"]

    def lst(items):
        items = (items + [None] * MAX_ITEMS)[:MAX_ITEMS]
        return "{ " + ", ".join(c_str(x) if x else "nullptr" for x in items) + " }"
    for k, c in enumerate(m["chars"]):
        pl = (c["places"] + [-1, -1])[:2]
        nm = names[k] if k < len(names) else "?"
        C.append("\t// %d %s" % (k, nm))
        C.append("\t{ %s, { %d, %d }, %s, %s }," % (c_str(c["music"]), pl[0], pl[1], lst(c["meals"]), lst(c["dreams"])))
    C += ["};", "",
          "// { пол, ориентация, партнёр (charID / -1 нет / -2 не из игры), { влюблён в charID x3 }, флаги }",
          "const Romance romance[] = {"]
    for k, r in enumerate(m["romance"]):
        cr = (r["crush"] + [-1, -1, -1])[:3]
        body = "{ %d, %d, %d, { %d, %d, %d }, %d }," % (r["gender"], r["orient"], r["partner"], cr[0], cr[1], cr[2], r["flags"])
        nm = names[k] if k < len(names) else "?"
        C.append("\t%-38s// %d %s%s" % (body, k, nm.replace(" ", "_"), (" - " + r["note"]) if r.get("note") else ""))
    C += ["};", "", "}", ""]
    return H, "\n".join(C)
