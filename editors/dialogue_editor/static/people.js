// ============================================================ Вкладка «Персонажи» (project/src/personality.h/.cpp)
// Ask about: ответы персонажей по темам и ярусам (не хочет / неохотно / с удовольствием) + пороги тем.
// Романтика: пол, ориентация, партнёр, влюблённости, флаги.

const PE = { st: null, m: null, orig: '', sub: store.get('pe.sub', 'tpl'), who: store.get('pe.who', -1), filter: '', busy: false };
const PE_LIKE = { 0: '😠', 1: '🙁', 2: '😐', 3: '🙂', 4: '❤' };
const peDirty = () => PE.m && JSON.stringify(PE.m) !== PE.orig;
const peName = c => (PE.st.names[c] || '?');
const peGroup = c => PE.st.groups.names[PE.st.groups.of[c]] || '';

async function openPeople() {
  $('#people').hidden = false;
  if (!PE.st) await peLoad(); else peRender();
}

async function peLoad() {
  try {
    const st = await api('/api/people/state');
    if (st.error) throw new Error(st.error);
    peIngest(st);
  } catch (e) {
    const root = $('#people'); root.innerHTML = '';
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Не удалось загрузить персонажей'), h('div', { class: 'empty-sub' }, e.message)));
  }
}

function peIngest(st) { PE.st = st; PE.m = st.model; PE.orig = JSON.stringify(st.model); peRender(); }

function peRender() {
  const root = $('#people'); root.innerHTML = '';
  if (!PE.m) return;
  const sub = (k, label) => h('button', { class: 'tab' + (PE.sub === k ? ' on' : ''), onclick: () => { PE.sub = k; store.set('pe.sub', k); peRender(); } }, label);
  const body = { tpl: peRenderTemplates, hobby: peRenderHobbies, music: peRenderMusic, place: peRenderPlaces, meal: () => peRenderList('meals', 'Любимая еда'),
    dream: () => peRenderList('dreams', 'Мечты'), love: peRenderLove }[PE.sub] || peRenderTemplates;
  root.append(h('div', { class: 'gr' },
    h('div', { class: 'gr-bar' },
      h('span', { class: 'tl-hint' }, 'Ask about:'),
      sub('tpl', '🧩 Шаблоны и пороги'), sub('hobby', '🎯 Хобби'), sub('music', '🎵 Музыка'), sub('place', '📍 Места'),
      sub('meal', '🍩 Еда'), sub('dream', '✨ Мечты'),
      h('span', { class: 'pe-sep' }), sub('love', '💘 Романтика'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: peReload }, '⟳ С диска'),
      h('button', { class: 'btn primary' + (peDirty() ? ' dirty' : ''), disabled: !peDirty() || PE.busy, onclick: () => peSave(), title: 'Записать personality.h / .cpp (Ctrl+S)' }, 'Сохранить')),
    h('div', { class: 'gr-body' }, body())));
}

function peTouch() { const b = $('#people .gr-bar .btn.primary'); if (b) { b.disabled = !peDirty(); b.classList.toggle('dirty', peDirty()); } }

const peBadText = (v, max) => v.length > max || /[^\x20-\x7e]/.test(v) || v.includes('%');
function peInput(get, set, { max, placeholder = '', wide = false, allowPct = false } = {}) {
  const el = h('input', { class: 'gr-in' + (wide ? ' wide' : ''), value: get(), placeholder, maxlength: max,
    oninput: e => { set(e.target.value); el.classList.toggle('bad', allowPct ? (e.target.value.length > max || /[^\x20-\x7e]/.test(e.target.value)) : peBadText(e.target.value, max)); peTouch(); } });
  return el;
}
const peSearch = () => h('input', { type: 'search', class: 'gr-search', placeholder: 'Персонаж или группа…', value: PE.filter,
  oninput: e => { PE.filter = e.target.value; const st = e.target.selectionStart; peRender(); const n = $('#people .gr-search'); n.focus(); n.setSelectionRange(st, st); } });
const peShown = c => { const q = PE.filter.trim().toLowerCase(); return !q || peName(c).toLowerCase().includes(q) || peGroup(c).toLowerCase().includes(q); };
const peWho = c => h('th', null, h('span', { class: 'tl-idx' }, c), ' ', peName(c), h('div', { class: 'tl-hint' }, peGroup(c) || '—'));
const pePreview = (topic, tier, what) => (PE.m.templates[topic][tier] || '').replace('%s', what);

