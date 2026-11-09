// ============================================================ Вкладка «Персонажи» (project/src/personality.h/.cpp)
// Ask about: ответы персонажей по темам и ярусам (не хочет / неохотно / с удовольствием) + пороги тем.
// Романтика: пол, ориентация, партнёр, влюблённости, флаги.

const PE = { st: null, m: null, orig: '', sub: store.get('pe.sub', 'ask'), who: store.get('pe.who', -1), filter: '', busy: false };
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
  root.append(h('div', { class: 'gr' },
    h('div', { class: 'gr-bar' },
      sub('ask', '❓ Ask about'), sub('love', '💘 Романтика'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'tl-hint' }, 'src/personality.h, personality.cpp'),
      h('button', { class: 'btn', onclick: peReload }, '⟳ С диска'),
      h('button', { class: 'btn primary' + (peDirty() ? ' dirty' : ''), disabled: !peDirty() || PE.busy, onclick: () => peSave(), title: 'Записать personality.h / .cpp (Ctrl+S)' }, 'Сохранить')),
    PE.sub === 'love' ? h('div', { class: 'gr-body' }, peRenderLove()) : peRenderAsk()));
}

function peTouch() { const b = $('#people .gr-bar .btn.primary'); if (b) { b.disabled = !peDirty(); b.classList.toggle('dirty', peDirty()); } }

// ------------------------------------------------------------ Ask about
function peRenderAsk() {
  const q = PE.filter.trim().toLowerCase();
  const filled = c => PE.m.lines.filter(l => l.char === c && l.text.trim()).length;
  const item = (c, label, sub) => h('div', { class: 'tl-item' + (PE.who === c ? ' sel' : ''), onclick: () => { PE.who = c; store.set('pe.who', c); peRender(); } },
    h('div', { class: 'tl-item-t' }, label), h('div', { class: 'tl-item-u' }, sub));
  const list = h('div', { class: 'tl-items' },
    item(-1, '★ Общие ответы', 'если у персонажа своего ответа нет'),
    PE.st.names.map((n, c) => (!q || n.toLowerCase().includes(q) || peGroup(c).toLowerCase().includes(q))
      ? item(c, h('span', null, h('span', { class: 'tl-idx' }, c), ' ', n), `${peGroup(c) || '—'} · своих ответов: ${filled(c)}`) : null));
  return h('div', { class: 'tl', style: 'flex:1;min-height:0' },
    h('aside', { class: 'tl-list' },
      h('div', { class: 'side-tools' }, h('input', { type: 'search', placeholder: 'Персонаж или группа…', value: PE.filter,
        oninput: e => { PE.filter = e.target.value; const s = e.target.selectionStart; peRender(); const n = $('#people .tl-list input'); n.focus(); n.setSelectionRange(s, s); } })),
      list),
    h('section', { class: 'tl-main' }, peAskRules(), PE.who < 0 ? peAskFallback() : peAskChar(PE.who)));
}

function peAskRules() {
  return h('details', { class: 'tl-block pe-rules' }, h('summary', null, h('b', null, 'Пороги тем'), h('span', { class: 'tl-hint' }, ' — общие для всех: «отношение» = relationLVLS (5 звёзд = 100) + бонус группы ±15')),
    h('table', { class: 'gr-mx' }, h('tr', null, h('th'), h('th', null, 'неохотно — с'), h('th', null, 'с удовольствием — с')),
      PE.st.askTopics.map((t, k) => h('tr', null, h('th', null, t),
        ['reluctant', 'happy'].map(f => h('td', null, h('input', { class: 'gr-in num', type: 'number', value: PE.m.rules[k][f], oninput: e => { PE.m.rules[k][f] = parseInt(e.target.value, 10) || 0; peTouch(); } })))))));
}

