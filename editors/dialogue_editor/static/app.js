/* Graveblood — dialogue editor (vanilla JS, no build step) */
'use strict';

// ============================================================ constants
const F = { name:0, text:1, op:2, icon:3, who:4, c9:5, a0:6, c0:7, a1:8, chk1:9, equ1:10, c1:11, a2:12, chk2:13, equ2:14, c2:15 };
const FIELD_NAMES = ["name","text","iconLocation","icon","who","diaCOND9","answer0","diaCOND0","answer1","chkCOND1","equCOND1","diaCOND1","answer2","chkCOND2","equCOND2","diaCOND2"];
const STR_IDX = new Set([0,1,6,8,12]);
const LIMITS = {0:27, 1:108, 6:33, 8:33, 12:33};           // char[] sizes, '\0' included
const STATS = ["Kindness","Humor","Charisma","Allure","SelfEsteem","Intellect","Sanity","Behaviour"];
const DEFAULT_CHARS = ["Vika","Lidia","Arthur","Karina","Katya","Misha","Principal","Nina","Classmaster","Vova","Augustina","Maxim","Artyom","Edd","Marina","Andrey","Yana","Liza","Dima","Anya","Grisha","Natasha","Masha","Mom","Dad","Kostya","Lyuda","Dina","Ruslana","Polina","Darina","Veronika","Carolina","Serega","Vlad","Kyrill","Hobo","Shibainu","Stas","Witch"];
// Guessed from how the numbers are used in the existing lines — rename them in ⚙ Settings.
// Названия по тому, что реально нарисовано (у Вики эмоций 7: 0..6).
const DEFAULT_EMOTIONS = ["воодушевлённо","нейтрально / лёгкая улыбка","говорит / указывает","смущение / стыд","влюблённость","meh / не очень","злость","ухмылка","испуг","тревога","серьёзно","восторг","грусть","расстроен"];

// Display kinds (iconLocation of phrases that show text)
const TEXT_KINDS = { 0:"Реплика", "-14":"Подсказка (−14)", "-26":"Авто-реплика (−26)" };

// Actions. p: params {f: field index, t: type, l: label, off: ref offset, start: allow "−1 = с начала"}
// Ref offset: the engine does phrase = X and then phrase++ → real target = X+1 (off:1).
//             Choices (−18) jump exactly to X (off:0).
const OPS = {
  "-1":  {n:"Конец диалога", g:"Поток", k:"end", p:[{f:3,t:"ref",off:1,start:true,l:"в след. раз начать с"}]},
  "-21": {n:"Перейти к фразе", g:"Поток", k:"jump", p:[{f:3,t:"ref",off:1,l:"перейти к"}]},
  "-37": {n:"Если globalCondition ≥ N → переход", g:"Условия", k:"jump", p:[{f:3,t:"int",l:"N"},{f:4,t:"ref",off:1,l:"тогда к"}]},
  "-22": {n:"Если отношения ≥ N → переход", g:"Условия", k:"jump", p:[{f:3,t:"char",l:"с кем"},{f:4,t:"int",l:"мин. уровень (−1 → режим ≤)"},{f:7,t:"int",l:"макс. уровень (если −1)"},{f:5,t:"ref",off:1,l:"тогда к"}]},
  "-28": {n:"Если info[i] == 1 → переход", g:"Условия", k:"jump", p:[{f:3,t:"int",l:"режим (0)"},{f:4,t:"int",l:"ячейка info i"},{f:5,t:"ref",off:1,l:"тогда к"}]},
  "-35": {n:"Если info[i] == v → переход", g:"Условия", k:"jump", p:[{f:3,t:"int",l:"ячейка i"},{f:4,t:"int",l:"значение v"},{f:5,t:"ref",off:1,l:"тогда к"}]},
  "-19": {n:"Отнять деньги (не хватает → переход)", g:"Условия", k:"jump", p:[{f:3,t:"int",l:"сумма"},{f:4,t:"ref",off:1,l:"если не хватает → к"}]},
  "-6":  {n:"Проверка commonConditions[i]", g:"Условия", k:"jump", p:[{f:3,t:"int",l:"индекс условия"}], hint:"Переход берётся из таблицы commonConditions — редактор его не пересчитывает."},
  "-7":  {n:"globalCondition +1", g:"Состояние", p:[{f:3,t:"int",l:"1 = clearSpecialCall (диалог игрока)"}]},
  "-11": {n:"globalCondition = N (если меньше)", g:"Состояние", p:[{f:3,t:"int",l:"N"}]},
  "-27": {n:"Сбросить GC при смене уровня", g:"Состояние", p:[]},
  "-33": {n:"info[i] = v", g:"Состояние", p:[{f:3,t:"int",l:"ячейка i"},{f:4,t:"int",l:"значение v"}]},
  "-36": {n:"Очистить info[]", g:"Состояние", p:[]},
  "-39": {n:"Стадия катсцены (cutSceneStage)", g:"Состояние", p:[{f:3,t:"int",l:"стадия"}], hint:"Работает в диалогах, которые ведёт игрок (playerDialogue)."},
  "-20": {n:"Изменить характеристику / отношения", g:"Персонажи", p:[{f:3,t:"stat",l:"что"},{f:4,t:"int",l:"на сколько (±)"}]},
  "-15": {n:"Добавить в друзья", g:"Персонажи", p:[{f:3,t:"char",l:"кого"}]},
  "-17": {n:"Особый звонок (specialDIAL)", g:"Персонажи", p:[{f:3,t:"char",l:"персонаж"},{f:4,t:"int",l:"№ диалога"}]},
  "-2":  {n:"Дать основной квест", g:"Квесты и деньги", p:[{f:3,t:"int",l:"questSlotMain ="}]},
  "-3":  {n:"Дать доп. квест", g:"Квесты и деньги", p:[{f:3,t:"int",l:"№ квеста"}], hint:"Движок делает ещё phrase++ — следующая фраза будет пропущена."},
  "-4":  {n:"Прогресс основного квеста", g:"Квесты и деньги", p:[{f:3,t:"int",l:"questProgressMain ="}]},
  "-30": {n:"Добавить деньги", g:"Квесты и деньги", p:[{f:3,t:"int",l:"сумма"}]},
  "-9":  {n:"Следующая миссия (curMission+1)", g:"Мир", p:[]},
  "-24": {n:"Сменить уровень", g:"Мир", k:"end", p:[{f:3,t:"int",l:"уровень (port2)"},{f:4,t:"int",l:"дверь X, клетка (−1 не менять)"},{f:5,t:"int",l:"дверь Y, клетка (−1 не менять)"},{f:7,t:"int",l:"0 = +1 миссия, иначе нет"}]},
  "-25": {n:"Сменить цель", g:"Мир", p:[{f:3,t:"int",l:"2 = nextTarget, иначе targetP++"}]},
  "-32": {n:"Показать СМС", g:"Мир", p:[{f:3,t:"int",l:"таймер"},{f:4,t:"int",l:"id СМС"}]},
  "-12": {n:"Показать меню / приглашение", g:"Мир", p:[{f:3,t:"int",l:"id меню (−1 закрыть)"}]},
  "-23": {n:"Показать картинку", g:"Мир", p:[{f:3,t:"int",l:"id меню (−1 закрыть)"},{f:4,t:"int",l:"id картинки"}]},
  "-5":  {n:"Сместить камеру", g:"NPC и камера", p:[{f:3,t:"int",l:"X"},{f:4,t:"int",l:"Y"}]},
  "-8":  {n:"Сменить state NPC и выйти", g:"NPC и камера", k:"end", p:[{f:3,t:"int",l:"state"},{f:4,t:"int",l:"wayPoint (если state = 3)"}]},
  "-34": {n:"Сменить state и wayPoint++", g:"NPC и камера", k:"end", p:[{f:3,t:"int",l:"state"}]},
  "-10": {n:"NPC уходит (за карту)", g:"NPC и камера", k:"end", p:[]},
  "-13": {n:"Повернуть NPC", g:"NPC и камера", p:[{f:3,t:"int",l:"turn (0/1)"}]},
  "-16": {n:"Сменить legsColor", g:"NPC и камера", p:[{f:3,t:"int",l:"значение"},{f:4,t:"int",l:"1 = и standSprt"}]},
  "-29": {n:"Сделать целью (hp = 5)", g:"NPC и камера", p:[]},
  "-38": {n:"Вернуть управление после падения", g:"NPC и камера", p:[]},
  "-31": {n:"Пропуск (хранит число)", g:"Прочее", p:[{f:3,t:"int",l:"число"},{f:4,t:"int",l:"доп."}]},
};
const OP_GROUPS = ["Поток","Условия","Состояние","Персонажи","Квесты и деньги","Мир","NPC и камера","Прочее"];
const ENDING_OPS = new Set([-1,-8,-10,-24,-34]);

