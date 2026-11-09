// ============================================================ Вкладка «Группы» (project/src/groups.h/.cpp)
// Три подвкладки: группы и отношения между ними (граф + матрица), состав (перетаскивание
// персонажей), фразы групп по ситуациям. Модель целиком уходит на сервер, тот генерирует оба файла.

const GR = {
  st: null, m: null, orig: '', sub: store.get('gr.sub', 'rel'), sit: 'TALK', phG: store.get('gr.phG', 1),
  pick: null, filter: '', busy: false, drag: null,
};
const GR_ATT = [-2, -1, 0, 1, 2];
const GR_ATT_TXT = { '-2': 'вместе не придут', '-1': 'недолюбливают', '0': 'всё равно', '1': 'дружат', '2': 'очень дружат' };
const GR_LVL_TXT = { 0: '😠 ненавидит', 1: '🙁 не любит', 3: '🙂 нравится', 4: '😍 обожает' };

const grDirty = () => GR.m && JSON.stringify(GR.m) !== GR.orig;
const grColor = i => i === 0 ? '#6b7280' : `hsl(${(i * 67 + 10) % 360} 62% 58%)`;
const grName = cid => (GR.st.names && GR.st.names[cid]) || charName(cid);
const grCount = gi => GR.m.members.filter(x => x === gi).length;

async function openGroups() {
  $('#groups').hidden = false;
  if (!GR.st) await grLoad(); else grRender();
}

async function grLoad() {
  try {
    const st = await api('/api/groups/state');
    if (st.error) throw new Error(st.error);
    grIngest(st);
  } catch (e) {
    const root = $('#groups'); root.innerHTML = '';
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Не удалось загрузить группы'), h('div', { class: 'empty-sub' }, e.message)));
  }
}

function grIngest(st) {
  GR.st = st; GR.m = st.model; GR.orig = JSON.stringify(st.model);
  if (GR.phG >= GR.m.groups.length) GR.phG = Math.min(1, GR.m.groups.length - 1);
  grRender();
}

function grRender() {
  const root = $('#groups'); root.innerHTML = '';
  if (!GR.m) return;
  const sub = (k, label) => h('button', { class: 'tab' + (GR.sub === k ? ' on' : ''), onclick: () => { GR.sub = k; store.set('gr.sub', k); grRender(); } }, label);
  root.append(h('div', { class: 'gr' },
    h('div', { class: 'gr-bar' },
      sub('rel', '🕸 Группы и отношения'), sub('mem', '🧑‍🤝‍🧑 Состав'), sub('phr', '💬 Фразы'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'tl-hint' }, GR.st.files[0].replace(/.*[\\/]src[\\/]/, 'src/') + ', groups.cpp'),
      h('button', { class: 'btn', onclick: grReload }, '⟳ С диска'),
      h('button', { class: 'btn primary' + (grDirty() ? ' dirty' : ''), disabled: !grDirty() || GR.busy, onclick: () => grSave(), title: 'Записать groups.h / groups.cpp (Ctrl+S)' }, 'Сохранить')),
    h('div', { class: 'gr-body' }, GR.sub === 'mem' ? grRenderMembers() : GR.sub === 'phr' ? grRenderPhrases() : grRenderRel())));
}

function grTouch() {   // правка без пересборки (чтобы не терять фокус в полях)
  const b = $('.gr-bar .btn.primary'); if (b) { b.disabled = !grDirty(); b.classList.toggle('dirty', grDirty()); }
}

