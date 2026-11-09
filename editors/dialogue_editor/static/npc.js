// ============================================================ Вкладка «NPC»: колесо взаимодействий (project/src/interactions.cpp)
// Уровень колеса = 4 записи подряд (↑ → ↓ ←). Корень - записи 0..3; подменю (does 0) указывает attr
// на первую из своих четырёх. Сервер генерирует файл целиком (incore.py).

const NP = { st: null, m: null, orig: '', lvl: 0, sel: 0, trail: [], code: false, busy: false, iconImg: null, iconUrl: {}, pick: false };
const NP_DIRS = ['↑', '→', '↓', '←'];
const NP_DOES = { 0: 'подменю', 1: 'список', 2: 'действие' };
const npDirty = () => NP.m && JSON.stringify(NP.m) !== NP.orig;

async function openNpc() {
  $('#npc').hidden = false;
  if (!NP.st) await npLoad(); else npRender();
}

async function npLoad() {
  try {
    const st = await api('/api/npc/state');
    if (st.error) throw new Error(st.error);
    npIngest(st);
  } catch (e) {
    const root = $('#npc'); root.innerHTML = '';
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Не удалось загрузить колесо'), h('div', { class: 'empty-sub' }, e.message)));
  }
}

function npIngest(st) {
  NP.st = st; NP.m = st.model; NP.orig = JSON.stringify(st.model);
  NP.iconImg = null; NP.iconUrl = {};
  if (NP.sel >= NP.m.npc.length) NP.sel = 0;
  npRender();
}

// ---- иконки: 16x16 из листа спрайтов (тайл 512 + n), n чётное, ряды иконок через один ряд тайлов
function npIcon(n) {
  const I = NP.st.icons; if (!I) return null;
  if (NP.iconUrl[n] !== undefined) return NP.iconUrl[n];
  if (!NP.iconImg) {
    const c = document.createElement('canvas'); c.width = I.w; c.height = I.h;
    const raw = Uint8ClampedArray.from(atob(I.rgba), ch => ch.charCodeAt(0));
    c.getContext('2d').putImageData(new ImageData(raw, I.w, I.h), 0, 0);
    NP.iconImg = c;
  }
  const x = (n % I.perRow) * 8, y = Math.floor(n / I.perRow) * 8;
  if (y + 16 > I.h || n < 0) return (NP.iconUrl[n] = null);
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const g = c.getContext('2d'); g.drawImage(NP.iconImg, x, y, 16, 16, 0, 0, 16, 16);
  const px = g.getImageData(0, 0, 16, 16).data; let any = false;
  for (let k = 3; k < px.length; k += 4) if (px[k]) { any = true; break; }
  return (NP.iconUrl[n] = any ? c.toDataURL() : '');
}
const npIconEl = (n, size = 32) => { const u = npIcon(n); return u ? h('img', { class: 'np-ico', src: u, width: size, height: size, alt: n }) : h('span', { class: 'np-ico none', style: `width:${size}px;height:${size}px` }, '?'); };
function npIconList() {
  const I = NP.st.icons; if (!I) return [];
  const out = [];
  for (let r = 0; r * 16 + 16 <= I.h; r++) for (let c = 0; c < I.perRow / 2; c++) { const n = r * 2 * I.perRow + c * 2; if (npIcon(n)) out.push(n); }
  return out;
}