// ============================================================ state
const S = {
  missions: [], orphans: [], chars: DEFAULT_CHARS.slice(), portraits: {}, meta: {dialogues:{}, emotions:{}},
  hash: null, paths: {}, cur: null, open: new Set(), filter: 'all', search: '',
  undo: [], redo: [], dirty: new Set(), structDirty: false, pendingUndo: false, uid: 1,
  settings: { buf1Check: false, compact: false, preview: 2 },
};
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const store = {
  get(k, d) { try { const v = localStorage.getItem('gbde.'+k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gbde.'+k, JSON.stringify(v)); } catch {} },
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const pad3 = n => String(n).padStart(3, '0');
const num = v => (typeof v === 'number' ? v : 0);
const clone = o => JSON.parse(JSON.stringify(o));
function toast(msg, cls='') {
  const t = h('div', {class:'toast '+cls}, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), cls === 'err' ? 7000 : 3200);
}

// ============================================================ phrase helpers
function kindOf(p) {
  const op = p.f[F.op];
  if (typeof op !== 'number') return 'text';
  if (op === -18) return 'choice';
  if (op >= 0 || op === -14 || op === -26) return 'text';
  return 'action';
}
function cardClass(p) {
  const op = p.f[F.op], k = kindOf(p);
  if (k === 'choice') return 'k-choice';
  if (k === 'text') return op === -14 ? 'k-tip' : op === -26 ? 'k-auto' : 'k-text';
  const d = OPS[op];
  if (d && d.k === 'end') return 'k-end';
  if (d && d.k === 'jump') return 'k-jump';
  return 'k-action';
}
function refSpecs(p) {
  const op = p.f[F.op];
  if (op === -18) {
    const r = [{f:F.c9, off:0}, {f:F.c0, off:0}];
    if (p.f[F.chk1] !== -2) r.push({f:F.c1, off:0});
    if (p.f[F.chk2] !== -2) r.push({f:F.c2, off:0});
    return r;
  }
  const d = OPS[op];
  if (!d) return [];
  return d.p.filter(x => x.t === 'ref').map(x => ({f:x.f, off:x.off, start:!!x.start}));
}
function initRefsFor(D, p) {
  p.refs = {};
  for (const s of refSpecs(p)) {
    const v = p.f[s.f];
    if (typeof v !== 'number') { p.refs[s.f] = null; continue; }
    if (s.start && v === -1) { p.refs[s.f] = 'START'; continue; }
    const t = v + s.off;
    p.refs[s.f] = (t >= 0 && t < D.phrases.length) ? D.phrases[t].uid : null;
  }
}
function materialize(D) {
  const idx = new Map(D.phrases.map((p, i) => [p.uid, i]));
  for (const p of D.phrases) {
    for (const s of refSpecs(p)) {
      const r = p.refs && p.refs[s.f];
      if (r === 'START') p.f[s.f] = -1;
      else if (r != null && idx.has(r)) p.f[s.f] = idx.get(r) - s.off;
    }
  }
}
function newPhrase(f) {
  const base = ["","",0,0,0,0,"",0,"",0,0,0,"",0,0,0];
  f.forEach((v, i) => base[i] = v);
  return { uid: S.uid++, f: base, notes: [], lead: [], raw: null, refs: {} };
}
function phraseLabel(D, i) {
  const p = D.phrases[i];
  if (!p) return '—';
  const k = kindOf(p), f = p.f;
  let s;
  if (k === 'text') s = (f[F.op] === -14 ? '💡 ' : f[F.op] === -26 ? '⏱ ' : '') + (f[F.name] ? f[F.name] + ': ' : '') + f[F.text];
  else if (k === 'choice') s = '☰ ' + (f[F.name] || 'выбор') + ': ' + [f[F.text], f[F.a0]].filter(Boolean).join(' / ');
  else { const d = OPS[f[F.op]]; s = '⚙ ' + (d ? d.n : 'op ' + f[F.op]); }
  if (s.length > 64) s = s.slice(0, 62) + '…';
  return '#' + String(i).padStart(2, '0') + '  ' + s;
}

// ============================================================ characters / portraits
function charName(cid) { return S.chars[cid] || ('char' + pad3(cid).slice(1)); }
function guessNpc(D) {
  const names = S.chars.map(n => n.toLowerCase());
  for (const p of D.phrases) {
    if (kindOf(p) !== 'text' || p.f[F.who] !== -1) continue;
    const nm = String(p.f[F.name]).toLowerCase().trim();
    if (!nm) continue;
    for (let c = 1; c < names.length; c++) {
      if (nm === names[c] || nm.startsWith(names[c] + ' ') || nm.startsWith(names[c] + '(')) return c;
    }
  }
  return null;
}
function npcOf(D) {
  const m = S.meta.dialogues[D.name];
  if (m && m.npc != null && m.npc !== '') return +m.npc;
  return guessNpc(D);
}
function portraitChar(D, p) {
  const who = p.f[F.who];
  if (who === 0) return 0;
  if (who === -1) return npcOf(D);
  return typeof who === 'number' ? who : null;
}
function emotionName(i) { return (S.meta.emotions && S.meta.emotions[i]) || DEFAULT_EMOTIONS[i] || ('эмоция ' + i); }
function emotionCount(cid) { return S.portraits[cid] || 0; }
function portraitEl(cid, emo, opts={}) {
  const wrap = h('div', {class:'portrait', title: opts.title || ''});
  if (cid != null && emotionCount(cid) > emo && emo >= 0) {
    const img = h('img', {src:`/api/portrait/${cid}/${emo}.png`, alt:''});
    img.onerror = () => { img.remove(); wrap.prepend(phEl()); };
    wrap.append(img);
  } else wrap.append(phEl());
  function phEl() {
    return h('div', {class:'ph'}, h('b', null, cid == null ? '?' : (charName(cid)[0] || '?')),
      cid == null ? 'NPC не задан' : charName(cid));
  }
  if (opts.label !== false) wrap.append(h('div', {class:'emo'}, emo + ' · ' + emotionName(emo)));
  if (opts.onclick) wrap.addEventListener('click', opts.onclick);
  return wrap;
}

// ============================================================ load / save
async function api(path, body) {
  const r = await fetch(path, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
  return j;
}
function ingest(model) {
  const prep = d => {
    const D = { name:d.name, title:d.title || '', index:d.index, trailing:d.trailing || [], missing: !!d.missing,
      phrases: d.phrases.map(p => ({ uid:S.uid++, f:p.f.slice(), notes:p.notes || [], notePos:p.notePos || null, lead:p.lead || [], raw:p.raw, refs:{} })) };
    D.phrases.forEach(p => initRefsFor(D, p));
    return D;
  };
  S.missions = model.missions.map(m => ({ name:m.name, title:m.title || '', dialogues: m.dialogues.map(prep) }));
  S.orphans = (model.orphans || []).map(prep);
}
async function loadAll(keepPos=true) {
  const j = await api('/api/load');
  ingest(j.model);
  S.hash = j.hash; S.paths = j.paths;
  if (j.characters && j.characters.length) S.chars = j.characters;
  S.portraits = {}; for (const [k, v] of Object.entries(j.portraits || {})) S.portraits[+k] = v;
  S.order = j.order || [];
  S.meta = j.meta || {}; S.meta.dialogues = S.meta.dialogues || {}; S.meta.emotions = S.meta.emotions || {};
  GBA.setFont(j.font); GBA.setColors(S.meta.gbaColors);
  if (!j.font) toast('sys8.font.h не найден — превью баблов без текста', 'err');
  S.undo = []; S.redo = []; S.dirty.clear(); S.structDirty = false;
  const want = keepPos && (S.cur ? S.cur.name : decodeURIComponent(location.hash.slice(1)));
  S.cur = null;
  if (want) { const f = findDialogue(want); if (f) S.cur = f; }
  if (S.cur) S.open.add(S.cur.m.name);
  renderAll();
  if (!Object.keys(S.portraits).length) toast('Портреты не найдены (charNN.til.inc / charNN.pal.inc). Путь можно поменять: server.py --gfx DIR', '');
}
function buildPayload() {
  return { missions: S.missions.map(m => ({ name:m.name, title:m.title,
    dialogues: m.dialogues.map(D => { materialize(D); return { name:D.name, title:D.title, trailing:D.trailing, missing:D.missing,
      phrases: D.phrases.map(p => ({ f:p.f, notes:p.notes, notePos:p.notePos || null, lead:p.lead, raw:p.raw })) }; }) })) };
}
async function save(force=false) {
  const errs = collectIssues().filter(x => x.block);
  if (errs.length && !force) {
    if (!confirm(`Есть ${errs.length} ошибок (например: ${errs[0].D.name} #${errs[0].i}: ${errs[0].msg}).\nТакой файл не соберётся (строка длиннее массива). Всё равно сохранить?`)) return;
  }
  try {
    const j = await api('/api/save', { model: buildPayload(), hash: S.hash, force });
    S.hash = j.hash; S.dirty.clear(); S.structDirty = false;
    toast(j.changed ? 'Сохранено в dialogues.cpp / .h (бэкап в backups/)' : 'Изменений нет — файлы не тронуты', 'ok');
    renderTree(); updateTop();
  } catch (e) {
    if (e.status === 409) {
      if (confirm(e.message + '\n\nOK — перезаписать файлы на диске своими изменениями.\nОтмена — ничего не делать.')) return save(true);
    } else toast('Ошибка сохранения: ' + e.message, 'err');
  }
}
let metaTimer = null;
function saveMeta() {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => api('/api/meta', S.meta).catch(e => toast('meta: ' + e.message, 'err')), 300);
}
function dmeta(name) { return S.meta.dialogues[name] || (S.meta.dialogues[name] = {}); }

// ============================================================ navigation
function findDialogue(name) {
  for (const m of S.missions) { const di = m.dialogues.findIndex(d => d.name === name); if (di >= 0) return { m, D: m.dialogues[di], name, di }; }
  const oi = S.orphans.findIndex(d => d.name === name);
  if (oi >= 0) return { m: { name:'orphans', title:'Не подключены', dialogues:S.orphans }, D:S.orphans[oi], name, di:oi, orphan:true };
  return null;
}
function select(name, scrollTo) {
  const f = findDialogue(name);
  if (!f) return;
  S.cur = f; S.open.add(f.m.name);
  try { history.replaceState(null, '', '#' + name); } catch {}
  renderTree(); renderEditor();
  $('#main').scrollTop = 0;
  if (scrollTo != null) setTimeout(() => flashPhrase(scrollTo), 30);
  const row = $(`.d-row[data-name="${name}"]`); if (row) row.scrollIntoView({block:'nearest'});
}
// Миссии в порядке прохождения (src/mission_order.cpp → missionOrder[]).
// Индекс в S.missions = ID миссии (= curMission, индекс dPointers) и при
// сохранении не меняется; здесь меняется только порядок показа.
// Миссии, которых нет в missionOrder, идут в конце по ID (pos = -1).
function orderedMissions() {
  const order = S.order || [];
  const res = [], used = new Set();
  order.forEach(id => {
    if (id >= 0 && id < S.missions.length && !used.has(id)) { used.add(id); res.push({ m:S.missions[id], mi:id, pos:res.length }); }
  });
  S.missions.forEach((m, mi) => { if (!used.has(mi)) res.push({ m, mi, pos:-1 }); });
  return res;
}
function allDialogues() { return orderedMissions().flatMap(({ m }) => m.dialogues.map(D => ({ m, D }))); }
function stepDialogue(dir) {
  const list = visibleDialogues();
  if (!list.length) return;
  let i = S.cur ? list.findIndex(x => x.D.name === S.cur.name) : -1;
  i = Math.max(0, Math.min(list.length - 1, i + dir));
  select(list[i].D.name);
}

// ============================================================ undo
function snap() { const c = S.cur; return c ? { name:c.name, title:c.D.title, phrases:clone(c.D.phrases) } : null; }
function pushUndo() { const s = snap(); if (!s) return; S.undo.push(s); if (S.undo.length > 300) S.undo.shift(); S.redo = []; }
function markDirty() { if (S.cur) S.dirty.add(S.cur.name); updateTop(); updateTreeRow(S.cur && S.cur.name); }
function restore(s, stackTo) {
  const f = findDialogue(s.name); if (!f) return;
  if (!S.cur || S.cur.name !== s.name) { S.cur = f; S.open.add(f.m.name); }
  stackTo.push({ name:s.name, title:f.D.title, phrases:clone(f.D.phrases) });
  f.D.phrases = s.phrases; f.D.title = s.title;
  S.dirty.add(s.name);
  renderTree(); renderEditor(); updateTop();
}
function undo() { const s = S.undo.pop(); if (s) restore(s, S.redo); }
function redo() { const s = S.redo.pop(); if (s) restore(s, S.undo); }

// structural mutation wrapper
function mutate(fn, {render=true} = {}) {
  pushUndo();
  const D = S.cur.D;
  fn(D);
  materialize(D);
  markDirty();
  if (render) renderEditor();
}

// ============================================================ phrase operations
function insertAt(i, p) { mutate(D => D.phrases.splice(i, 0, p)); setTimeout(() => flashPhrase(i, true), 20); }
function removeAt(i) {
  const D = S.cur.D, victim = D.phrases[i];
  const incoming = incomingRefs(D)[victim.uid] || [];
  if (incoming.length && !confirm(`На фразу #${i} ссылаются: ${incoming.map(x => '#' + x.i).join(', ')}.\nСсылки будут перенаправлены на соседнюю фразу. Удалить?`)) return;
  mutate(D => {
    const next = D.phrases[i + 1] || D.phrases[i - 1];
    D.phrases.splice(i, 1);
    let n = 0;
    for (const p of D.phrases) for (const k in p.refs) if (p.refs[k] === victim.uid) { p.refs[k] = next ? next.uid : null; n++; }
    if (n) toast(`Перенаправлено ссылок: ${n} → #${next ? D.phrases.indexOf(next) : '?'}`);
  });
}
function moveBy(i, d) {
  const j = i + d; const D = S.cur.D;
  if (j < 0 || j >= D.phrases.length) return;
  mutate(D => { const [p] = D.phrases.splice(i, 1); D.phrases.splice(j, 0, p); });
  setTimeout(() => flashPhrase(j, true), 20);
}
function duplicateAt(i) {
  const D = S.cur.D, src = D.phrases[i];
  const p = { uid:S.uid++, f:src.f.slice(), notes:src.notes.slice(), notePos:src.notePos ? clone(src.notePos) : null, lead:[], raw:null, refs:{...src.refs} };
  insertAt(i + 1, p);
}
function incomingRefs(D) {
  const res = {};
  D.phrases.forEach((p, i) => {
    for (const s of refSpecs(p)) {
      const r = p.refs && p.refs[s.f];
      if (r && r !== 'START') (res[r] = res[r] || []).push({ i, f:s.f });
      if (r === 'START' && D.phrases[0]) (res[D.phrases[0].uid] = res[D.phrases[0].uid] || []).push({ i, f:s.f, start:true });
    }
  });
  return res;
}
function lastSpeaker(D, before, wantVika) {
  for (let k = before - 1; k >= 0; k--) {
    const p = D.phrases[k];
    if (kindOf(p) === 'text' && p.f[F.op] === 0 && (wantVika ? p.f[F.who] === 0 : p.f[F.who] !== 0)) return p;
  }
  return null;
}
function makeTemplate(kind, at) {
  const D = S.cur.D;
  switch (kind) {
    case 'vika': return newPhrase(["Vika", "", 0, 0, 0]);
    case 'npc': {
      const ls = lastSpeaker(D, at, false);
      if (ls) return newPhrase([ls.f[F.name], "", 0, ls.f[F.icon], ls.f[F.who]]);
      const c = npcOf(D);
      return newPhrase([c != null ? charName(c) : "NPC", "", 0, 0, -1]);
    }
    case 'choice': {
      const p = newPhrase(["Pick one", "-Option 1", -18, 0, 0, 0, "-Option 2", 0, "", -2, 0, 0, "", -2, 0, 0]);
      return p;
    }
    case 'goto': return newPhrase(["", "", -21, 0]);
    case 'end': { const p = newPhrase(["", "", -1, -1]); p.refs = {3:'START'}; return p; }
    case 'tip': return newPhrase(["Tip", "", -14, 0, 0]);
    case 'action': return newPhrase(["", "", -7, 0]);
  }
}
function finishInsert(p, at) {
  const D = S.cur.D;
  // references of new phrases default to "next phrase after it"
  if (p.f[F.op] !== -1) {
    for (const s of refSpecs(p)) if (!(s.f in p.refs)) {
      const tgt = D.phrases[at] || D.phrases[at - 1];
      p.refs[s.f] = tgt ? tgt.uid : null;
    }
  }
  insertAt(at, p);
  setTimeout(() => { const el = $(`[data-k="${p.uid}:1"]`) || $(`[data-k="${p.uid}:op"]`); if (el) el.focus(); }, 40);
}
function openInsertMenu(anchor, at) {
  const items = [
    ['vika', 'Реплика Вики', 'var(--k-text)'],
    ['npc', 'Реплика собеседника', 'var(--k-text)'],
    ['choice', 'Выбор ответа (−18)', 'var(--k-choice)'],
    ['goto', 'Переход к фразе (−21)', 'var(--k-jump)'],
    ['end', 'Конец диалога (−1)', 'var(--k-end)'],
    ['action', 'Другое действие…', 'var(--k-action)'],
    ['tip', 'Подсказка (−14)', 'var(--k-tip)'],
  ];
  showPopover(anchor, h('div', {class:'menu'}, items.map(([k, l, c]) =>
    h('button', {onclick: () => { hidePopover(); finishInsert(makeTemplate(k, at), at); }}, h('span', {class:'k', style:'background:' + c}), l))));
}

// ============================================================ issues
function issuesOf(D, p, i) {
  const out = [], f = p.f, k = kindOf(p);
  const strs = k === 'choice' ? [0,1,6,8,12] : k === 'text' ? [0,1] : [0,1];
  for (const fi of strs) {
    const v = f[fi]; if (typeof v !== 'string') continue;
    if (v.length > LIMITS[fi] - 1) out.push({lvl:'err', block:true, msg:`${FIELD_NAMES[fi]}: ${v.length} > ${LIMITS[fi]-1} символов — не скомпилируется`});
    if (/[^\x20-\x7e]/.test(v)) out.push({lvl:'warn', msg:`${FIELD_NAMES[fi]}: есть не-ASCII символы (шрифт GBA их не покажет)`});
  }
  for (const s of refSpecs(p)) {
    const r = p.refs && p.refs[s.f];
    if (r == null) out.push({lvl:'err', msg:`${FIELD_NAMES[s.f]} = ${f[s.f]} указывает за пределы диалога`});
  }
  if (k !== 'action') {
    const m = GBA.measure(p);
    if (m && m.overflow) out.push({lvl:'err', msg:`текст не влезает в бабл: ${m.lines} строк при ${m.maxLines} (движок допишет мусор за пределы окна)`});
  }
  if (k === 'action' && !OPS[f[F.op]]) out.push({lvl:'warn', msg:`неизвестный код действия ${f[F.op]}`});
  if (k === 'choice') {
    const parts = [f[F.name] + ': ', f[F.text], f[F.a0]];
    if (f[F.chk1] !== -2) parts.push(f[F.a1]);
    if (f[F.chk2] !== -2) parts.push(f[F.a2]);
    const total = parts.reduce((a, s) => a + String(s).length + 1, 0) + 1;
    if (total > 85) out.push({lvl:'warn', msg:`весь выбор = ${total} симв. > buf[85] в showChoice()`});
    if (f[F.chk2] !== -2 && f[F.chk1] === -2) out.push({lvl:'warn', msg:'ответ 4 не покажется: showChoice() проверяет chkCOND1 == −2 и для него'});
    if (S.settings.buf1Check) {
      const mx = Math.max(...[f[F.text], f[F.a0], f[F.a1], f[F.a2]].map(s => String(s).length));
      if (mx + 3 > 12) out.push({lvl:'info', msg:`самый длинный вариант ${mx} симв.: "> " + текст не влезает в buf1[12]`});
    }
  }
  if (i === D.phrases.length - 1 && (k === 'text' || k === 'choice') && p.f[F.op] !== -26)
    out.push({lvl:'warn', msg:'диалог заканчивается репликой — движок прочитает за концом массива. Добавьте «Конец диалога».'});
  return out;
}
function collectIssues() {
  const res = [];
  for (const { D } of allDialogues()) D.phrases.forEach((p, i) => issuesOf(D, p, i).forEach(x => res.push({ ...x, D, i })));
  return res;
}
function dialogueHasErr(D) { return D.phrases.some((p, i) => issuesOf(D, p, i).some(x => x.lvl === 'err')); }

// ============================================================ tree
function statusOf(name) { const m = S.meta.dialogues[name]; return (m && m.status) || ''; }
function dialogueMatches(D) {
  const st = statusOf(D.name);
  if (S.filter === 'ok' && st !== 'ok') return false;
  if (S.filter === 'wip' && st !== 'wip') return false;
  if (S.filter === 'none' && st) return false;
  if (!S.search) return true;
  const q = S.search.toLowerCase();
  if (D.name.includes(q) || D.title.toLowerCase().includes(q)) return true;
  return D.phrases.some(p => [0,1,6,8,12].some(fi => typeof p.f[fi] === 'string' && p.f[fi].toLowerCase().includes(q)));
}
function visibleDialogues() { return allDialogues().filter(x => dialogueMatches(x.D)); }
function dialoguePreview(D) {
  if (D.title) return D.title;
  const p = D.phrases.find(p => kindOf(p) === 'text' && p.f[F.text]);
  return p ? `${p.f[F.name]}: ${p.f[F.text]}` : '(пусто)';
}
function renderTree() {
  const tree = $('#tree'); tree.innerHTML = '';
  const filtering = S.search || S.filter !== 'all';
  let shown = 0;
  const hasOrder = (S.order || []).length > 0;
  const groups = orderedMissions().concat(S.orphans.length ? [{ m:{ name:'orphans', title:'Не подключены к dPointers', dialogues:S.orphans }, mi:-1, pos:-1 }] : []);
  for (const { m, mi, pos } of groups) {
    const ds = m.dialogues.filter(dialogueMatches);
    if (filtering && !ds.length) continue;
    const okN = m.dialogues.filter(d => statusOf(d.name) === 'ok').length;
    const open = filtering || S.open.has(m.name);
    const row = h('div', {class:'m-row' + (open ? ' open' : ''), title: m.title, onclick: () => { S.open.has(m.name) ? S.open.delete(m.name) : S.open.add(m.name); store.set('open', [...S.open]); renderTree(); }},
      h('span', {class:'tw'}, '▶'),
      hasOrder && mi >= 0 ? h('span', {class:'mpos', title: pos >= 0 ? `${pos + 1}-я по порядку прохождения (mission_order.cpp)` : 'Нет в missionOrder — в игре сюда не попасть'}, pos >= 0 ? (pos + 1) + '.' : '?') : null,
      h('span', {class:'mid', title: mi >= 0 ? `ID миссии (curMission) = ${mi}` : ''}, mi >= 0 ? m.name : '—'),
      h('span', {class:'mt'}, m.title || (mi >= 0 ? 'Миссия ' + mi : '')),
      h('span', {class:'prog', title:`OK: ${okN} из ${m.dialogues.length}`}, h('i', {style:`width:${m.dialogues.length ? 100*okN/m.dialogues.length : 0}%`})),
      h('span', {class:'cnt'}, m.dialogues.length),
      mi >= 0 ? h('span', {class:'m-add', title:'Добавить диалог в эту миссию', onclick: e => { e.stopPropagation(); addDialogue(m); }}, '+') : null);
    tree.append(row);
    if (!open) continue;
    const list = h('div', {class:'d-list'});
    for (const D of ds) {
      shown++;
      list.append(treeRow(D, m.dialogues.indexOf(D)));
    }
    tree.append(list);
  }
  if (filtering && !shown) tree.append(h('div', {class:'tree-note'}, 'Ничего не найдено'));
}
function treeRow(D, idx) {
  const st = statusOf(D.name);
  const sel = S.cur && S.cur.name === D.name;
  const stEl = h('span', {class:'st ' + st, title:'Статус: клик — сменить (нет → в работе → OK)', onclick: e => { e.stopPropagation(); cycleStatus(D.name); }},
    st === 'ok' ? '✓' : st === 'wip' ? '●' : '○');
  return h('div', {class:'d-row' + (sel ? ' sel' : '') + (S.search ? ' hit' : ''), 'data-name':D.name, onclick: () => select(D.name)},
    stEl,
    h('span', {class:'did'}, D.name.slice(5)),
    h('span', {class:'dt', title: dialoguePreview(D)}, dialoguePreview(D)),
    S.dirty.has(D.name) ? h('span', {class:'dirty', title:'Есть несохранённые изменения'}, '•') : null,
    h('span', {class:'dc'}, D.phrases.length));
}
function updateTreeRow(name) {
  if (!name) return;
  const old = $(`.d-row[data-name="${name}"]`); if (!old) return;
  const f = findDialogue(name); if (!f) return;
  old.replaceWith(treeRow(f.D, f.di));
}
function cycleStatus(name) {
  const st = statusOf(name);
  dmeta(name).status = st === '' ? 'wip' : st === 'wip' ? 'ok' : '';
  saveMeta(); renderTree();
  if (S.cur && S.cur.name === name) renderHeaderOnly();
}
function addDialogue(m) {
  const nums = m.dialogues.map(d => parseInt(d.name.slice(5), 10)).filter(n => !isNaN(n));
  const name = m.name + '_' + pad3(nums.length ? Math.max(...nums) + 1 : 0);
  const D = { name, title:'', trailing:[], phrases:[] };
  D.phrases.push(newPhrase(["Vika", "...", 0, 0, 0]));
  const end = newPhrase(["", "", -1, -1]); end.refs = {3:'START'}; D.phrases.push(end);
  m.dialogues.push(D);
  S.dirty.add(name); S.structDirty = true;
  select(name);
  toast(`Добавлен ${name} (индекс ${m.dialogues.length - 1} в ${m.name})`);
}
function deleteDialogue() {
  const c = S.cur; if (!c || c.orphan) return;
  const m = c.m;
  if (m.dialogues[m.dialogues.length - 1] !== c.D) return toast('Удалять можно только последний диалог миссии — номера остальных используются в коде игры.', 'err');
  if (!confirm(`Удалить ${c.name} целиком? Массив исчезнет из dialogues.cpp после сохранения.`)) return;
  m.dialogues.pop(); S.structDirty = true; S.dirty.add(c.name);
  S.cur = null; renderAll();
  if (m.dialogues.length) select(m.dialogues[m.dialogues.length - 1].name);
}
function addMission() {
  const nums = S.missions.map(m => parseInt(m.name.slice(1), 10));
  const name = 'd' + pad3(Math.max(-1, ...nums) + 1);
  const title = prompt(`Новая миссия ${name}. Название (комментарий в коде):`, '');
  if (title === null) return;
  const m = { name, title, dialogues:[] };
  S.missions.push(m); S.open.add(name); S.structDirty = true;
  addDialogue(m);
  if ((S.order || []).length) toast(`${name}: ID ${S.missions.length - 1}. Чтобы задать место в сюжете, впиши ${S.missions.length - 1} в missionOrder[] (src/mission_order.cpp)`);
}

// ============================================================ editor
function renderAll() { renderTree(); renderEditor(); updateTop(); }
function updateTop() {
  const dirty = S.dirty.size || S.structDirty;
  $('#btnSave').classList.toggle('dirty', !!dirty);
  $('#btnSave').textContent = dirty ? 'Сохранить •' : 'Сохранить';
  $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
  const c = S.cur;
  $('#crumbs').innerHTML = '';
  if (c) $('#crumbs').append(c.m.name, ' / ', h('b', null, c.name), c.m.title ? '  — ' + c.m.title : '');
  const iss = collectIssues();
  const e = iss.filter(x => x.lvl === 'err').length, w = iss.filter(x => x.lvl === 'warn').length;
  const b = $('#issuesBadge');
  b.hidden = !(e || w);
  b.className = 'badge' + (e ? '' : ' warn');
  b.textContent = (e ? `✕ ${e}` : '') + (e && w ? '  ' : '') + (w ? `⚠ ${w}` : '');
  b.title = 'Ошибки / предупреждения во всех диалогах — клик для списка';
}

function rememberFocus() {
  const a = document.activeElement;
  if (!a || !a.dataset || !a.dataset.k) return null;
  return { k:a.dataset.k, s:a.selectionStart, e:a.selectionEnd };
}
function restoreFocus(fs) {
  if (!fs) return;
  const el = $(`[data-k="${fs.k}"]`);
  if (!el) return;
  el.focus({preventScroll:true});
  try { if (fs.s != null) el.setSelectionRange(fs.s, fs.e); } catch {}
}

function renderHeaderOnly() {
  const old = $('.d-head'); if (!old || !S.cur) return;
  old.replaceWith(renderHeader(S.cur));
}
function renderEditor() {
  const ed = $('#editor');
  if (!S.cur) { ed.hidden = true; $('#empty').hidden = false; updateTop(); return; }
  $('#empty').hidden = true; ed.hidden = false;
  const fs = rememberFocus();
  const st = $('#main').scrollTop;
  const D = S.cur.D;
  ed.innerHTML = ''; PREVIEWS.clear();
  ed.append(renderHeader(S.cur));
  const list = h('div', {class:'ph-list'});
  const inc = incomingRefs(D);
  list.append(insBar(0));
  D.phrases.forEach((p, i) => { list.append(renderCard(D, p, i, inc[p.uid] || [])); list.append(insBar(i + 1)); });
  ed.append(list);
  $('#main').scrollTop = st;
  restoreFocus(fs);
  updateTop();
}
function insBar(at) {
  return h('div', {class:'ins'}, h('button', {class:'ins-btn', onclick: e => openInsertMenu(e.currentTarget, at)}, '+ вставить'));
}
function renderHeader(c) {
  const D = c.D, st = statusOf(D.name), meta = S.meta.dialogues[D.name] || {};
  const g = guessNpc(D);
  const npcSel = h('select', {title:'Кто этот NPC (who = −1). Нужен только для портрета в редакторе.', onchange: e => {
    const v = e.target.value; if (v === '') delete dmeta(D.name).npc; else dmeta(D.name).npc = +v;
    saveMeta(); renderEditor();
  }}, h('option', {value:''}, g != null ? `авто: ${charName(g)}` : '— не задан —'),
    S.chars.map((n, i) => i ? h('option', {value:i, selected: meta.npc === i}, `${n} (${i})`) : null));
  const seg = h('div', {class:'seg'}, [['', '—'], ['wip', '● В работе'], ['ok', '✓ OK']].map(([v, l]) =>
    h('button', {class:(st === v ? 'on ' : '') + v, onclick: () => { dmeta(D.name).status = v; saveMeta(); renderTree(); renderHeaderOnly(); }}, l)));
  const isLast = !c.orphan && c.m.dialogues[c.m.dialogues.length - 1] === D;
  return h('div', {class:'d-head'},
    h('div', {class:'d-head-row'},
      h('span', {class:'d-name'}, D.name),
      h('span', {class:'d-idx', title:'Индекс в массиве миссии — это номер диалога, который использует код'}, c.orphan ? 'не подключён' : `[${c.m.name}][${c.di}]`),
      h('input', {class:'d-title', type:'text', value:D.title, placeholder:'Название / комментарий (пишется в код после =)', 'data-k':'title',
        onfocus: () => S.pendingUndo = true,
        oninput: e => { if (S.pendingUndo) { pushUndo(); S.pendingUndo = false; } D.title = e.target.value.replace(/[\r\n]/g, ' '); markDirty(); }}),
      seg),
    h('div', {class:'d-sub'},
      h('label', {class:'fld'}, 'NPC диалога:', npcSel),
      h('span', {class:'sep'}),
      c.orphan ? null : h('label', {class:'fld'}, 'Миссия:', h('input', {type:'text', value:c.m.title, style:'width:220px', title:'Комментарий у массива миссии',
        oninput: e => { c.m.title = e.target.value.replace(/[\r\n]/g, ' '); S.structDirty = true; updateTop(); }, onchange: () => renderTree()})),
      h('span', {class:'sep'}),
      h('span', null, `${D.phrases.length} фраз`),
      h('div', {class:'spacer'}),
      h('button', {class:'btn small', onclick: () => finishInsert(makeTemplate('vika', D.phrases.length), D.phrases.length)}, '+ реплика'),
      h('button', {class:'btn small', onclick: e => openInsertMenu(e.currentTarget, D.phrases.length)}, '+ …'),
      h('button', {class:'btn small ghost', disabled: !isLast, title: isLast ? 'Удалить диалог' : 'Удалять можно только последний диалог миссии', onclick: deleteDialogue}, 'удалить диалог')));
}

// ------------------------------------------------------------ cards
function bindText(D, p, fi, el, counter) {
  el.dataset.k = p.uid + ':' + fi;
  el.addEventListener('focus', () => S.pendingUndo = true);
  el.addEventListener('input', () => {
    if (S.pendingUndo) { pushUndo(); S.pendingUndo = false; }
    let v = el.value.replace(/\r?\n/g, el.tagName === 'TEXTAREA' && fi === 1 ? '\n' : ' ');
    p.f[fi] = v;
    if (counter) updCounter(counter, v, fi);
    redrawPreview(p);
    markDirty();
  });
  el.addEventListener('change', () => { refreshLabels(); refreshIssues(p); });
  return el;
}
function updCounter(c, v, fi) {
  const max = LIMITS[fi] - 1;
  c.textContent = `${v.length}/${max}`;
  c.classList.toggle('over', v.length > max);
}
function counterFor(p, fi) { const c = h('span', {class:'cnt-l'}); updCounter(c, String(p.f[fi]), fi); return c; }
function numInput(D, p, fi, opts={}) {
  const el = h('input', {type:'number', value: typeof p.f[fi] === 'number' ? p.f[fi] : '', 'data-k':p.uid + ':' + fi, title: FIELD_NAMES[fi]});
  el.addEventListener('focus', () => S.pendingUndo = true);
  el.addEventListener('input', () => {
    if (el.value === '' || isNaN(+el.value)) return;
    if (S.pendingUndo) { pushUndo(); S.pendingUndo = false; }
    p.f[fi] = Math.trunc(+el.value); redrawPreview(p); markDirty();
    if (opts.rerender) { initRefsFor(D, p); renderEditor(); }
  });
  el.addEventListener('change', () => refreshIssues(p));
  return el;
}
function refSelect(D, p, fi, spec) {
  const cur = p.refs[fi];
  const sel = h('select', {class:'ref-sel', 'data-k':p.uid + ':' + fi, 'data-ref':'1', onchange: e => {
    pushUndo();
    const v = e.target.value;
    p.refs[fi] = v === 'START' ? 'START' : v === 'RAW' ? null : +v;
    materialize(D); markDirty(); renderEditor();
  }});
  if (spec.start) sel.append(h('option', {value:'START', selected: cur === 'START'}, '⟲ с начала (−1)'));
  D.phrases.forEach((q, i) => sel.append(h('option', {value:q.uid, selected: cur === q.uid}, phraseLabel(D, i))));
  if (cur == null) sel.append(h('option', {value:'RAW', selected:true}, `⚠ значение ${p.f[fi]} — вне диалога`));
  const go = h('button', {class:'ref-go', title:'Показать фразу', onclick: () => {
    const r = p.refs[fi]; const t = r === 'START' ? 0 : D.phrases.findIndex(q => q.uid === r); if (t >= 0) flashPhrase(t);
  }}, '↗');
  return [sel, go];
}
function refreshLabels() {
  if (!S.cur) return;
  const D = S.cur.D;
  const idx = new Map(D.phrases.map((p, i) => [String(p.uid), i]));
  for (const sel of $$('select[data-ref]')) for (const o of sel.options) if (idx.has(o.value)) o.textContent = phraseLabel(D, idx.get(o.value));
  updateTreeRow(S.cur.name);
}
function refreshIssues(p) {
  const card = $(`.card[data-uid="${p.uid}"]`); if (!card || !S.cur) return;
  const D = S.cur.D, i = D.phrases.indexOf(p);
  const box = $('.issues', card); if (!box) return;
  box.replaceWith(issuesEl(D, p, i));
  updateTop();
}
function issuesEl(D, p, i) {
  return h('div', {class:'issues'}, issuesOf(D, p, i).map(x => h('div', {class:'iss ' + x.lvl}, (x.lvl === 'err' ? '✕ ' : x.lvl === 'warn' ? '⚠ ' : 'ℹ ') + x.msg)));
}
function flashPhrase(i, noScrollIfVisible) {
  const D = S.cur && S.cur.D; if (!D || !D.phrases[i]) return;
  const card = $(`.card[data-uid="${D.phrases[i].uid}"]`); if (!card) return;
  const r = card.getBoundingClientRect(), mr = $('#main').getBoundingClientRect();
  if (!(noScrollIfVisible && r.top > mr.top + 90 && r.bottom < mr.bottom)) card.scrollIntoView({block:'center', behavior:'smooth'});
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1400);
}

function renderCard(D, p, i, incoming) {
  const k = kindOf(p);
  const q = S.search && [0,1,6,8,12].some(fi => typeof p.f[fi] === 'string' && p.f[fi].toLowerCase().includes(S.search.toLowerCase()));
  const card = h('div', {class:`card ${cardClass(p)}${q ? ' hl' : ''}`, 'data-uid':p.uid});
  const numCol = h('div', {class:'c-num'}, h('b', null, String(i).padStart(2, '0')),
    incoming.length ? h('div', {class:'c-in', title:'Сюда ведут ссылки'}, incoming.slice(0, 6).map(x =>
      h('span', {class:'inref', onclick: () => flashPhrase(x.i)}, (x.start ? '⟲' : '←') + '#' + x.i)),
      incoming.length > 6 ? h('span', {class:'inref'}, '+' + (incoming.length - 6)) : null) : null);
  const body = h('div', {class:'c-body'});
  if (k === 'text') renderTextBody(D, p, i, body);
  else if (k === 'choice') renderChoiceBody(D, p, i, body);
  else renderActionBody(D, p, i, body);
  const tools = h('div', {class:'c-tools'},
    h('button', {title:'Вверх', onclick: () => moveBy(i, -1)}, '↑'),
    h('button', {title:'Вниз', onclick: () => moveBy(i, 1)}, '↓'),
    h('button', {title:'Дублировать', onclick: () => duplicateAt(i)}, '⧉'),
    h('button', {title:'Вставить после…', onclick: e => openInsertMenu(e.currentTarget, i + 1)}, '+'),
    h('button', {class:'del', title:'Удалить фразу', onclick: () => removeAt(i)}, '✕'));
  card.append(numCol, body, tools);
  return card;
}
function notesEl(D, p) {
  if (!p.notes.length && !p.lead.length) return null;
  const all = [...p.lead, ...p.notes].join('\n');
  const ta = h('textarea', {class:'notes', rows: Math.min(6, all.split('\n').length), 'data-k':p.uid + ':notes',
    title:'Комментарии из исходника. Каждая строка должна начинаться с // (или быть /* … */)'}, );
  ta.value = all;
  ta.addEventListener('focus', () => S.pendingUndo = true);
  ta.addEventListener('input', () => {
    if (S.pendingUndo) { pushUndo(); S.pendingUndo = false; }
    p.lead = []; p.notePos = null;
    p.notes = ta.value.split('\n').map(s => s.trim()).filter(Boolean).map(s => (s.startsWith('//') || s.startsWith('/*')) ? s : '//' + s);
    markDirty();
  });
  return h('details', {class:'more', open: true}, h('summary', null, 'комментарии в коде'), ta);
}
function addNoteBtn(p) {
  if (p.notes.length || p.lead.length) return null;
  return h('button', {class:'btn small ghost', onclick: () => { pushUndo(); p.notes = ['//']; p.notePos = null; markDirty(); renderEditor(); }}, '+ комментарий');
}
function rawEl(D, p) {
  const grid = h('div', {class:'raw-grid'}, FIELD_NAMES.map((n, fi) => {
    const v = p.f[fi];
    const inp = h('input', {type:'text', value: typeof v === 'object' ? v.expr : v, 'data-k':p.uid + ':raw' + fi});
    inp.addEventListener('change', () => {
      pushUndo();
      if (STR_IDX.has(fi)) p.f[fi] = inp.value;
      else if (/^\s*-?\d+\s*$/.test(inp.value)) p.f[fi] = parseInt(inp.value, 10);
      else p.f[fi] = { expr: inp.value };
      initRefsFor(D, p); markDirty(); renderEditor();
    });
    return h('label', null, `${fi} ${n}`, inp);
  }));
  return h('details', {class:'more'}, h('summary', null, 'все поля структуры'), grid);
}
function whoSelect(D, p) {
  const who = p.f[F.who];
  const npc = npcOf(D);
  const sel = h('select', {title:'who — чей портрет показывать', 'data-k':p.uid + ':who', onchange: e => {
    pushUndo();
    const v = +e.target.value; p.f[F.who] = v;
    const nameNow = String(p.f[F.name]);
    const known = S.chars.includes(nameNow) || nameNow === '' || nameNow === 'NPC';
    if (known) p.f[F.name] = v === 0 ? 'Vika' : v === -1 ? (npc != null ? charName(npc) : nameNow) : charName(v);
    markDirty(); renderEditor();
  }},
    h('option', {value:0, selected: who === 0}, 'Вика (0)'),
    h('option', {value:-1, selected: who === -1}, `NPC диалога (−1)${npc != null ? ' · ' + charName(npc) : ''}`),
    S.chars.map((n, c) => c ? h('option', {value:c, selected: who === c}, `${n} (${c})`) : null),
    (typeof who === 'number' && (who < -1 || who >= S.chars.length)) ? h('option', {value:who, selected:true}, `? (${who})`) : null);
  return sel;
}
function nameInput(D, p) {
  const c = counterFor(p, 0);
  const el = bindText(D, p, 0, h('input', {type:'text', class:'name-in', value:p.f[0], list:'names-dl', placeholder:'Имя в окне'}), c);
  return [el, c];
}
// ------------------------------------------------------------ GBA preview
const PREVIEWS = new Map();   // uid -> redraw()
function sceneOpts(D, p) {
  const op = p.f[F.op];
  let src = p;
  if (op === -18) {   // choice keeps the portrait of the last normal line
    const i = D.phrases.indexOf(p);
    src = null;
    for (let k = i - 1; k >= 0; k--) if (D.phrases[k].f[F.op] === 0 || D.phrases[k].f[F.op] > 0) { src = D.phrases[k]; break; }
  }
  if (!src || (op !== 0 && op !== -18 && !(op > 0))) return {};
  const cid = portraitChar(D, src), emo = num(src.f[F.icon]);
  if (cid != null && emotionCount(cid) > emo) return { portrait: { url: `/api/portrait/${cid}/${emo}.png` } };
  return { portrait: { placeholder: cid == null ? 'NPC ?' : charName(cid) } };
}
function previewEl(D, p) {
  const scale = +S.settings.preview || 0;
  if (!scale) return null;
  const cv = h('canvas', {class:'gba-cv', title: p.f[F.op] === 0 ? 'Клик по портрету — выбрать эмоцию' : ''});
  const cap = h('div', {class:'gba-cap'});
  let pick = 0;
  const redraw = () => {
    const sc = GBA.sceneFor(p, { ...sceneOpts(D, p), pick });
    const res = GBA.draw(cv, sc, scale, redraw);
    const m = res[0];
    if (m && GBA.hasFont()) {
      cap.className = 'gba-cap' + (m.overflow ? ' over' : '');
      cap.textContent = m.overflow ? `✕ не влезает: ${m.lines} строк из ${m.maxLines}` : `строк ${m.lines}/${m.maxLines}`;
    }
  };
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect();
    const gx = (e.clientX - r.left) / scale, gy = (e.clientY - r.top) / scale + GBA.sceneFor(p, {}).crop[0];
    if (p.f[F.op] === 0 && gx >= 168 && gy >= 72) openEmotionPicker(cv, D, p, portraitChar(D, p));
    else if (p.f[F.op] === -18) { pick = (pick + 1) % 4; redraw(); }
  });
  PREVIEWS.set(p.uid, redraw);
  redraw();
  return h('div', {class:'gba-wrap'}, cv, cap);
}
function redrawPreview(p) {
  const fn = PREVIEWS.get(p.uid); if (fn) fn();
  // a choice right after this line shows its portrait
  if (S.cur) { const D = S.cur.D, i = D.phrases.indexOf(p); const n = D.phrases[i + 1]; if (n && n.f[F.op] === -18) { const g = PREVIEWS.get(n.uid); if (g) g(); } }
}