// ---- шаблоны и пороги
function peRenderTemplates() {
  const lim = PE.st.textMax - PE.st.itemMax + 2;
  return h('div', null,
    h('div', { class: 'tl-hint', style: 'margin-bottom:8px' }, `Ответ = шаблон яруса, «%s» заменяется на любимое персонажа (хобби — любимая тема разговора). Ярус — по «отношению»: relationLVLS (5 звёзд = 100) + бонус группы ±15; если группа к Вике враждебна — на ярус ниже. Шаблон с «%s» — до ${lim} символов, ASCII.`),
    h('table', { class: 'gr-phr' },
      h('tr', null, h('th', null, 'тема'), h('th', null, 'неохотно с / с удовольствием с'), PE.st.tiers.map(t => h('th', null, t))),
      PE.st.askTopics.map((t, k) => h('tr', null, h('th', null, t),
        h('td', null, ['reluctant', 'happy'].map(f => h('input', { class: 'gr-in num', type: 'number', value: PE.m.rules[k][f], oninput: e => { PE.m.rules[k][f] = parseInt(e.target.value, 10) || 0; peTouch(); } }))),
        [0, 1, 2].map(tier => h('td', null, peInput(() => PE.m.templates[k][tier], v => { PE.m.templates[k][tier] = v; }, { max: tier ? lim : PE.st.textMax, wide: true, allowPct: true, placeholder: tier ? 'с «%s»' : 'без «%s»' })))))));
}

// ---- хобби: только показываем - берутся из тем разговора
function peRenderHobbies() {
  const rows = PE.st.names.map((n, c) => {
    if (!peShown(c)) return null;
    const likes = PE.st.likes[c] || [];
    let fav = []; for (const want of [4, 3]) { if (!fav.length) fav = PE.st.topics.map((t, k) => (likes[k] === want && t) ? t : null).filter(Boolean); }
    return h('tr', null, peWho(c),
      h('td', null, PE.st.topics.map((t, k) => t && likes[k] !== undefined ? h('span', { class: 'pe-like', 'data-v': likes[k] }, PE_LIKE[likes[k]] + ' ' + t) : null)),
      h('td', { class: 'pe-say' }, fav.length ? pePreview(0, 2, fav[0]) + (fav.length > 1 ? `  (или: ${fav.slice(1).join(', ')})` : '') : '— «Hmm... nothing comes to mind, really.»'));
  });
  return h('div', null, h('div', { class: 'gr-tools' }, peSearch(), h('span', { class: 'tl-hint' }, 'Хобби не хранятся: персонаж называет тему разговора, которую обожает (❤), а если таких нет — которая нравится (🙂). Меняется в редакторе диалогов (отношение к темам).')),
    h('table', { class: 'gr-phr' }, h('tr', null, h('th', null, 'персонаж'), h('th', null, 'темы разговора'), h('th', null, 'скажет «с удовольствием»')), rows));
}

// ---- музыка
function peRenderMusic() {
  const rows = PE.st.names.map((n, c) => !peShown(c) ? null : h('tr', null, peWho(c),
    h('td', null, peInput(() => PE.m.chars[c].music, v => { PE.m.chars[c].music = v; }, { max: PE.st.itemMax, wide: true, placeholder: 'например: punk rock' })),
    h('td', { class: 'pe-say' }, PE.m.chars[c].music ? pePreview(1, 2, PE.m.chars[c].music) : '—')));
  return h('div', null, h('div', { class: 'gr-tools' }, peSearch(), h('span', { class: 'tl-hint' }, `Строчными, до ${PE.st.itemMax} символов, ASCII.`)),
    h('table', { class: 'gr-phr' }, h('tr', null, h('th', null, 'персонаж'), h('th', null, 'любимая музыка'), h('th', null, 'скажет «с удовольствием»')), rows));
}