// ---- обработчики и подписи
const npHandler = e => NP.st.handlers.find(x => x.does === e.does && x.attr === e.attr);
function npSlots() {   // путь каждой записи в колесе (как incore.slots), null - недостижима
  const npc = NP.m.npc, lab = npc.map(() => null);
  const walk = (off, path, seen) => {
    if (seen.has(off)) return; seen = new Set(seen); seen.add(off);
    for (let d = 0; d < 4; d++) {
      const i = off + d; if (i >= npc.length) continue;
      lab[i] = (path ? path + ' ' : '') + NP_DIRS[d] + ' ' + npc[i].name;
      if (npc[i].does === 0) walk(npc[i].attr, lab[i], seen);
    }
  };
  walk(0, '', new Set());
  return lab;
}
function npIssues(e) {
  const out = [];
  if (!e.name || e.name.length > NP.st.nameMax || /[^\x20-\x7e]/.test(e.name)) out.push(['err', `имя: 1..${NP.st.nameMax} символов, только ASCII`]);
  if (e.does === 0 && (e.attr < 0 || e.attr + 3 >= NP.m.npc.length)) out.push(['err', `подменю с записи ${e.attr}, а записей ${NP.m.npc.length}`]);
  if (e.does !== 0 && !npHandler(e)) {
    if (e.does === 1 && e.attr >= 0 && e.attr < NP.st.subjects.length) out.push(['warn', 'список из listSubjects есть, но игра не знает, что делать с выбором: executeInteractionEffect ответит «Shiiiiiiit»']);
    else out.push(['warn', 'игра не знает такое действие — нужен код в player_interaction.cpp']);
  }
  const hd = npHandler(e);
  if (hd && /нет обработчика/.test(hd.code)) out.push(['warn', hd.code]);
  if (e.does === 1 && ![15, 50].includes(e.attr) && e.attR <= 0) out.push(['warn', 'пустой список (attR = 0): в игре откроется список без пунктов']);
  if (!e.locked && out.some(x => x[0] === 'warn')) out.push(['warn', 'запись открыта: в игре её можно выбрать — лучше заблокировать, пока нет кода']);
  return out;
}
function npLine(e) {
  const q = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return `{ ${q(e.name)}, ${e.icon}, ${e.does}, ${e.attr}, ${e.attR}, ${e.locked ? 'true' : 'false'} },`;
}

// ------------------------------------------------------------ отрисовка
function npRender() {
  const root = $('#npc'); root.innerHTML = '';
  if (!NP.m) return;
  const npc = NP.m.npc, locked = npc.filter(e => e.locked).length;
  root.append(h('div', { class: 'np' },
    h('div', { class: 'gr-bar' },
      h('b', null, 'Колесо взаимодействий с NPC'),
      h('span', { class: 'tl-hint' }, `${npc.length} записей · ${locked} заблокировано · src/interactions.cpp`),
      h('div', { class: 'spacer' }),
      h('button', { class: 'chip' + (NP.code ? ' on' : ''), onclick: () => { NP.code = !NP.code; npRender(); } }, '</> весь файл'),
      h('button', { class: 'btn', onclick: npReload }, '⟳ С диска'),
      h('button', { class: 'btn primary' + (npDirty() ? ' dirty' : ''), disabled: !npDirty() || NP.busy, onclick: () => npSave(), title: 'Записать interactions.cpp (Ctrl+S)' }, 'Сохранить')),
    h('div', { class: 'np-body' }, npRenderTree(), h('div', { class: 'np-center' }, npRenderWheel(), NP.code ? npRenderFile() : null), npRenderInspector())));
  if (NP.code) npPreview();
}

function npRenderTree() {
  const npc = NP.m.npc, lab = npSlots(), list = h('div', { class: 'np-tree' });
  const row = (i, depth) => {
    const e = npc[i];
    return h('div', { class: 'np-row' + (i === NP.sel ? ' sel' : '') + (e.locked ? ' locked' : ''), style: `padding-left:${8 + depth * 16}px`,
      'data-i': i, onclick: () => { if (i - (i % 4) === NP.lvl) npSelect(i); else npGoTo(i); },
      ondblclick: () => { if (e.does === 0) npOpenSub(i); }, title: e.does === 0 ? 'Двойной клик — открыть подменю' : '' },
      h('span', { class: 'np-dir' }, NP_DIRS[i % 4]), npIconEl(e.icon, 16), h('span', { class: 'np-name' }, e.name),
      e.locked ? h('span', { title: 'заблокировано' }, '🔒') : null,
      h('span', { class: 'np-badge d' + e.does }, NP_DOES[e.does] || e.does));
  };
  const walk = (off, depth, seen) => {
    if (seen.has(off)) return; seen = new Set(seen); seen.add(off);
    for (let d = 0; d < 4; d++) {
      const i = off + d; if (i >= npc.length) continue;
      list.append(row(i, depth));
      if (npc[i].does === 0) walk(npc[i].attr, depth + 1, seen);
    }
  };
  walk(0, 0, new Set());
  const lost = npc.map((_, i) => i).filter(i => !lab[i]);
  if (lost.length) { list.append(h('div', { class: 'tl-note' }, 'недостижимые записи')); lost.forEach(i => list.append(row(i, 0))); }
  return h('aside', { class: 'np-side' }, list,
    h('div', { class: 'side-foot' }, h('span', { class: 'tl-hint' }, 'Клик — открыть уровень с записью. Иконки — из images/mss-01.bmp.')));
}