function renderTextBody(D, p, i, body) {
  const op = p.f[F.op];
  const kindSel = h('select', {class:'kind-sel', 'data-k':p.uid + ':kind', onchange: e => changeOp(D, p, +e.target.value)}, Object.entries(TEXT_KINDS).map(([v, l]) => h('option', {value:v, selected: String(op) === v || (v === '0' && op > 0)}, l)),
    h('option', {value:-18}, '→ сделать выбором (−18)'), h('option', {value:-21}, '→ сделать действием'));
  const ta = h('textarea', {rows:2, placeholder:'Текст реплики'}); ta.value = p.f[F.text];
  const cnt = counterFor(p, 1);
  bindText(D, p, 1, ta, cnt);
  const [nameEl, nameCnt] = nameInput(D, p);

  if (op === -26) {
    body.append(previewEl(D, p) || '', h('div', {class:'c-main'},
      h('div', {class:'c-row'}, kindSel, nameEl, nameCnt,
        h('label', {class:'fld', title:'icon → remDiaIn'}, 'время показа', numInput(D, p, F.icon)),
        h('label', {class:'fld', title:'who → смещение бабла: y = 14 − who·13'}, 'позиция (1 сверху, 0 снизу)', numInput(D, p, F.who))),
      h('div', {class:'txt-wrap'}, ta, cnt),
      h('div', {class:'hint'}, 'Авто-реплика показывается без портрета и не ждёт нажатия A.'),
      issuesEl(D, p, i), notesEl(D, p), h('div', {class:'c-row'}, addNoteBtn(p)), rawEl(D, p)));
    return;
  }
  const cid = portraitChar(D, p), emo = num(p.f[F.icon]);
  const pv = previewEl(D, p);
  const portrait = pv ? null : op === -14 ? null : portraitEl(cid, emo, {title:'Клик — выбрать эмоцию', onclick: e => openEmotionPicker(e.currentTarget, D, p, cid)});
  const emoBtn = pv && op !== -14 ? h('button', {class:'btn small', title:'Эмоция (icon)', onclick: e => openEmotionPicker(e.currentTarget, D, p, cid)}, `☺ ${emo} · ${emotionName(emo)}`) : null;
  body.append(pv || portrait || '',
    h('div', {class:'c-main'},
      h('div', {class:'c-row'}, op === -14 ? null : whoSelect(D, p), nameEl, nameCnt, emoBtn, h('div', {class:'spacer', style:'flex:1'}), kindSel),
      h('div', {class:'txt-wrap'}, ta, cnt),
      op === -14 ? h('div', {class:'hint'}, 'Подсказка: серое окно без портрета.') : null,
      issuesEl(D, p, i), notesEl(D, p), h('div', {class:'c-row'}, addNoteBtn(p)), rawEl(D, p)));
}