// ------------------------------------------------------------ группы и отношения
function grRenderRel() {
  const G = GR.m.groups;
  const cards = G.map((g, i) => h('div', { class: 'gr-card' + (GR.pick === i ? ' on' : '') },
    h('div', { class: 'gr-card-h' },
      h('span', { class: 'gr-dot', style: `background:${grColor(i)}` }),
      h('input', { class: 'gr-in name', value: g.name, placeholder: 'Название', oninput: e => { g.name = e.target.value; grTouch(); grDrawGraph(); } }),
      h('span', { class: 'tl-hint' }, `${grCount(i)} чел.`),
      i ? h('button', { class: 'icon-btn', title: 'Удалить группу', onclick: () => grDelGroup(i) }, '×') : null),
    h('div', { class: 'gr-card-k' }, 'G_',
      h('input', { class: 'gr-in key', value: g.key, disabled: i === 0, title: 'Имя в коде (enum Group): A-Z, 0-9, _',
        onchange: e => grRenameKey(i, e.target.value) })),
    h('div', { class: 'gr-humor' },
      h('label', { title: 'Как группа называется в игре (список «о ком шутим»): ASCII, до ' + GR.st.titleMax + ' символов' }, 'в игре ',
        h('input', { class: 'gr-in', value: g.title || '', maxlength: GR.st.titleMax, oninput: e => { g.title = e.target.value; grTouch(); } })),
      h('label', { title: 'Сколько юмора Вики (0..200, с бонусами) нужно, чтобы шутка зашла' }, '😄 порог ',
        h('input', { class: 'gr-in num', type: 'number', min: 0, max: 250, value: g.humorNeed ?? 60, oninput: e => { g.humorNeed = parseInt(e.target.value, 10) || 0; grTouch(); } })),
      h('label', { title: 'Ещё нужен стат Вики (нерды - Intellect, модные/скейтеры - Allure как «стиль»)' }, 'и стат ',
        h('select', { onchange: e => { g.humorStat = +e.target.value; grRender(); } },
          h('option', { value: -1, selected: (g.humorStat ?? -1) < 0 }, '—'),
          GR.st.stats.map((sname, k) => h('option', { value: k, selected: g.humorStat === k }, sname)))),
      (g.humorStat ?? -1) >= 0 ? h('label', null, '≈ ', h('input', { class: 'gr-in num', type: 'number', min: 0, max: 200, value: g.humorStatNeed ?? 0, oninput: e => { g.humorStatNeed = parseInt(e.target.value, 10) || 0; grTouch(); } })) : null),
    h('textarea', { class: 'gr-in desc', rows: 2, placeholder: i ? 'Кто это, чем живут, с кем не ладят…' : '', oninput: e => { g.desc = e.target.value; grTouch(); } }, g.desc)));
  return h('div', { class: 'gr-rel' },
    h('div', { class: 'gr-cards' }, cards, h('button', { class: 'btn small', onclick: grAddGroup }, '+ группа'),
      h('div', { class: 'tl-hint', style: 'margin-top:6px' }, 'NONE — «без группы»: ладит со всеми, удалить нельзя.')),
    h('div', { class: 'gr-graph-col' },
      h('div', { class: 'gr-legend' },
        GR_ATT.map(v => h('span', { class: 'gr-lg', 'data-v': v }, `${v > 0 ? '+' : ''}${v} ${GR_ATT_TXT[v]}`))),
      h('div', { class: 'tl-hint' }, 'Граф: клик по группе, потом по другой — сменить отношение (по кругу −2…+2). Два клика по одной — отношение внутри группы. −2 = вдвоём не позвать (Companions).'),
      (() => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.id = 'grGraph'; s.setAttribute('viewBox', '0 0 560 420'); return s; })(),
      grRenderMatrix()));
}

function grRenderMatrix() {
  const G = GR.m.groups, A = GR.m.attitude;
  return h('table', { class: 'gr-mx' },
    h('tr', null, h('th'), G.map((g, j) => h('th', { title: g.name, style: `color:${grColor(j)}` }, g.key.slice(0, 6)))),
    G.map((g, i) => h('tr', null, h('th', { style: `color:${grColor(i)}`, title: g.name }, g.name || g.key),
      G.map((_, j) => {
        if (i === 0 || j === 0) return h('td', { class: 'gr-v', 'data-v': 0, title: 'без группы — всегда 0' }, '0');
        return h('td', { class: 'gr-v', 'data-v': A[i][j] },
          h('select', { onchange: e => { grSetAtt(i, j, +e.target.value); grRender(); } },
            GR_ATT.map(v => h('option', { value: v, selected: v === A[i][j] }, (v > 0 ? '+' : '') + v))));
      }))));
}

function grSetAtt(i, j, v) { GR.m.attitude[i][j] = v; GR.m.attitude[j][i] = v; }