// открыть уровень, где лежит запись i, и выбрать её
function npGoTo(i) {
  const npc = NP.m.npc, lvl = i - (i % 4), trail = [];
  // путь от корня до уровня lvl (через подменю)
  const find = (off, path, seen) => {
    if (off === lvl) return path;
    if (seen.has(off)) return null; seen = new Set(seen); seen.add(off);
    for (let d = 0; d < 4; d++) { const k = off + d; if (k < npc.length && npc[k].does === 0) { const r = find(npc[k].attr, [...path, k], seen); if (r) return r; } }
    return null;
  };
  NP.trail = find(0, [], new Set()) || trail;
  NP.lvl = lvl; NP.sel = i; npRender();
}

function npRenderWheel() {
  const npc = NP.m.npc, base = NP.lvl;
  const crumbs = [h('a', { onclick: () => { NP.lvl = 0; NP.trail = []; NP.sel = 0; npRender(); } }, 'корень')];
  NP.trail.forEach((k, j) => { crumbs.push(' › ', h('a', { onclick: () => { NP.lvl = npc[k].attr; NP.trail = NP.trail.slice(0, j + 1); NP.sel = NP.lvl; npRender(); } }, npc[k].name)); });
  const card = d => {
    const i = base + d, e = npc[i]; if (!e) return h('div', { class: 'np-card empty' }, '—');
    return h('div', { class: 'np-card pos' + d + (i === NP.sel ? ' sel' : '') + (e.locked ? ' locked' : ''), 'data-i': i, onclick: () => npSelect(i),
      ondblclick: () => { if (e.does === 0) npOpenSub(i); }, title: e.does === 0 ? 'Двойной клик — открыть подменю' : '' },
      h('div', { class: 'np-card-dir' }, NP_DIRS[d]), npIconEl(e.icon, 32),
      h('div', { class: 'np-card-name' }, e.name), e.locked ? h('div', { class: 'np-lock' }, '🔒') : null,
      h('div', { class: 'np-card-sub' }, e.does === 0 ? 'подменю ▸' : e.does === 1 ? `список (${npListItems(e).length})` : 'действие'));
  };
  return h('div', { class: 'np-wheel-box' },
    h('div', { class: 'np-crumbs' }, crumbs, h('span', { class: 'tl-hint' }, `  ·  записи ${base}–${base + 3}`)),
    h('div', { class: 'np-wheel' }, card(0), card(1), card(2), card(3),
      h('div', { class: 'np-hub' }, NP.trail.length ? h('button', { class: 'btn small', onclick: () => { const k = NP.trail.pop(); NP.lvl = NP.trail.length ? npc[NP.trail[NP.trail.length - 1]].attr : 0; NP.sel = k; npRender(); } }, '◂ назад (B)') : h('span', { class: 'tl-hint' }, 'корень колеса'))),
    h('div', { class: 'tl-hint' }, 'Так колесо выглядит в игре: крестовина выбирает направление, A — открыть, B — назад. Двойной клик по подменю — войти.'));
}

// Выбор записи без перерисовки всего экрана: иначе первый клик заменяет элементы,
// и второй клик двойного щелчка уходит в пустоту (подменю не открывалось)
function npSelect(i) {
  if (NP.sel === i) return;
  NP.sel = i;
  $$('#npc .np-card, #npc .np-row').forEach(el => el.classList.toggle('sel', +el.dataset.i === i));
  const old = $('#npc .np-insp'); if (old) old.replaceWith(npRenderInspector());
}