function condMode(chk, equ) { if (chk === -1) return 'always'; if (chk === -2) return 'hidden'; return equ > 200 ? 'lt' : 'gt'; }
function renderChoiceBody(D, p, i, body) {
  const [nameEl, nameCnt] = nameInput(D, p);
  const rows = [
    { lbl:'1', tf:F.text, rf:F.c9 },
    { lbl:'2', tf:F.a0, rf:F.c0 },
    { lbl:'3', tf:F.a1, rf:F.c1, chk:F.chk1, equ:F.equ1 },
    { lbl:'4', tf:F.a2, rf:F.c2, chk:F.chk2, equ:F.equ2 },
  ];
  const opts = h('div', {class:'opts'}, rows.map(r => {
    const off = r.chk != null && p.f[r.chk] === -2;
    const inp = h('input', {type:'text', value:p.f[r.tf], placeholder: off ? '(ответ скрыт)' : 'Текст варианта'});
    const cnt = counterFor(p, r.tf);
    bindText(D, p, r.tf, inp, cnt);
    const tgt = off ? h('span', {class:'hint'}, '—') : h('span', {style:'display:inline-flex;gap:4px'}, ...refSelect(D, p, r.rf, {}));
    let cond = h('span', {class:'hint'}, 'всегда');
    if (r.chk != null) {
      const mode = condMode(p.f[r.chk], p.f[r.equ]);
      const modeSel = h('select', {'data-k':p.uid + ':mode' + r.chk, onchange: e => {
        pushUndo();
        const m = e.target.value;
        const n = p.f[r.equ] > 200 ? p.f[r.equ] - 200 : p.f[r.equ];
        const stat = p.f[r.chk] >= 0 ? p.f[r.chk] : 0;
        if (m === 'always') p.f[r.chk] = -1;
        else if (m === 'hidden') p.f[r.chk] = -2;
        else { p.f[r.chk] = stat; p.f[r.equ] = m === 'lt' ? 200 + num(n) : num(n); }
        const hadRef = p.refs[r.rf] !== undefined;
        if (m !== 'hidden' && !hadRef) { const nx = D.phrases[i + 1]; p.refs[r.rf] = nx ? nx.uid : null; }
        if (m === 'hidden') delete p.refs[r.rf];
        materialize(D); markDirty(); renderEditor();
      }}, [['always','всегда'],['hidden','скрыт'],['gt','если стат >'],['lt','если стат <']].map(([v, l]) => h('option', {value:v, selected: mode === v}, l)));
      const parts = [modeSel];
      if (mode === 'gt' || mode === 'lt') {
        const statSel = h('select', {onchange: e => { pushUndo(); p.f[r.chk] = +e.target.value; markDirty(); }},
          STATS.map((s, si) => h('option', {value:si, selected: p.f[r.chk] === si}, s)));
        const nIn = h('input', {type:'number', value: mode === 'lt' ? p.f[r.equ] - 200 : p.f[r.equ], title:'Порог'});
        nIn.addEventListener('focus', () => S.pendingUndo = true);
        nIn.addEventListener('input', () => { if (nIn.value === '') return; if (S.pendingUndo) { pushUndo(); S.pendingUndo = false; }
          p.f[r.equ] = mode === 'lt' ? 200 + Math.trunc(+nIn.value) : Math.trunc(+nIn.value); markDirty(); });
        parts.push(statSel, nIn);
      }
      cond = h('span', {class:'cond'}, ...parts);
    }
    return h('div', {class:'opt' + (off ? ' off' : '')}, h('span', {class:'on-k'}, r.lbl),
      h('span', {style:'display:flex;gap:6px;align-items:center'}, inp, cnt), cond, tgt);
  }));
  body.append(previewEl(D, p) || '', h('div', {class:'c-main'},
    h('div', {class:'c-row'}, h('b', {style:'color:var(--k-choice)'}, '☰ Выбор'), nameEl, nameCnt,
      h('span', {class:'hint'}, 'варианты → фраза, куда перейти (точный индекс)'),
      h('div', {style:'flex:1'}),
      h('select', {class:'kind-sel', onchange: e => changeOp(D, p, +e.target.value)},
        h('option', {value:-18, selected:true}, 'Выбор (−18)'), h('option', {value:0}, '→ сделать репликой'), h('option', {value:-21}, '→ сделать действием'))),
    opts, issuesEl(D, p, i), notesEl(D, p), h('div', {class:'c-row'}, addNoteBtn(p)), rawEl(D, p)));
}