// ---- места: общий список + до двух любимых у персонажа
function peRenderPlaces() {
  const P = PE.m.places;
  const list = h('div', { class: 'tl-block pe-places' }, h('b', null, 'Места в игре'), h('span', { class: 'tl-hint' }, ' — так их называют персонажи (с артиклем, если нужен)'),
    h('div', { class: 'pe-place-list' }, P.map((p, k) => h('div', { class: 'pe-place' }, h('span', { class: 'tl-idx' }, k),
      peInput(() => P[k], v => { P[k] = v; }, { max: PE.st.itemMax }),
      h('button', { class: 'icon-btn', title: 'Удалить место', onclick: () => {
        const used = PE.m.chars.filter(ch => ch.places.includes(k)).length;
        if (used && !confirm(`Место «${p}» любят ${used} перс. Удалить?`)) return;
        P.splice(k, 1); PE.m.chars.forEach(ch => { ch.places = ch.places.filter(x => x !== k).map(x => x > k ? x - 1 : x); }); peRender(); } }, '×')))),
    h('button', { class: 'btn small', onclick: () => { P.push('new place'); peRender(); } }, '+ место'));
  const sel = (c, slot) => h('select', { onchange: e => { const v = +e.target.value, pl = PE.m.chars[c].places; if (v < 0) pl.splice(slot, 1); else pl[slot] = v; PE.m.chars[c].places = pl.filter(x => x >= 0); peRender(); } },
    h('option', { value: -1 }, slot ? '+' : '—'), P.map((p, k) => h('option', { value: k, selected: PE.m.chars[c].places[slot] === k }, p)));
  const rows = PE.st.names.map((n, c) => !peShown(c) ? null : h('tr', null, peWho(c),
    h('td', null, sel(c, 0), PE.m.chars[c].places.length ? sel(c, 1) : null),
    h('td', { class: 'pe-say' }, PE.m.chars[c].places.length ? pePreview(2, 2, P[PE.m.chars[c].places[0]] || '?') : '—')));
  return h('div', null, list, h('div', { class: 'gr-tools' }, peSearch()),
    h('table', { class: 'gr-phr' }, h('tr', null, h('th', null, 'персонаж'), h('th', null, 'любимые места (до двух)'), h('th', null, 'скажет «с удовольствием»')), rows));
}

// ---- еда / мечты: по нескольку вариантов
function peRenderList(key, title) {
  const topic = key === 'meals' ? 3 : 4;
  const rows = PE.st.names.map((n, c) => {
    if (!peShown(c)) return null;
    const L = PE.m.chars[c][key];
    return h('tr', null, peWho(c),
      h('td', null, L.map((v, k) => h('div', { class: 'pe-item' }, peInput(() => L[k], x => { L[k] = x; }, { max: PE.st.itemMax, wide: true }),
        h('button', { class: 'icon-btn', title: 'Удалить', onclick: () => { L.splice(k, 1); peRender(); } }, '×'))),
        L.length < PE.st.maxItems ? h('button', { class: 'btn small ghost', onclick: () => { L.push(''); peRender(); } }, '+ вариант') : null),
      h('td', { class: 'pe-say' }, L.filter(Boolean).length ? pePreview(topic, 2, L.find(Boolean)) : '—'));
  });
  return h('div', null, h('div', { class: 'gr-tools' }, peSearch(), h('span', { class: 'tl-hint' }, `${title}: до ${PE.st.maxItems} вариантов, игра выбирает случайный. До ${PE.st.itemMax} символов, ASCII.` + (key === 'dreams' ? ' Мечты пишутся так, чтобы встали после «I want …»: «to start a band».' : ''))),
    h('table', { class: 'gr-phr' }, h('tr', null, h('th', null, 'персонаж'), h('th', null, title), h('th', null, 'скажет «с удовольствием»')), rows));
}