function npOpenSub(i) { const e = NP.m.npc[i]; NP.trail.push(i); NP.lvl = e.attr; NP.sel = e.attr; npRender(); }

function npListItems(e) {
  if (e.does !== 1) return [];
  const hd = npHandler(e);
  if (hd && e.attr === 50) return ['(группы из groups.cpp, кроме NONE)'];
  if (hd && e.attr === 15) return NP.st.subjects.slice(15, 15 + 9).filter(Boolean).map(s => s + ' (если открыто)');
  return NP.st.subjects.slice(e.attr, e.attr + e.attR);
}

function npRenderInspector() {
  const e = NP.m.npc[NP.sel]; if (!e) return h('aside', { class: 'np-insp' });
  const i = NP.sel, lab = npSlots()[i];
  const set = (k, v, re = true) => { e[k] = v; if (re) npRender(); else npTouch(); };
  const handlers = NP.st.handlers.filter(x => x.does === e.does);
  const hd = npHandler(e);
  const issues = npIssues(e);
  const numIn = (k, title) => h('input', { type: 'number', value: e[k], title, onchange: ev => set(k, parseInt(ev.target.value, 10) || 0) });
  let typeBox;
  if (e.does === 0) {
    const subs = [];
    for (let k = 4; k + 3 < NP.m.npc.length; k += 4) subs.push(k);
    typeBox = h('div', { class: 'np-f' },
      h('label', null, 'подменю — записи ', h('select', { onchange: ev => set('attr', +ev.target.value) },
        subs.map(k => h('option', { value: k, selected: k === e.attr }, `${k}–${k + 3}: ${NP.m.npc.slice(k, k + 4).map(x => x.name).join(' / ')}`)))),
      h('div', { class: 'np-btns' },
        h('button', { class: 'btn small', onclick: () => npOpenSub(i) }, 'открыть ▸'),
        h('button', { class: 'btn small', onclick: () => npNewSub(i), title: '4 новые записи в конец таблицы (заблокированные) и сделать их подменю этой записи' }, '+ новое подменю')));
  } else {
    const known = handlers.map(x => h('option', { value: x.attr, selected: hd && hd.attr === x.attr }, `${x.attr}: ${x.label}`));
    typeBox = h('div', { class: 'np-f' },
      h('label', null, e.does === 1 ? 'список ' : 'действие ', h('select', { onchange: ev => { if (ev.target.value !== '') set('attr', +ev.target.value); } },
        known, h('option', { value: '', selected: !hd }, hd ? 'другое (число ниже)…' : `своё: ${e.attr}`))),
      h('div', { class: 'np-nums' }, h('label', null, 'attr ', numIn('attr', e.does === 1 ? 'смещение в listSubjects / номер спец-списка' : 'код действия')),
        e.does === 1 ? h('label', null, 'attR ', numIn('attR', 'сколько пунктов в списке')) : null),
      e.does === 1 ? h('div', { class: 'np-list' }, npListItems(e).map(s => h('span', null, s || '(пусто)'))) : null);
  }
  return h('aside', { class: 'np-insp' },
    h('div', { class: 'np-insp-h' }, npIconEl(e.icon, 32), h('div', null, h('div', { class: 'tl-idx big' }, `#${i}`), h('div', { class: 'tl-hint' }, lab || 'недостижима из корня'))),
    h('button', { class: 'np-lockbtn' + (e.locked ? ' on' : ''), onclick: () => set('locked', !e.locked), title: 'В игре заблокированное: звук «нельзя». Тип и параметры не теряются.' },
      e.locked ? '🔒 Заблокировано — нажмите, чтобы открыть' : '🔓 Открыто — нажмите, чтобы заблокировать'),
    h('label', { class: 'np-f' }, 'Название в игре', h('input', { class: 'gr-in', value: e.name, maxlength: NP.st.nameMax, oninput: ev => { e.name = ev.target.value; npTouch(); } , onchange: () => npRender() })),
    h('div', { class: 'np-f' }, h('span', null, 'Иконка ', h('b', null, e.icon)),
      h('button', { class: 'btn small', onclick: () => { NP.pick = !NP.pick; npRender(); } }, NP.pick ? 'скрыть' : 'выбрать…'),
      NP.pick ? h('div', { class: 'np-icons' }, npIconList().map(n => h('button', { class: 'np-icon-btn' + (n === e.icon ? ' on' : ''), title: n, onclick: () => { e.icon = n; NP.pick = false; npRender(); } }, npIconEl(n, 32)))) : null),
    h('label', { class: 'np-f' }, 'Тип ', h('select', { onchange: ev => set('does', +ev.target.value) },
      [0, 1, 2].map(d => h('option', { value: d, selected: d === e.does }, NP_DOES[d])))),
    typeBox,
    h('label', { class: 'np-f' }, 'Комментарий', h('input', { class: 'gr-in', value: e.note || '', oninput: ev => { e.note = ev.target.value; npTouch(); } })),
    h('div', { class: 'tl-issues' }, issues.map(([c, m]) => h('div', { class: 'tl-issue ' + c }, (c === 'err' ? '⛔ ' : '⚠ ') + m))),
    h('div', { class: 'np-code' },
      h('div', { class: 'tl-hint' }, 'Строка в interactions.cpp'),
      h('pre', null, npLine(e) + `  // [${i} ${lab || 'недостижима'}]`),
      h('div', { class: 'tl-hint' }, 'Где обрабатывается'),
      h('pre', null, e.does === 0 ? `player_interaction.cpp: updateDpadChoice — does 0: interactOffset = attr (${e.attr}), колесо перерисуется с записей ${e.attr}–${e.attr + 3}`
        : hd ? hd.code : `нет обработчика для does ${e.does}, attr ${e.attr}`)));
}