function changeOp(D, p, v) {
  pushUndo();
  const oldRef = refSpecs(p).map(s => p.refs[s.f]).find(r => r != null && r !== 'START');
  const wasText = kindOf(p) !== 'action', wasChoice = kindOf(p) === 'choice';
  p.f[F.op] = v;
  const k = kindOf(p);
  if (k === 'text' && !p.f[F.name]) p.f[F.name] = 'Vika';
  if (k === 'text' && wasChoice) for (let fi = 5; fi < 16; fi++) p.f[fi] = STR_IDX.has(fi) ? '' : 0;
  if (k === 'choice') { p.f[F.chk1] = -2; p.f[F.chk2] = -2; if (!p.f[F.name] || p.f[F.name] === 'Vika') p.f[F.name] = 'Pick one'; }
  if (k === 'action' && wasText) { p.f[F.name] = ''; p.f[F.text] = ''; for (let fi = 3; fi < 16; fi++) p.f[fi] = STR_IDX.has(fi) ? '' : 0; }
  const nextUid = (D.phrases[D.phrases.indexOf(p) + 1] || p).uid;
  p.refs = {};
  for (const s of refSpecs(p)) {
    if (s.start && oldRef == null) p.refs[s.f] = 'START';
    else p.refs[s.f] = oldRef != null ? oldRef : nextUid;
  }
  materialize(D); markDirty(); renderEditor();
}
function opSelect(D, p) {
  const op = p.f[F.op];
  const sel = h('select', {class:'op-sel', 'data-k':p.uid + ':op', onchange: e => changeOp(D, p, +e.target.value)});
  for (const g of OP_GROUPS) {
    const og = h('optgroup', {label:g});
    for (const [code, d] of Object.entries(OPS)) if (d.g === g) og.append(h('option', {value:code, selected: +code === op}, `${d.n}  (${code})`));
    sel.append(og);
  }
  const og2 = h('optgroup', {label:'Показать текст'},
    h('option', {value:0}, 'Реплика (0)'), h('option', {value:-14}, 'Подсказка (−14)'), h('option', {value:-26}, 'Авто-реплика (−26)'), h('option', {value:-18}, 'Выбор (−18)'));
  sel.append(og2);
  if (!OPS[op]) sel.prepend(h('option', {value:op, selected:true}, `неизвестно (${op})`));
  return sel;
}
function statSelect(D, p, fi) {
  const v = num(p.f[fi]);
  const sel = h('select', {'data-k':p.uid + ':' + fi, onchange: e => { pushUndo(); p.f[fi] = +e.target.value; markDirty(); }},
    h('optgroup', {label:'Характеристики Вики'}, STATS.map((s, si) => h('option', {value:si, selected: v === si}, `${s} (${si})`))),
    h('optgroup', {label:'Отношения с (200 + id)'}, S.chars.map((n, c) => c ? h('option', {value:200 + c, selected: v === 200 + c}, `♥ ${n} (${200 + c})`) : null)));
  if (!(v >= 0 && v < STATS.length) && !(v > 200 && v < 200 + S.chars.length)) sel.prepend(h('option', {value:v, selected:true}, `? ${v}`));
  return sel;
}
function charSelect(D, p, fi) {
  const v = p.f[fi];
  const sel = h('select', {'data-k':p.uid + ':' + fi, onchange: e => { pushUndo(); p.f[fi] = +e.target.value; markDirty(); }},
    S.chars.map((n, c) => h('option', {value:c, selected: v === c}, `${n} (${c})`)));
  if (!(v >= 0 && v < S.chars.length)) sel.prepend(h('option', {value:v, selected:true}, `? ${v}`));
  return sel;
}
function renderActionBody(D, p, i, body) {
  const d = OPS[p.f[F.op]];
  const params = h('div', {class:'params'});
  if (d) for (const prm of d.p) {
    let ctl;
    if (prm.t === 'ref') ctl = h('span', {style:'display:inline-flex;gap:4px'}, ...refSelect(D, p, prm.f, prm));
    else if (prm.t === 'char') ctl = charSelect(D, p, prm.f);
    else if (prm.t === 'stat') ctl = statSelect(D, p, prm.f);
    else ctl = numInput(D, p, prm.f);
    params.append(h('label', {class:'fld', title: FIELD_NAMES[prm.f]}, prm.l, ctl));
  }
  body.append(h('div', {class:'c-main'},
    h('div', {class:'c-row'}, h('span', {style:'color:var(--muted)'}, '⚙'), opSelect(D, p)),
    params.childNodes.length ? params : null,
    d && d.hint ? h('div', {class:'hint'}, d.hint) : null,
    issuesEl(D, p, i), notesEl(D, p), h('div', {class:'c-row'}, addNoteBtn(p)), rawEl(D, p)));
}

