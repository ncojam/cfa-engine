"""
Graveblood dialogue editor — parser / writer for dialogues.cpp + dialogues.h

Only the parts that hold dialogue data are rewritten:
  * const Dialogues dMMM_NNN[] = { ... };      (dialogue arrays)
  * const Dialogues* dMMM[N] = { ... };        (per-mission pointer arrays)
  * const Dialogues* const* dPointers[N] = {}; (mission table)
  * matching extern lines in dialogues.h
Everything else (interacts, reacts, comments between arrays) is kept byte-for-byte.
Unchanged phrases inside a changed array are also kept verbatim (raw text).
"""
import re

FIELDS = ["name", "text", "iconLocation", "icon", "who", "diaCOND9",
          "answer0", "diaCOND0", "answer1", "chkCOND1", "equCOND1", "diaCOND1",
          "answer2", "chkCOND2", "equCOND2", "diaCOND2"]
STR_IDX = {0, 1, 6, 8, 12}
STR_LIMITS = {0: 27, 1: 108, 6: 33, 8: 33, 12: 33}  # char[] sizes incl. '\0'


# ---------------------------------------------------------------- lexing helpers

def mask_comments_strings(src):
    """Return list of (start, end, kind) for comments and string/char literals."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            if j > i and src[j - 1] == '\r':
                j -= 1
            out.append((i, j, 'lc'))
            i = j
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append((i, j, 'bc'))
            i = j
        elif c == '"' or c == "'":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 1
                elif src[j] == '\n':
                    break
                j += 1
            out.append((i, j + 1, 's'))
            i = j + 1
        else:
            i += 1
    return out


class Masked:
    def __init__(self, src):
        self.src = src
        self.ranges = mask_comments_strings(src)
        self.starts = [r[0] for r in self.ranges]

    def inside(self, pos):
        import bisect
        k = bisect.bisect_right(self.starts, pos) - 1
        return k >= 0 and self.ranges[k][0] <= pos < self.ranges[k][1]

    def skip_at(self, pos):
        """If pos is the start of a comment/string, return its end, else None."""
        import bisect
        k = bisect.bisect_left(self.starts, pos)
        if k < len(self.ranges) and self.ranges[k][0] == pos:
            return self.ranges[k][1]
        return None

    def match_brace(self, open_pos):
        depth = 0
        i, n = open_pos, len(self.src)
        while i < n:
            e = self.skip_at(i)
            if e is not None:
                i = e
                continue
            c = self.src[i]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return i
            i += 1
        raise ValueError("unbalanced braces at %d" % open_pos)

    def finditer(self, pattern):
        for m in re.finditer(pattern, self.src):
            if not self.inside(m.start()):
                yield m


def c_unescape(body):
    out, i = [], 0
    simple = {'n': '\n', 't': '\t', 'r': '\r', '\\': '\\', '"': '"', "'": "'", '0': '\0', 'a': '\a'}
    while i < len(body):
        c = body[i]
        if c == '\\' and i + 1 < len(body):
            d = body[i + 1]
            if d == 'x':
                m = re.match(r'[0-9a-fA-F]+', body[i + 2:])
                if m:
                    out.append(chr(int(m.group(0), 16)))
                    i += 2 + len(m.group(0))
                    continue
            out.append(simple.get(d, d))
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def c_escape(s):
    return (s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
             .replace('\t', '\\t').replace('\r', '\\r'))


def parse_value(chunk):
    t = chunk.strip()
    if not t:
        return None
    if t.startswith('"'):
        parts = re.findall(r'"((?:[^"\\]|\\.)*)"', t)
        return ''.join(c_unescape(p) for p in parts)
    if re.fullmatch(r'[-+]?\s*(0[xX][0-9a-fA-F]+|\d+)', t):
        return int(t.replace(' ', ''), 0)
    return {"expr": t}


def split_values(src, start, end, with_pos=False):
    """Split src[start:end] (contents of a {...} without the braces) into values and comments.
    Returns (values, notes) or (values, notes, positions) where positions[i] = (field index the
    comment follows, -1 = before the first field; inline flag)."""
    m = Masked(src[start:end])
    s = m.src
    values, notes, pos = [], [], []
    cur, i = [], 0
    last_nl = True  # only whitespace/newline since the previous token
    while i < len(s):
        e = m.skip_at(i)
        if e is not None:
            seg = s[i:e]
            if seg.startswith('//') or seg.startswith('/*'):
                notes.append(seg.rstrip())
                started = ''.join(cur).strip() != ''
                pos.append((len(values) if started else len(values) - 1, not last_nl))
            else:
                cur.append(seg)
                last_nl = False
            i = e
            continue
        c = s[i]
        if c == ',':
            values.append(parse_value(''.join(cur)))
            cur = []
            last_nl = False
        else:
            cur.append(c)
            if c == '\n':
                last_nl = True
            elif not c.isspace():
                last_nl = False
        i += 1
    last = parse_value(''.join(cur))
    if last is not None:
        values.append(last)
    if with_pos:
        return values, notes, pos
    return values, notes


# ---------------------------------------------------------------- parsing

def default_fields():
    return ["" if i in STR_IDX else 0 for i in range(len(FIELDS))]


def parse_array_body(src, ob, cb, m=None):
    """Parse phrases between braces ob..cb (positions of '{' and '}')."""
    m = m or Masked(src)
    phrases, pending_notes = [], []
    i = ob + 1
    while i < cb:
        e = m.skip_at(i)
        if e is not None:
            seg = src[i:e]
            if seg.startswith('//') or seg.startswith('/*'):
                pending_notes.append(seg.rstrip())
            i = e
            continue
        c = src[i]
        if c == '{':
            close = m.match_brace(i)
            vals, notes, npos = split_values(src, i + 1, close, True)
            f = default_fields()
            for k, v in enumerate(vals[:len(FIELDS)]):
                if v is not None:
                    f[k] = v
            phrases.append({
                "f": f,
                "n": len(vals),
                "lead": pending_notes,
                "notes": notes,
                "notePos": npos,
                "raw": src[i:close + 1],
            })
            pending_notes = []
            i = close + 1
            continue
        i += 1
    return phrases, pending_notes


def parse_cpp(src):
    m = Masked(src)
    arrays = {}
    order = []
    for mt in m.finditer(r'const\s+Dialogues\s+(d\d{3}_\d{3}\w*)\s*\[\s*\]\s*='):
        name = mt.group(1)
        ob = src.index('{', mt.end())
        # title comment between '=' and '{'
        between = src[mt.end():ob]
        tm = re.search(r'//(.*)', between)
        title = tm.group(1).strip() if tm else ""
        cb = m.match_brace(ob)
        semi = src.index(';', cb)
        phrases, trailing = parse_array_body(src, ob, cb, m)
        arrays[name] = {
            "name": name, "title": title, "phrases": phrases, "trailing": trailing,
            "span": [mt.start(), semi + 1],
        }
        order.append(name)

    missions = {}
    for mt in m.finditer(r'const\s+Dialogues\s*\*\s*(d\d{3})\s*\[\s*(\d+)\s*\]\s*='):
        name = mt.group(1)
        ob = src.index('{', mt.end())
        cb = m.match_brace(ob)
        semi = src.index(';', cb)
        body = src[ob + 1:cb]
        tm = re.match(r'[ \t]*//([^\r\n]*)', body)
        title = tm.group(1).strip() if tm else ""
        bm = Masked(body)
        clean = ''.join(ch if not bm.inside(k) else ' ' for k, ch in enumerate(body))
        items = [x.strip() for x in clean.split(',') if x.strip()]
        items = [x for x in items if x != 'nullptr' and x != '0' and x != 'NULL']
        missions[name] = {"name": name, "size": int(mt.group(2)), "title": title,
                          "items": items, "span": [mt.start(), semi + 1],
                          "raw": src[mt.start():semi + 1]}

    dp = None
    for mt in m.finditer(r'const\s+Dialogues\s*\*\s*const\s*\*\s*dPointers\s*\[\s*(\d+)\s*\]\s*='):
        ob = src.index('{', mt.end())
        cb = m.match_brace(ob)
        semi = src.index(';', cb)
        body = src[ob + 1:cb]
        bm = Masked(body)
        clean = ''.join(ch if not bm.inside(k) else ' ' for k, ch in enumerate(body))
        items = [x.strip() for x in clean.split(',') if x.strip()]
        items = [x for x in items if x not in ('nullptr', '0', 'NULL')]
        dp = {"size": int(mt.group(1)), "items": items, "span": [mt.start(), semi + 1]}
        break
    return arrays, order, missions, dp


def load_model(cpp_src):
    arrays, order, missions, dp = parse_cpp(cpp_src)
    used = set()
    out_missions = []
    mission_names = dp["items"] if dp else sorted(missions)
    for idx, mname in enumerate(mission_names):
        mi = missions.get(mname)
        if not mi:
            out_missions.append({"name": mname, "index": idx, "title": "(missing)", "dialogues": []})
            continue
        dl = []
        for di, aname in enumerate(mi["items"]):
            a = arrays.get(aname)
            used.add(aname)
            if not a:
                dl.append({"name": aname, "index": di, "missing": True, "title": "", "phrases": [], "trailing": []})
                continue
            dl.append(public_array(a, di))
        out_missions.append({"name": mname, "index": idx, "title": mi["title"], "dialogues": dl})
    orphans = [public_array(arrays[a], -1) for a in order if a not in used]
    return {"missions": out_missions, "orphans": orphans}


def public_array(a, idx):
    return {"name": a["name"], "index": idx, "title": a["title"],
            "phrases": [{"f": p["f"], "n": p["n"], "lead": p["lead"], "notes": p["notes"], "notePos": p["notePos"], "raw": p["raw"]}
                        for p in a["phrases"]],
            "trailing": a["trailing"]}


# ---------------------------------------------------------------- writing

def fmt_val(i, v):
    if isinstance(v, dict):
        return v["expr"]
    if i in STR_IDX:
        return '"' + c_escape(v if isinstance(v, str) else str(v)) + '"'
    return str(int(v))


def is_default(i, v):
    if isinstance(v, dict):
        return False
    return v == "" if i in STR_IDX else v == 0


def phrase_kind(f):
    op = f[2]
    if isinstance(op, dict):
        return "text"
    if op == -18:
        return "choice"
    if op >= 0 or op in (-14, -26):
        return "text"
    return "action"


def emit_phrase(p, nl):
    f = p["f"]
    # unchanged -> keep verbatim
    raw = p.get("raw")
    if raw:
        try:
            ob, cb = 0, len(raw) - 1
            vals, notes = split_values(raw, ob + 1, cb)
            g = default_fields()
            for k, v in enumerate(vals[:len(FIELDS)]):
                if v is not None:
                    g[k] = v
            if g == f and notes == (p.get("notes") or []):
                return raw
        except Exception:
            pass
    kind = phrase_kind(f)
    last = 0
    for i in range(len(FIELDS)):
        if not is_default(i, f[i]):
            last = i
    base = p.get("n") or (16 if kind == "choice" else 5 if kind == "text" else 4)
    n = min(len(FIELDS), max(last + 1, base, 3 if kind == "action" else 16 if kind == "choice" else 4))
    vals = [fmt_val(i, f[i]) for i in range(n)]
    notes = p.get("notes", []) or []
    npos = p.get("notePos")
    if not npos or len(npos) != len(notes):
        npos = [(10 ** 6, False)] * len(notes)
    # group values into lines: list of lists of field indices
    if kind == "action":
        groups = [list(range(n))]
    elif kind == "choice" and not any(8 <= q < 10 ** 6 for q, _ in npos):
        groups = [[j] for j in range(8)] + [list(range(8, n))]
    else:
        groups = [[j] for j in range(n)]
    inner = []
    for (np_, inl), txt in zip(npos, notes):
        if np_ < 0:
            inner.append("\t\t" + txt.strip())
    for g in groups:
        line = "\t\t" + ",".join(vals[j] for j in g) + ("," if g[-1] < n - 1 else "")
        own = []
        for (np_, inl), txt in zip(npos, notes):
            if np_ in g or (g is groups[-1] and np_ >= n):
                if inl and np_ == g[-1] and np_ < n:
                    line += txt.strip()
                else:
                    own.append("\t\t" + txt.strip())
            elif g is groups[-1] and np_ >= n:
                pass
        inner.append(line)
        inner.extend(own)
    return "{" + nl + nl.join(inner) + nl + "\t}"


def emit_array(a, nl):
    head = "const Dialogues %s[] =" % a["name"]
    if a.get("title"):
        head += " //" + a["title"]
    lines = [head, "{"]
    ph = a["phrases"]
    for k, p in enumerate(ph):
        for note in p.get("lead", []):
            lines.append("\t" + note.strip())
        body = emit_phrase(p, nl)
        lines.append("\t" + body + ("," if k < len(ph) - 1 else ""))
    for note in a.get("trailing", []):
        lines.append("\t" + note.strip())
    lines.append("};")
    return nl.join(lines)


def emit_mission(name, title, items, nl):
    head = "const Dialogues* %s[%d] = {" % (name, len(items) + 1)
    if title:
        head += " //" + title
    return head + nl + "\t" + ", ".join(items + ["nullptr"]) + nl + "};"


def emit_dpointers(items, nl):
    return ("const Dialogues* const* dPointers[%d] = {" % (len(items) + 1) + nl +
            "\t" + ", ".join(items + ["nullptr"]) + nl + "};")


def save_model(cpp_src, h_src, model):
    """model: same shape as load_model output (missions[].dialogues[].phrases[].f/raw/notes/lead)."""
    nl = "\r\n" if "\r\n" in cpp_src else "\n"
    arrays, order, missions, dp = parse_cpp(cpp_src)
    edits = []  # (start, end, text)
    insert_after = {}  # array name -> list of new array texts
    new_tail = []  # arrays for brand-new missions (inserted after last array)

    wanted_arrays = {}
    for mi in model["missions"]:
        for d in mi["dialogues"]:
            if d.get("missing"):
                continue
            wanted_arrays[d["name"]] = (mi, d)

    # existing arrays: changed?
    for name, (mi, d) in wanted_arrays.items():
        txt = emit_array(d, nl)
        if name in arrays:
            a = arrays[name]
            s, e = a["span"]
            orig = cpp_src[s:e]
            # compare semantic content; keep the original if nothing changed
            same = (d.get("title", "") == a["title"] and
                    len(d["phrases"]) == len(a["phrases"]) and
                    all(p["f"] == q["f"] and p.get("notes", []) == q["notes"] and p.get("lead", []) == q["lead"]
                        for p, q in zip(d["phrases"], a["phrases"])) and
                    d.get("trailing", []) == a["trailing"])
            if not same:
                edits.append((s, e, txt))
        else:
            # new array: after the last existing array of the same mission, else at tail
            mname = mi["name"]
            prev = None
            for other in order:
                if other.startswith(mname + "_"):
                    prev = other
            if prev is None:
                prev_m = [o for o in order if o < mname + "_"]
                prev = prev_m[-1] if prev_m else (order[-1] if order else None)
            insert_after.setdefault(prev, []).append(txt)

    # removed arrays (only those that belonged to a mission and are gone from the model)
    for name, a in arrays.items():
        if name not in wanted_arrays:
            in_mission = any(name in m["items"] for m in missions.values())
            if in_mission:
                s, e = a["span"]
                # eat following newline
                while e < len(cpp_src) and cpp_src[e] in "\r\n":
                    e += 1
                    if cpp_src[e - 1] == "\n":
                        break
                edits.append((s, e, ""))

    for prev, texts in insert_after.items():
        if prev is None:
            continue
        s, e = arrays[prev]["span"]
        edits.append((e, e, "".join(nl + nl + t for t in texts)))

    # mission pointer arrays
    new_missions_text = []
    for mi in model["missions"]:
        items = [d["name"] for d in mi["dialogues"]]
        name = mi["name"]
        if name in missions:
            om = missions[name]
            if om["items"] != items or om["title"] != mi.get("title", "") or om["size"] != len(items) + 1:
                s, e = om["span"]
                edits.append((s, e, emit_mission(name, mi.get("title", ""), items, nl)))
        else:
            new_missions_text.append(emit_mission(name, mi.get("title", ""), items, nl))

    mnames = [mi["name"] for mi in model["missions"]]
    if dp is not None:
        if dp["items"] != mnames or dp["size"] != len(mnames) + 1:
            s, e = dp["span"]
            edits.append((s, e, emit_dpointers(mnames, nl)))
    if new_missions_text:
        last_m = max((m["span"][1] for m in missions.values()), default=None)
        if last_m is None:
            last_m = len(cpp_src)
        edits.append((last_m, last_m, "".join(nl + t for t in new_missions_text)))

    out = apply_edits(cpp_src, edits)
    h_out = update_header(h_src, model, nl if "\r\n" in h_src or nl == "\n" else nl)
    return out, h_out


def apply_edits(src, edits):
    # sort descending by start; inserts at same position keep order
    edits = sorted(enumerate(edits), key=lambda x: (x[1][0], x[0]), reverse=True)
    for _, (s, e, t) in edits:
        src = src[:s] + t + src[e:]
    return src


def update_header(h_src, model, nl):
    nl = "\r\n" if "\r\n" in h_src else "\n"
    m = Masked(h_src)
    sizes = {mi["name"]: len(mi["dialogues"]) + 1 for mi in model["missions"]}
    seen = set()
    edits = []
    last_end = None
    for mt in m.finditer(r'extern\s+const\s+Dialogues\s*\*\s*(d\d{3})\s*\[\s*(\d+)\s*\]\s*;'):
        name = mt.group(1)
        seen.add(name)
        last_end = mt.end()
        if name in sizes and int(mt.group(2)) != sizes[name]:
            edits.append((mt.start(), mt.end(), "extern const Dialogues* %s[%d];" % (name, sizes[name])))
        elif name not in sizes:
            # mission removed -> drop the extern line
            ls = h_src.rfind("\n", 0, mt.start()) + 1
            le = h_src.find("\n", mt.end())
            le = len(h_src) if le < 0 else le + 1
            edits.append((ls, le, ""))
    new = [n for n in sizes if n not in seen]
    if new and last_end is not None:
        edits.append((last_end, last_end, "".join(nl + "extern const Dialogues* %s[%d];" % (n, sizes[n]) for n in new)))
    for mt in m.finditer(r'extern\s+const\s+Dialogues\s*\*\s*const\s*\*\s*dPointers\s*\[\s*(\d+)\s*\]\s*;'):
        want = len(model["missions"]) + 1
        if int(mt.group(1)) != want:
            edits.append((mt.start(), mt.end(), "extern const Dialogues* const* dPointers[%d];" % want))
        break
    return apply_edits(h_src, edits)


# ---------------------------------------------------------------- characters

def parse_characters(persons_src):
    """charID -> name from dataPointers[] + data_X[] in persons.cpp"""
    m = re.search(r'dataPointers\s*\[[^\]]*\]\s*=\s*\{(.*?)\};', persons_src, re.S)
    if not m:
        return []
    body = re.sub(r'//[^\n]*|/\*.*?\*/', '', m.group(1), flags=re.S)
    ids = [x.strip() for x in body.split(',') if x.strip() and x.strip() != 'nullptr']
    names = []
    for ident in ids:
        mm = re.search(r'const\s+charData\s+' + re.escape(ident) + r'\s*\[\s*\]\s*=\s*\{\s*"([^"]*)"', persons_src)
        names.append(mm.group(1) if mm else ident.replace('data_', ''))
    return names