// ------------------------------------------------------------ Романтика
function peRenderLove() {
  const N = PE.st.names, R = PE.m.romance;
  const charOpts = (sel, extra) => [...extra, ...N.map((n, c) => h('option', { value: c, selected: sel === c }, `${c} ${n}`))];
  const warn = c => {
    const r = R[c], out = [];
    if (r.partner >= 0 && R[r.partner] && R[r.partner].partner !== c) out.push(`${N[r.partner]} не указал(а) ${N[c]} партнёром`);
    if (r.partner === c || r.crush.includes(c)) out.push('сам себе партнёр/влюблённость');
    return out;
  };
  const rows = N.map((n, c) => {
    const r = R[c];
    const ch = () => { peTouch(); };
    const w = warn(c);
    return h('tr', { class: r.flags & 1 ? 'pe-off' : '' },
      h('th', null, h('span', { class: 'tl-idx' }, c), ' ', n, h('div', { class: 'tl-hint' }, peGroup(c))),
      h('td', null, h('select', { onchange: e => { r.gender = +e.target.value; ch(); } }, PE.st.genders.map((g, k) => h('option', { value: k, selected: r.gender === k }, g)))),
      h('td', null, h('select', { onchange: e => { r.orient = +e.target.value; ch(); } }, PE.st.orient.map((g, k) => h('option', { value: k, selected: r.orient === k }, g)))),
      h('td', null, h('select', { onchange: e => { r.partner = +e.target.value; peRender(); } },
        charOpts(r.partner, [h('option', { value: -1, selected: r.partner === -1 }, '— один(одна)'), h('option', { value: -2, selected: r.partner === -2 }, 'занят(а), не из игры')]))),
      h('td', null, h('div', { class: 'pe-crush' }, [0, 1, 2].map(k => (k <= r.crush.length) ? h('select', { onchange: e => { const v = +e.target.value; if (v < 0) r.crush.splice(k, 1); else r.crush[k] = v; peRender(); } },
        charOpts(r.crush[k] ?? -1, [h('option', { value: -1, selected: r.crush[k] === undefined }, k ? '+' : '—')])) : null))),
      h('td', { class: 'pe-flags' }, PE.st.flags.map(([bit, key, label]) => h('label', { title: label },
        h('input', { type: 'checkbox', checked: !!(r.flags & bit), onchange: e => { r.flags = e.target.checked ? r.flags | bit : r.flags & ~bit; peRender(); } }),
        { NO_ROMANCE: '🚫', WONT_DATE_VIKA: '🙅', CHEEK_ONLY: '😚', FAITHFUL: '💍', STORY_LOVE: '📖' }[key] || key))),
      h('td', null, h('input', { class: 'gr-in', value: r.note || '', placeholder: 'заметка', oninput: e => { r.note = e.target.value; ch(); } }),
        w.length ? h('div', { class: 'tl-issue warn' }, '⚠ ' + w.join('; ')) : null));
  });
  return h('div', null,
    h('div', { class: 'tl-hint', style: 'margin-bottom:8px' }, 'Пока только данные: механика флирта (поцелуи, новости о партнёре, ревность) появится следующим шагом. Флаги: ',
      PE.st.flags.map(([, key, label]) => `${{ NO_ROMANCE: '🚫', WONT_DATE_VIKA: '🙅', CHEEK_ONLY: '😚', FAITHFUL: '💍', STORY_LOVE: '📖' }[key]} ${label}`).join(' · ')),
    h('table', { class: 'gr-phr pe-love' },
      h('tr', null, ['персонаж', 'пол', 'ориентация', 'партнёр', 'влюблён(а) в', 'флаги', 'заметка'].map(t => h('th', null, t))),
      rows));
}

// ------------------------------------------------------------ сохранение
async function peReload() {
  if (peDirty() && !confirm('Есть несохранённые правки персонажей. Перечитать с диска и потерять их?')) return;
  PE.st = null; await peLoad(); toast('Перечитано с диска');
}

async function peSave(force) {
  if (!peDirty()) return;
  const m = JSON.parse(JSON.stringify(PE.m));
  m.chars.forEach(c => { c.meals = c.meals.filter(x => x.trim()); c.dreams = c.dreams.filter(x => x.trim()); });
  const bad = m.chars.flatMap(c => [c.music, ...c.meals, ...c.dreams]).concat(m.places).filter(t => peBadText(t, PE.st.itemMax));
  if (bad.length) { toast(`Строк с ошибками: ${bad.length} (длина > ${PE.st.itemMax}, не-ASCII или «%») — исправьте`, 'err'); return; }
  PE.busy = true;
  try {
    const st = await api('/api/people/save', { hash: PE.st.hash, model: m, force: !!force });
    peIngest(st);
    toast(st.changed ? 'personality.h / .cpp сохранены' : 'Без изменений', 'ok');
  } catch (e) {
    if (e.status === 409 && confirm(e.message + '\n\nПерезаписать своими правками?')) { PE.busy = false; return peSave(true); }
    toast('Не сохранено: ' + e.message, 'err');
  } finally { PE.busy = false; if (PE.m) peRender(); }
}

addEventListener('keydown', e => {
  if (typeof TABS === 'undefined' || TABS.cur !== 'people') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); peSave(); }
});
addEventListener('beforeunload', e => { if (peDirty()) { e.preventDefault(); e.returnValue = ''; } });