// ============================================================ popovers / modals
function showPopover(anchor, content) {
  const pop = $('#popover');
  pop.innerHTML = ''; pop.append(content); pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(r.left, innerWidth - pw - 10), y = r.bottom + 6;
  if (y + ph > innerHeight - 10) y = Math.max(10, r.top - ph - 6);
  pop.style.left = Math.max(10, x) + 'px'; pop.style.top = y + 'px';
}
function hidePopover() { $('#popover').hidden = true; }
document.addEventListener('mousedown', e => { if (!$('#popover').hidden && !$('#popover').contains(e.target)) hidePopover(); });

function openEmotionPicker(anchor, D, p, cid) {
  const n = cid != null ? emotionCount(cid) : 0;
  const count = Math.max(n, n ? 0 : 14);
  const cur = num(p.f[F.icon]);
  const grid = h('div', {class:'emo-grid'});
  for (let e = 0; e < Math.max(count, cur + 1); e++) {
    const cell = h('div', {class:'emo-cell' + (e === cur ? ' on' : ''), title:`icon = ${e}`, onclick: () => {
      pushUndo(); p.f[F.icon] = e; markDirty(); hidePopover(); renderEditor();
    }});
    if (n > e) cell.append(h('img', {src:`/api/portrait/${cid}/${e}.png`}));
    else cell.append(h('div', {class:'ph2'}, e));
    cell.append(h('span', null, `${e} · ${emotionName(e)}`));
    grid.append(cell);
  }
  showPopover(anchor, h('div', null,
    h('div', {class:'pop-title'}, h('span', null, cid != null ? `${charName(cid)} — эмоция (icon)` : 'Эмоция (NPC не задан — выберите его в шапке диалога)'),
      h('a', {href:'#', style:'color:var(--muted)', onclick: e => { e.preventDefault(); hidePopover(); openSettings(); }}, 'переименовать…')),
    grid));
}