function grDrawGraph() {
  const svg = $('#grGraph'); if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg', G = GR.m.groups, A = GR.m.attitude;
  const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
  svg.innerHTML = '';
  const ids = G.map((_, i) => i).filter(i => i > 0);
  const cx = 280, cy = 210, R = ids.length > 1 ? 155 : 0;
  const pos = {};
  ids.forEach((gi, k) => { const a = -Math.PI / 2 + 2 * Math.PI * k / ids.length; pos[gi] = [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  const col = v => v < 0 ? '#ef5b5b' : '#4fbf72';
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const i = ids[a], j = ids[b], v = A[i][j]; if (!v) continue;
    const [x1, y1] = pos[i], [x2, y2] = pos[j];
    const line = el('line', { x1, y1, x2, y2, stroke: col(v), 'stroke-width': Math.abs(v) === 2 ? 5 : 2, 'stroke-dasharray': Math.abs(v) === 1 ? '6 5' : '', opacity: .85 });
    line.style.cursor = 'pointer';
    line.onclick = () => { grSetAtt(i, j, GR_ATT[(GR_ATT.indexOf(v) + 1) % 5]); grRender(); };
    line.append(el('title', {}, `${G[i].name} ↔ ${G[j].name}: ${v > 0 ? '+' : ''}${v} ${GR_ATT_TXT[v]}`));
    svg.append(line);
    svg.append(el('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, class: 'gr-elabel', fill: col(v) }, (v > 0 ? '+' : '') + v));
  }
  for (const gi of ids) {
    const [x, y] = pos[gi], self = A[gi][gi], n = grCount(gi), r = 22 + Math.min(14, n * 2);
    const g = el('g', { class: 'gr-node' + (GR.pick === gi ? ' on' : '') });
    g.append(el('circle', { cx: x, cy: y, r: r + 5, fill: 'none', stroke: self ? col(self) : '#333a46', 'stroke-width': self ? Math.abs(self) * 2 : 1 }));
    g.append(el('circle', { cx: x, cy: y, r, fill: grColor(gi) }));
    g.append(el('text', { x, y: y + 4, class: 'gr-nlabel' }, n));
    g.append(el('text', { x, y: y + r + 20, class: 'gr-nname' }, G[gi].name || G[gi].key));
    g.append(el('title', {}, `${G[gi].name}: ${n} чел., внутри группы ${self > 0 ? '+' : ''}${self}`));
    g.style.cursor = 'pointer';
    g.onclick = () => {
      if (GR.pick == null) { GR.pick = gi; }
      else { const a = GR.pick; grSetAtt(a, gi, GR_ATT[(GR_ATT.indexOf(A[a][gi]) + 1) % 5]); GR.pick = null; }
      grRender();
    };
    svg.append(g);
  }
}

function grAddGroup() {
  const keys = GR.m.groups.map(g => g.key);
  let k = 'NEW', n = 1; while (keys.includes(k)) k = 'NEW' + (++n);
  GR.m.groups.push({ key: k, name: 'Новая группа', desc: '', title: 'New group', humorNeed: 60, humorStat: -1, humorStatNeed: 0 });
  GR.m.attitude.forEach(r => r.push(0));
  GR.m.attitude.push(GR.m.groups.map(() => 0));
  grRender();
}

function grDelGroup(i) {
  const g = GR.m.groups[i], n = grCount(i), ph = GR.m.phrases.filter(p => p.group === g.key).length;
  if ((n || ph) && !confirm(`Удалить «${g.name}»? ${n} чел. перейдут в «без группы», ${ph} фраз(ы) удалятся.`)) return;
  GR.m.groups.splice(i, 1);
  GR.m.attitude.splice(i, 1); GR.m.attitude.forEach(r => r.splice(i, 1));
  GR.m.members = GR.m.members.map(x => x === i ? 0 : x > i ? x - 1 : x);
  GR.m.phrases = GR.m.phrases.filter(p => p.group !== g.key);
  if (GR.phG >= GR.m.groups.length) GR.phG = GR.m.groups.length - 1;
  GR.pick = null; grRender();
}

function grRenameKey(i, v) {
  v = v.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const g = GR.m.groups[i];
  if (!/^[A-Z]/.test(v) || GR.m.groups.some((x, k) => k !== i && x.key === v)) { toast('Ключ должен начинаться с буквы и не повторяться', 'err'); grRender(); return; }
  GR.m.phrases.forEach(p => { if (p.group === g.key) p.group = v; });
  g.key = v; grRender();
}

// ------------------------------------------------------------ состав
function grRenderMembers() {
  const G = GR.m.groups, q = GR.filter.trim().toLowerCase();
  const chip = cid => h('div', { class: 'gr-chip' + (q && (grName(cid).toLowerCase().includes(q) || String(cid) === q) ? ' hit' : ''), draggable: 'true',
    ondragstart: e => { e.dataTransfer.setData('text/plain', String(cid)); e.dataTransfer.effectAllowed = 'move'; },
    title: `charID ${cid} — перетащите в другую группу` },
    h('img', { src: `/api/sprite/${cid}.png`, alt: '', onerror: e => { e.target.remove(); } }),
    h('span', { class: 'gr-cid' }, cid), grName(cid));
  const col = (g, i) => {
    const ids = GR.m.members.map((x, cid) => x === i ? cid : -1).filter(x => x >= 0);
    return h('div', { class: 'gr-col', 'data-g': i,
      ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); },
      ondragleave: e => e.currentTarget.classList.remove('over'),
      ondrop: e => { e.preventDefault(); const cid = +e.dataTransfer.getData('text/plain'); if (GR.m.members[cid] !== i) { GR.m.members[cid] = i; grRender(); } } },
      h('div', { class: 'gr-col-h', style: `border-color:${grColor(i)}` }, h('span', { class: 'gr-dot', style: `background:${grColor(i)}` }), g.name || g.key, h('span', { class: 'tl-hint' }, ` ${ids.length}`)),
      g.desc ? h('div', { class: 'gr-col-d' }, g.desc) : null,
      h('div', { class: 'gr-chips' }, ids.map(chip)));
  };
  return h('div', null,
    h('div', { class: 'gr-tools' },
      h('input', { type: 'search', class: 'gr-search', placeholder: 'Найти персонажа…', value: GR.filter,
        oninput: e => { GR.filter = e.target.value; const s = e.target.selectionStart; grRender(); const n = $('.gr-search'); n.focus(); n.setSelectionRange(s, s); } }),
      h('span', { class: 'tl-hint' }, 'Перетаскивайте персонажей между группами. Один персонаж — одна группа.')),
    h('div', { class: 'gr-cols' }, G.map(col)));
}

// ------------------------------------------------------------ фразы
function grRenderPhrases() {
  const G = GR.m.groups, sits = GR.st.situations, sit = sits.find(s => s.key === GR.sit) || sits[0];
  const g = G[GR.phG] || G[0];
  // у шуток свои «темы» (виды шуток) и подписи исходов; у разговоров - темы listSubjects
  const levels = GR.st.levels, subjects = Array.isArray(sit.subjects) ? sit.subjects : GR.st.subjects, defs = (GR.st.defaults[sit.key] || {});
  const lvlTxt = l => (sit.levelLabels && sit.levelLabels[l]) || GR_LVL_TXT[l] || l;
  // кто говорит в превью: первый участник группы (имя влияет только на первую строку бабла)
  const firstMember = GR.m.members.findIndex(x => x === G.indexOf(g));
  const speaker = () => firstMember >= 0 ? grName(firstMember) : (g.title || g.name || 'NPC');
  const mine = (s, l) => GR.m.phrases.filter(p => p.group === g.key && p.situation === sit.key && p.subject === s && p.level === l);
  const filled = subjects.reduce((n, nm, s) => n + (nm ? levels.filter(l => mine(s, l).length).length : 0), 0);
  const cells = subjects.filter(Boolean).length * levels.length;
  const cell = (s, l) => {
    const li = levels.indexOf(l);
    const def = (defs[s] || []).map(e => e[li]).filter(Boolean);
    const box = h('td', { class: 'gr-cell' });
    for (const p of mine(s, l)) {
      const cnt = h('span', { class: 'gr-cnt' });
      const upd = () => {
        const bad = p.text.length > GR.st.textMax || /[^\x20-\x7e]/.test(p.text);
        cnt.textContent = `${p.text.length}/${GR.st.textMax}` + (/[^\x20-\x7e]/.test(p.text) ? ' · не-ASCII!' : '');
        cnt.classList.toggle('bad', bad);
      };
      let pv = null;
      const ta = h('textarea', { rows: 2, placeholder: 'Фраза группы (английский, ASCII)', oninput: e => { p.text = e.target.value; upd(); if (pv) pv.redraw(); grTouch(); } }, p.text);
      upd();
      pv = reactPreview(speaker, () => p.text, { onMeasure: m => ta.classList.toggle('over', !!(m && m.overflow)) });
      box.append(h('div', { class: 'gr-ph' }, ta, pv ? pv.el : null, h('div', { class: 'gr-ph-f' }, cnt,
        h('button', { class: 'icon-btn', title: 'Удалить фразу', onclick: () => { GR.m.phrases.splice(GR.m.phrases.indexOf(p), 1); grRender(); } }, '×'))));
    }
    box.append(h('button', { class: 'btn small ghost', onclick: () => { GR.m.phrases.push({ group: g.key, situation: sit.key, subject: s, level: l, text: '' }); grRender(); setTimeout(() => { const t = $$('.gr-cell textarea'); const el = [...t].find(x => !x.value); if (el) el.focus(); }); } }, '+ фраза'));
    if (def.length) {
      // превью общих — только когда раскрыли (их много)
      const det = h('details', { class: 'gr-def' }, h('summary', null, `общие (${def.length})` + (def.some(t => reactOverflow(speaker(), t)) ? ' ✕ не влезает' : '')),
        def.map(t => h('div', { 'data-t': t }, t)));
      det.addEventListener('toggle', () => {
        if (!det.open || det.dataset.pv) return;
        det.dataset.pv = 1;
        $$('div[data-t]', det).forEach(d => { const pv = reactPreview(speaker, () => d.dataset.t); if (pv) d.append(pv.el); });
      });
      box.append(det);
    }
    return box;
  };
  return h('div', null,
    h('div', { class: 'gr-tools' },
      h('label', null, 'Ситуация ', h('select', { onchange: e => { GR.sit = e.target.value; grRender(); } },
        sits.map(s => h('option', { value: s.key, selected: s.key === sit.key }, `${s.label} (${s.where})`)))),
      h('label', null, ' Группа ', h('select', { onchange: e => { GR.phG = +e.target.value; store.set('gr.phG', GR.phG); grRender(); } },
        G.map((x, i) => h('option', { value: i, selected: i === GR.phG }, `${x.name || x.key} — ${GR.m.phrases.filter(p => p.group === x.key && p.situation === sit.key && p.text).length} фраз`)))),
      h('span', { class: 'tl-hint' }, `своё есть в ${filled} из ${cells} клеток; пустая клетка — игра скажет общую фразу (раскрыть «общие»). «Всё равно» (2) — всегда «I don't really care».`)),
    h('table', { class: 'gr-phr' },
      h('tr', null, h('th', null, Array.isArray(sit.subjects) ? 'вид \\ исход' : 'тема \\ отношение персонажа к теме'), levels.map(l => h('th', null, lvlTxt(l)))),
      subjects.map((name, s) => name ? h('tr', null, h('th', null, h('span', { class: 'gr-cid' }, s), ' ', name), levels.map(l => cell(s, l))) : null)));
}

// ------------------------------------------------------------ сохранение
async function grReload() {
  if (grDirty() && !confirm('Есть несохранённые правки групп. Перечитать с диска и потерять их?')) return;
  GR.st = null; await grLoad(); toast('Перечитано с диска');
}

async function grSave(force) {
  if (!grDirty()) return;
  const m = JSON.parse(JSON.stringify(GR.m));
  m.phrases = m.phrases.filter(p => p.text.trim());
  const bad = m.phrases.filter(p => p.text.length > GR.st.textMax || /[^\x20-\x7e]/.test(p.text));
  if (bad.length) { toast(`Фраз с ошибками: ${bad.length} (длина > ${GR.st.textMax} или не-ASCII) — исправьте`, 'err'); return; }
  GR.busy = true;
  try {
    const st = await api('/api/groups/save', { hash: GR.st.hash, model: m, force: !!force });
    grIngest(st);
    toast(st.changed ? 'groups.h / groups.cpp сохранены' : 'Без изменений', 'ok');
  } catch (e) {
    if (e.status === 409 && confirm(e.message + '\n\nПерезаписать своими правками?')) { GR.busy = false; return grSave(true); }
    toast('Не сохранено: ' + e.message, 'err');
  } finally { GR.busy = false; if (GR.m) grRender(); }
}

{ // граф рисуется после того, как SVG попал в DOM
  const _r = grRender;
  // eslint-disable-next-line no-func-assign
  grRender = function () { _r(); if (GR.sub === 'rel') grDrawGraph(); };
}

addEventListener('keydown', e => {
  if (typeof TABS === 'undefined' || TABS.cur !== 'groups') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); grSave(); }
  else if (e.key === 'Escape' && GR.pick != null) { GR.pick = null; grRender(); }
});
addEventListener('beforeunload', e => { if (grDirty()) { e.preventDefault(); e.returnValue = ''; } });