function peTextCell(get, set, placeholder) {
  const cnt = h('span', { class: 'gr-cnt' });
  const upd = v => { const bad = v.length > PE.st.textMax || /[^\x20-\x7e]/.test(v); cnt.textContent = `${v.length}/${PE.st.textMax}` + (/[^\x20-\x7e]/.test(v) ? ' · не-ASCII!' : ''); cnt.classList.toggle('bad', bad); };
  const ta = h('textarea', { rows: 2, placeholder, oninput: e => { set(e.target.value); upd(e.target.value); peTouch(); } }, get());
  upd(get());
  return [ta, cnt];
}

function peAskFallback() {
  return h('div', { class: 'tl-block' }, h('div', { class: 'tl-tools' }, h('b', null, 'Общие ответы'), h('span', { class: 'tl-hint' }, 'Их говорит любой персонаж, у которого нет своего ответа на эту тему и ярус.')),
    h('table', { class: 'gr-phr' }, h('tr', null, h('th', null, 'тема'), PE.st.tiers.map(t => h('th', null, t))),
      PE.st.askTopics.map((t, k) => h('tr', null, h('th', null, t), [0, 1, 2].map(tier => {
        const [ta, cnt] = peTextCell(() => PE.m.fallback[k][tier], v => { PE.m.fallback[k][tier] = v; }, 'общий ответ');
        return h('td', { class: 'gr-cell' }, h('div', { class: 'gr-ph' }, ta, h('div', { class: 'gr-ph-f' }, cnt)));
      })))));
}

function peAskChar(c) {
  const likes = PE.st.likes[c] || [];
  const mine = (k, tier) => PE.m.lines.filter(l => l.char === c && l.topic === k && l.tier === tier);
  const cell = (k, tier) => {
    const box = h('td', { class: 'gr-cell' });
    for (const l of mine(k, tier)) {
      const [ta, cnt] = peTextCell(() => l.text, v => { l.text = v; }, 'ответ (английский, ASCII)');
      box.append(h('div', { class: 'gr-ph' }, ta, h('div', { class: 'gr-ph-f' }, cnt,
        h('button', { class: 'icon-btn', title: 'Удалить', onclick: () => { PE.m.lines.splice(PE.m.lines.indexOf(l), 1); peRender(); } }, '×'))));
    }
    box.append(h('button', { class: 'btn small ghost', onclick: () => { PE.m.lines.push({ char: c, topic: k, tier, text: '' }); peRender(); setTimeout(() => { const el = [...$$('#people .gr-cell textarea')].find(x => !x.value); if (el) el.focus(); }); } }, '+ ответ'));
    if (!mine(k, tier).length) box.append(h('div', { class: 'pe-fb' }, 'общий: ' + (PE.m.fallback[k][tier] || '—')));
    return box;
  };
  return h('div', { class: 'tl-block' },
    h('div', { class: 'pe-head' }, h('b', { class: 'pe-name' }, peName(c)), h('span', { class: 'tl-lv' }, peGroup(c) || 'без группы'),
      h('span', { class: 'tl-hint' }, 'темы разговора: '),
      PE.st.topics.map((t, k) => t && likes[k] !== undefined ? h('span', { class: 'pe-like', 'data-v': likes[k], title: ['ненавидит', 'не любит', 'всё равно', 'нравится', 'обожает'][likes[k]] }, PE_LIKE[likes[k]] + ' ' + t) : null)),
    h('table', { class: 'gr-phr' }, h('tr', null, h('th', null, 'тема'), PE.st.tiers.map(t => h('th', null, t))),
      PE.st.askTopics.map((t, k) => h('tr', null, h('th', null, t, h('div', { class: 'tl-hint' }, `с ${PE.m.rules[k].reluctant} / ${PE.m.rules[k].happy}`)), [0, 1, 2].map(tier => cell(k, tier))))));
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
  m.lines = m.lines.filter(l => l.text.trim());
  const bad = [...m.lines.map(l => l.text), ...m.fallback.flat()].filter(t => t.length > PE.st.textMax || /[^\x20-\x7e]/.test(t));
  if (bad.length) { toast(`Ответов с ошибками: ${bad.length} (длина > ${PE.st.textMax} или не-ASCII) — исправьте`, 'err'); return; }
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