function modal(content) {
  const m = $('#modal'); const box = $('.modal-box', m);
  box.innerHTML = ''; box.append(content); m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; if (play) play = null; }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });

function openSettings() {
  const max = Math.max(14, ...Object.values(S.portraits));
  const names = h('div', {class:'emo-names'});
  for (let e = 0; e < max; e++) {
    const inp = h('input', {type:'text', value: (S.meta.emotions[e] || ''), placeholder: DEFAULT_EMOTIONS[e] || ''});
    inp.addEventListener('input', () => { if (inp.value.trim()) S.meta.emotions[e] = inp.value.trim(); else delete S.meta.emotions[e]; saveMeta(); });
    names.append(h('label', null, String(e).padStart(2, '0'), inp));
  }
  const vikaRow = h('div', {style:'display:flex;gap:6px;flex-wrap:wrap'});
  for (let e = 0; e < (S.portraits[0] || 0); e++) vikaRow.append(h('div', {class:'emo-cell', style:'cursor:default'}, h('img', {src:`/api/portrait/0/${e}.png`}), h('span', null, `${e} · ${emotionName(e)}`)));
  const b1 = h('input', {type:'checkbox', checked: S.settings.buf1Check, onchange: e => { S.settings.buf1Check = e.target.checked; store.set('settings', S.settings); renderEditor(); }});
  modal(h('div', null,
    h('h2', null, 'Настройки'),
    h('h3', null, 'Названия эмоций (icon)'),
    h('div', {class:'hint', style:'margin-bottom:8px'}, 'Номера общие для всех персонажей. Серые подсказки — догадки по существующим репликам. Хранится в editor_meta.json.'),
    names,
    vikaRow.childNodes.length ? [h('h3', null, 'Вика — все эмоции'), vikaRow] : null,
    h('h3', null, 'Превью экрана GBA'),
    h('label', {class:'fld'}, 'масштаб:', h('select', {onchange: e => { S.settings.preview = +e.target.value; store.set('settings', S.settings); }},
      [[0,'выключено'],[1,'1×'],[2,'2×'],[3,'3×']].map(([v, l]) => h('option', {value:v, selected: (+S.settings.preview || 0) === v}, l)))),
    h('div', {class:'hint', style:'margin:8px 0'}, 'Палитра фона уровня в редакторе неизвестна — подберите цвета под игру (индексы 1/2 — бабл, 5/6 — выделение в выборе). Рамка рисуется условно: настоящие тайлы рамки лежат в тайлсете.'),
    h('div', {class:'color-grid'}, [['screen','фон экрана'],['bubbleBg','бабл: фон (1)'],['bubbleFg','бабл: текст (2)'],['border','рамка'],['selBg','выбор: фон (5)'],['selFg','выбор: текст (6)'],['overflow','вылезший текст']].map(([k, l]) => {
      const inp = h('input', {type:'color', value: GBA.colors()[k]});
      inp.addEventListener('input', () => { S.meta.gbaColors = { ...(S.meta.gbaColors || {}), [k]: inp.value }; GBA.setColors(S.meta.gbaColors); saveMeta(); });
      return h('label', null, inp, l);
    })),
    h('div', {style:'margin-top:6px'}, h('button', {class:'btn small ghost', onclick: () => { delete S.meta.gbaColors; GBA.setColors(null); saveMeta(); closeModal(); openSettings(); }}, 'сбросить цвета')),
    h('h3', null, 'Проверки'),
    h('label', {class:'fld'}, b1, 'Предупреждать о buf1[12] в выборе (в showChoice() "> " + вариант пишется в char buf1[12] без проверки длины)'),
    h('h3', null, 'Файлы'),
    h('div', {class:'kv'}, 'cpp: ', S.paths.cpp), h('div', {class:'kv'}, 'h: ', S.paths.h),
    h('div', {class:'kv'}, 'портреты: ', (S.paths.gfx || []).join(', '), ` — найдено .inc: ${S.paths.incFound}, персонажей с портретами: ${Object.keys(S.portraits).length}`),
    h('div', {class:'modal-foot'},
      h('button', {class:'btn', onclick: async () => { const j = await api('/api/rescan', {}); toast(`Найдено .inc: ${j.incFound}`); closeModal(); loadAll(); }}, 'Пересканировать портреты'),
      h('button', {class:'btn primary', onclick: () => { closeModal(); renderEditor(); }}, 'Готово'))));
}
function openIssues() {
  const iss = collectIssues().filter(x => x.lvl !== 'info');
  modal(h('div', null, h('h2', null, `Проблемы: ${iss.length}`),
    h('div', {style:'display:flex;flex-direction:column;gap:3px'}, iss.slice(0, 400).map(x =>
      h('a', {href:'#', class:'iss ' + x.lvl, style:'text-decoration:none', onclick: e => { e.preventDefault(); closeModal(); select(x.D.name, x.i); }},
        `${x.lvl === 'err' ? '✕' : '⚠'} ${x.D.name} #${x.i}: ${x.msg}`))),
    h('div', {class:'modal-foot'}, h('button', {class:'btn', onclick: closeModal}, 'Закрыть'))));
}