function npTouch() { const b = $('.np .gr-bar .btn.primary'); if (b) { b.disabled = !npDirty(); b.classList.toggle('dirty', npDirty()); } }

function npNewSub(i) {
  const e = NP.m.npc[i], k = NP.m.npc.length;
  for (let d = 0; d < 4; d++) NP.m.npc.push({ name: 'NEW', icon: e.icon, does: 2, attr: 0, attR: 0, locked: true, note: '' });
  e.does = 0; e.attr = k;
  npOpenSub(i);
}

let npPrevTimer = null;
function npRenderFile() { return h('pre', { class: 'np-file', id: 'npFile' }, '…'); }
function npPreview() {
  clearTimeout(npPrevTimer);
  npPrevTimer = setTimeout(async () => {
    try { const r = await api('/api/npc/preview', { model: NP.m }); const el = $('#npFile'); if (el) el.textContent = (r.errors.length ? '// ОШИБКИ: ' + r.errors.join('; ') + '\n\n' : '') + r.code; } catch (e) { /* предпросмотр - не критично */ }
  }, 150);
}

async function npReload() {
  if (npDirty() && !confirm('Есть несохранённые правки колеса. Перечитать с диска и потерять их?')) return;
  NP.st = null; await npLoad(); toast('Перечитано с диска');
}

async function npSave(force) {
  if (!npDirty()) return;
  NP.busy = true;
  try {
    const st = await api('/api/npc/save', { hash: NP.st.hash, model: NP.m, force: !!force });
    npIngest(st);
    toast(st.changed ? 'interactions.cpp сохранён' : 'Без изменений', 'ok');
  } catch (e) {
    if (e.status === 409 && confirm(e.message + '\n\nПерезаписать своими правками?')) { NP.busy = false; return npSave(true); }
    toast('Не сохранено: ' + e.message, 'err');
  } finally { NP.busy = false; if (NP.m) npRender(); }
}

addEventListener('keydown', e => {
  if (typeof TABS === 'undefined' || TABS.cur !== 'npc') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); npSave(); }
});
addEventListener('beforeunload', e => { if (npDirty()) { e.preventDefault(); e.returnValue = ''; } });
