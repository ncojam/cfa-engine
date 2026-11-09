"""Вкладка «Персонажи»: project/src/personality.h + personality.cpp.

* Ask about: пороги тем, ответы персонажей (персонаж x тема x ярус), общие ответы.
* Романтика: пол, ориентация, партнёр, в кого влюблён, флаги - пока только данные (механика флирта - позже).

Оба файла генерирует этот модуль; читает (parse) регулярками по тому же формату.
"""
import re

ASK_TOPICS = ["hobbies", "fav. music", "best places", "fav. meals", "dreams"]   # = listSubjects[10..14]
TIERS = ["не хочет говорить", "неохотно", "с удовольствием"]
TEXT_MAX = 107
GENDERS = ["—", "мальчик", "девочка"]
ORIENT = ["—", "гетеро", "гей / лесби", "би", "асексуал(ка)"]
# флаги романтики: (бит, ключ в коде, подпись)
FLAGS = [(1, "NO_ROMANCE", "никакой романтики (взрослые, семья, питомцы)"),
         (2, "WONT_DATE_VIKA", "не станет встречаться с Викой"),
         (4, "CHEEK_ONLY", "только в щёку (родня): в губы - странно"),
         (8, "FAITHFUL", "однолюб: ревнует даже к поцелую в щёку"),
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


def empty_model(n_chars):
    return {"rules": [{"reluctant": 10, "happy": 40} for _ in ASK_TOPICS],
            "fallback": [["", "", ""] for _ in ASK_TOPICS],
            "lines": [],
            "romance": [{"gender": 0, "orient": 0, "partner": PARTNER_NONE, "crush": [], "flags": 0, "note": ""}
                        for _ in range(n_chars)]}


def parse(h_text, cpp_text, n_chars):
    m = empty_model(n_chars)
    rules = re.findall(r"\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}", _block(cpp_text, r"const\s+AskRule\s+askRules\s*\[[^\]]*\]\s*=\s*\{"))
    for k, (a, b) in enumerate(rules[:len(ASK_TOPICS)]):
        m["rules"][k] = {"reluctant": int(a), "happy": int(b)}
    fb = _block(cpp_text, r"askFallback\s*\[[^\]]*\]\s*\[[^\]]*\]\s*=\s*\{")
    for k, grp in enumerate(re.findall(r"\{([^{}]*)\}", fb)[:len(ASK_TOPICS)]):
        vals = [c_unstr(x) for x in re.findall(STR_RE, grp)]
        m["fallback"][k] = (vals + ["", "", ""])[:3]
    for mm in re.finditer(r"\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*" + STR_RE + r"\s*\}",
                          _block(cpp_text, r"const\s+AskLine\s+askLines\s*\[\s*\]\s*=\s*\{")):
        m["lines"].append({"char": int(mm.group(1)), "topic": int(mm.group(2)), "tier": int(mm.group(3)), "text": c_unstr(mm.group(4))})
    ro = _block(cpp_text, r"const\s+Romance\s+romance\s*\[[^\]]*\]\s*=\s*\{")
    for k, mm in enumerate(re.finditer(r"\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*(\d+)\s*\}\s*,?[ \t]*(?://[ \t]*\d+[ \t]+\S+(?:[ \t]+-[ \t]+(.*))?)?", ro)):
        if k < n_chars:
            m["romance"][k] = {"gender": int(mm.group(1)), "orient": int(mm.group(2)), "partner": int(mm.group(3)),
                               "crush": [int(x) for x in mm.group(4, 5, 6) if int(x) >= 0], "flags": int(mm.group(7)),
                               "note": (mm.group(8) or "").strip()}
    return m


def validate(m):
    errs = []
    for k, r in enumerate(m["rules"]):
        if not (r["reluctant"] <= r["happy"]):
            errs.append("тема %s: «неохотно» с %d, а «с удовольствием» с %d" % (ASK_TOPICS[k], r["reluctant"], r["happy"]))
    for t in [l["text"] for l in m["lines"]] + [x for f in m["fallback"] for x in f]:
        if len(t) > TEXT_MAX or any(ord(c) > 126 or ord(c) < 32 for c in t):
            errs.append("фраза: до %d символов, только ASCII: %s…" % (TEXT_MAX, t[:40]))
    for k, r in enumerate(m["romance"]):
        if len(r["crush"]) > 3:
            errs.append("персонаж %d: влюблён максимум в троих" % k)
    return errs


def generate(m, names):
    H = """#ifndef PERSONALITY_H
#define PERSONALITY_H

// Характеры персонажей: ответы на Ask about и романтические профили.
// personality.h / .cpp генерирует редактор: cfa-engine/editors/dialogue_editor, вкладка «Персонажи».
// Руками править можно, но в том же формате строк. Логика - social.cpp.

namespace Personality
{

// ---- Ask about (TALK -> Ask about, темы = listSubjects[10..14])
enum AskTopic { ASK_HOBBIES = 0, ASK_MUSIC, ASK_PLACES, ASK_MEALS, ASK_DREAMS, ASK_COUNT };
enum AskTier { ASK_REFUSE = 0, ASK_RELUCTANT, ASK_HAPPY, ASK_TIERS };
// Ярус по «отношениям» (relationLVLS + бонус группы, social.cpp): < reluctant - не хочет,
// < happy - неохотно, дальше - с удовольствием
struct AskRule { short reluctant, happy; };
struct AskLine { signed char charID, topic, tier; const char *text; };
extern const AskRule askRules[ ASK_COUNT ];
extern const AskLine askLines[];                           // до { -1, 0, 0, nullptr }
extern const char *const askFallback[ ASK_COUNT ][ ASK_TIERS ];   // если у персонажа своего ответа нет
const char *askLine( int charID, int topic, int tier, int pick );   // свой ответ или общий

// ---- Романтика (пока только данные)
enum Gender { GENDER_NONE = 0, BOY, GIRL };
enum Orientation { OR_NONE = 0, HETERO, HOMO, BI, ACE };
enum { PARTNER_NONE = -1, PARTNER_OUTSIDE = -2 };   // нет партнёра / занят кем-то не из игры
enum Flag {
"""
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
    C += ["};", "", "// [тема] = { не хочет, неохотно, с удовольствием }",
          "const char *const askFallback[ ASK_COUNT ][ ASK_TIERS ] = {"]
    for k, f in enumerate(m["fallback"]):
        C.append("\t{ %s },   // %s" % (", ".join(c_str(x) for x in f), ASK_TOPICS[k]))
    C += ["};", "", "// { charID, тема, ярус, ответ } - вариантов на клетку может быть несколько",
          "const AskLine askLines[] = {"]
    last = None
    for l in sorted(m["lines"], key=lambda l: (l["char"], l["topic"], l["tier"])):
        if not l["text"].strip():
            continue
        if l["char"] != last:
            C.append("\t// ---- %d %s" % (l["char"], names[l["char"]] if 0 <= l["char"] < len(names) else "?"))
            last = l["char"]
        C.append("\t{ %d, %d, %d, %s },   // %s / %s" % (l["char"], l["topic"], l["tier"], c_str(l["text"]),
                                                   ASK_TOPICS[l["topic"]], TIERS[l["tier"]]))
    C += ["\t{ -1, 0, 0, nullptr }", "};", "",
          "// { пол, ориентация, партнёр (charID / -1 нет / -2 не из игры), { влюблён в charID x3 }, флаги }",
          "const Romance romance[] = {"]
    for k, r in enumerate(m["romance"]):
        cr = (r["crush"] + [-1, -1, -1])[:3]
        body = "{ %d, %d, %d, { %d, %d, %d }, %d }," % (r["gender"], r["orient"], r["partner"], cr[0], cr[1], cr[2], r["flags"])
        nm = names[k] if k < len(names) else "?"
        C.append("\t%-38s// %d %s%s" % (body, k, nm.replace(" ", "_"), (" - " + r["note"]) if r.get("note") else ""))
    C += ["};", "",
          "const char *askLine( int charID, int topic, int tier, int pick )", "{",
          "\tif( topic < 0 || topic >= ASK_COUNT || tier < 0 || tier >= ASK_TIERS ) { return \"...\"; }",
          "\tint n = 0;",
          "\tfor( const AskLine *l = askLines; l->text; l++ ) { if( l->charID == charID && l->topic == topic && l->tier == tier ) { n++; } }",
          "\tif( n ) {",
          "\t\tif( pick < 0 ) { pick = -pick; }",
          "\t\tpick %= n;",
          "\t\tfor( const AskLine *l = askLines; l->text; l++ ) {",
          "\t\t\tif( l->charID == charID && l->topic == topic && l->tier == tier && pick-- == 0 ) { return l->text; }",
          "\t\t}",
          "\t}",
          "\treturn askFallback[ topic ][ tier ];", "}", "",
          "}", ""]
    return H, "\n".join(C)