// ============================================================ play-through
let play = null;
function openPlay() {
  if (!S.cur) return;
  const D = S.cur.D;
  materialize(D);
  play = { D, i: 0, log: [] };
  const startSel = h('select', {onchange: e => { play.i = +e.target.value; play.log = []; playRun(); }},
    D.phrases.map((p, i) => h('option', {value:i}, phraseLabel(D, i))));
  modal(h('div', {class:'play'},
    h('h2', null, `Прогон ${D.name}`),
    h('label', {class:'fld'}, 'старт с фразы:', startSel),
    h('div', {id:'playStage'}),
    h('div', {class:'play-log', id:'playLog'}),
    h('div', {class:'modal-foot'}, h('button', {class:'btn', onclick: closeModal}, 'Закрыть'))));
  playRun();
}
function playCanvas(D, p, pick, cv) {
  cv = cv || h('canvas', {class:'gba-cv'});
  const redraw = () => GBA.draw(cv, GBA.sceneFor(p, { ...sceneOpts(D, p), pick, full:true }), 2, redraw);
  redraw();
  return cv;
}
function playGoto(i, why) { if (why) play.log.push(why); play.i = i; playRun(); }
function playRun() {
  if (!play) return;
  const { D } = play;
  const stage = $('#playStage'); if (!stage) return;
  const btn = (l, fn, cls='btn') => h('button', {class:cls, onclick: fn}, l);
  let guard = 0;
  while (guard++ < 300) {
    const i = play.i, p = D.phrases[i];
    stage.innerHTML = '';
    $('#playLog').innerHTML = play.log.slice(-60).map(s => s.replace(/</g, '&lt;')).join('<br>');
    $('#playLog').scrollTop = 1e9;
    if (!p) { stage.append(h('div', {class:'iss err'}, `Фраза #${i} не существует — движок прочитает мусор за концом массива.`)); return; }
    const k = kindOf(p), f = p.f, op = f[F.op];
    const idxOf = fi => { const r = p.refs[fi]; return r === 'START' ? 0 : D.phrases.findIndex(q => q.uid === r); };
    if (k === 'text') {
      const cid = portraitChar(D, p);
      stage.append(playCanvas(D, p, 0),
        h('div', {class:'play-btns'}, btn('A ▸ далее', () => playGoto(i + 1, `#${i} ${f[F.name]}: ${f[F.text]}`), 'btn primary')));
      return;
    }
    if (k === 'choice') {
      const opts = [[f[F.text], F.c9, null], [f[F.a0], F.c0, null]];
      if (f[F.chk1] !== -2) opts.push([f[F.a1], F.c1, f[F.chk1] === -1 ? null : `${STATS[f[F.chk1]] || '?'} ${f[F.equ1] > 200 ? '<' + (f[F.equ1] - 200) : '>' + f[F.equ1]}`]);
      if (f[F.chk2] !== -2 && f[F.chk1] !== -2) opts.push([f[F.a2], F.c2, f[F.chk2] === -1 ? null : `${STATS[f[F.chk2]] || '?'} ${f[F.equ2] > 200 ? '<' + (f[F.equ2] - 200) : '>' + f[F.equ2]}`]);
      const cv = playCanvas(D, p, 0);
      stage.append(cv,
        h('div', {class:'play-btns'}, opts.map((o, k) => {
          const b = btn((o[0] || '(пусто)') + (o[2] ? `  [${o[2]}]` : ''), () => playGoto(idxOf(o[1]), `#${i} выбор: ${o[0]}`));
          b.addEventListener('mouseenter', () => playCanvas(D, p, k, cv));
          return b;
        })));
      return;
    }
    const d = OPS[op] || { n:'op ' + op };
    if (op === -1) {
      const t = idxOf(3);
      stage.append(h('div', {class:'iss'}, `■ Конец диалога (#${i}). Следующий разговор начнётся с #${t}.`),
        h('div', {class:'play-btns'}, btn(`Поговорить снова (с #${t})`, () => playGoto(t, `— конец, phrase = ${f[3]} —`), 'btn primary')));
      return;
    }
    if (op === -21) { play.log.push(`#${i} переход → #${idxOf(3)}`); play.i = idxOf(3); continue; }
    if (d.k === 'jump' && op !== -6) {
      const tf = d.p.find(x => x.t === 'ref').f, t = idxOf(tf);
      const desc = d.p.filter(x => x.t !== 'ref').map(x => `${x.l}: ${f[x.f]}`).join(', ');
      stage.append(h('div', {class:'iss'}, `⚙ #${i} ${d.n}${desc ? ' (' + desc + ')' : ''}`),
        h('div', {class:'play-btns'},
          btn(op === -19 ? `Денег не хватает → #${t}` : `Условие выполнено → #${t}`, () => playGoto(t, `#${i} ${d.n}: да → #${t}`), 'btn primary'),
          btn(op === -19 ? `Хватает → #${i + 1}` : `Нет → #${i + 1}`, () => playGoto(i + 1, `#${i} ${d.n}: нет`))));
      return;
    }
    if (d.k === 'end') {
      stage.append(h('div', {class:'iss'}, `■ #${i} ${d.n} — диалог закрывается.`));
      return;
    }
    if (op === -12 || op === -23) {
      stage.append(h('div', {class:'iss'}, `⚙ #${i} ${d.n} (${f[3]}, ${f[4]}) — ждёт нажатия A`),
        h('div', {class:'play-btns'}, btn('A ▸ далее', () => playGoto(i + 1, `#${i} ${d.n}`), 'btn primary')));
      return;
    }
    play.log.push(`#${i} ⚙ ${d.n} ${d.p.map(x => f[x.f]).join(', ')}`);
    play.i = op === -3 ? i + 2 : i + 1;
  }
  stage.innerHTML = ''; stage.append(h('div', {class:'iss err'}, 'Похоже на бесконечный цикл из действий.'));
}

// ============================================================ wiring
function setupSidebar() {
  const w = store.get('sideW', 330);
  document.documentElement.style.setProperty('--sideW', w + 'px');
  $('#sidebar').style.width = w + 'px';
  if (store.get('sideHidden', false)) document.body.classList.add('side-hidden');
  $('#btnSidebar').onclick = toggleSidebar;
  const rz = $('#sideResizer');
  rz.addEventListener('mousedown', e => {
    e.preventDefault();
    const move = ev => { const nw = Math.max(220, Math.min(640, ev.clientX)); $('#sidebar').style.width = nw + 'px'; document.documentElement.style.setProperty('--sideW', nw + 'px'); store.set('sideW', nw); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
}
function toggleSidebar() { document.body.classList.toggle('side-hidden'); store.set('sideHidden', document.body.classList.contains('side-hidden')); }

function setup() {
  S.open = new Set(store.get('open', []));
  S.settings = Object.assign(S.settings, store.get('settings', {}));
  setupSidebar();
  $('#btnSave').onclick = () => save();
  $('#btnReload').onclick = () => { if ((S.dirty.size || S.structDirty) && !confirm('Несохранённые изменения пропадут. Перечитать файлы?')) return; loadAll(); };
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnSettings').onclick = openSettings;
  $('#btnPlay').onclick = openPlay;
  $('#issuesBadge').onclick = openIssues;
  $('#btnAddMission').onclick = addMission;
  $('#btnCollapseAll').onclick = () => { S.open.clear(); if (S.cur) S.open.add(S.cur.m.name); store.set('open', []); renderTree(); };
  let st = null;
  $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { S.search = e.target.value.trim(); renderTree(); if (S.cur) renderEditor(); }, 160); });
  $$('#statusFilter .chip').forEach(b => b.onclick = () => {
    S.filter = b.dataset.f; $$('#statusFilter .chip').forEach(x => x.classList.toggle('on', x === b)); renderTree();
  });
  addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
    else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !isTyping(e)) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !isTyping(e)) { e.preventDefault(); redo(); }
    else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); stepDialogue(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Escape') { hidePopover(); if (!$('#modal').hidden) closeModal(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); if (document.body.classList.contains('side-hidden')) toggleSidebar(); $('#search').focus(); $('#search').select(); }
  });
  // native textarea/input undo is fine while typing; our undo works outside of fields
  function isTyping(e) { const t = e.target; return t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text')); }
  addEventListener('hashchange', () => { const n = decodeURIComponent(location.hash.slice(1)); if (n && (!S.cur || S.cur.name !== n)) select(n); });
  addEventListener('beforeunload', e => { if (S.dirty.size || S.structDirty) { e.preventDefault(); e.returnValue = ''; } });
  // datalist with all known names
  document.body.append(h('datalist', {id:'names-dl'}));
  loadAll().then(fillNames).catch(e => { $('#empty').innerHTML = ''; $('#empty').append(h('div', {class:'empty-title'}, 'Не удалось загрузить диалоги'), h('div', {class:'empty-sub'}, e.message)); });
}
function fillNames() {
  const set = new Set(S.chars);
  for (const { D } of allDialogues()) for (const p of D.phrases) if (kindOf(p) === 'text' && p.f[0]) set.add(p.f[0]);
  const dl = $('#names-dl'); dl.innerHTML = '';
  [...set].sort().forEach(n => dl.append(h('option', {value:n})));
}
setup();
