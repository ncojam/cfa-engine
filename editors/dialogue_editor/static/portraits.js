// ============================================================ Портреты: обзор по персонажам
// Источники: лист   project/images/charNN.bmp          (формат движка, эмоций = (h-8)/48)
//            лента  editors/portraits/charNN_faces.bmp (72x80 слева направо, эмоций = w/72)
//            .inc   собранная графика — её видит превью диалогов (нужен build_graphics.sh)
// Использование эмоций считается по всем загруженным диалогам (включая несохранённые правки).

const PV = { open: false, status: null, cid: null, src: 'sheet', filter: 'all', busy: false, ver: Date.now() };

function pvUsage() {
  // cid -> emo -> [{name, i, text}] ; key 'null' = NPC не задан
  const use = {};
  const dlgs = allDialogues().map(x => x.D).concat(S.orphans);
  for (const D of dlgs) {
    D.phrases.forEach((p, i) => {
      if (kindOf(p) !== 'text' || p.f[F.op] === -14) return;   // подсказки без портрета
      const cid = portraitChar(D, p);
      const emo = num(p.f[F.icon]);
      const k = cid == null ? 'null' : cid;
      ((use[k] = use[k] || {})[emo] = use[k][emo] || []).push({ name: D.name, i, text: String(p.f[F.text] || '') });
    });
  }
  return use;
}

function pvCounts(cid) {
  const st = PV.status && PV.status.chars[cid] || {};
  return { sheet: st.sheet ? st.sheet.n : 0, strip: st.strip ? st.strip.n : 0, inc: st.inc || 0, st };
}

function pvSummary(cid, use) {
  const u = use[cid] || {};
  const used = Object.keys(u).map(Number).sort((a, b) => a - b);
  const c = pvCounts(cid);
  const have = Math.max(c.sheet, c.strip);
  const missing = used.filter(e => e >= have);
  const unused = []; for (let e = 0; e < have; e++) if (!u[e]) unused.push(e);
  return { used, missing, unused, have, ...c };
}

async function pvLoad() {
  PV.status = await api('/api/portraits/status');
  PV.ver = Date.now();
}

async function openPortraits(cid) {
  PV.open = true;
  if (cid != null) PV.cid = cid;
  $('#empty').hidden = true; $('#editor').hidden = true; $('#portraits').hidden = false;
  $('#btnPortraits').classList.add('on');
  try { await pvLoad(); } catch (e) { toast('Портреты: ' + e.message, 'err'); }
  renderPortraits();
}
function closePortraits() {
  if (!PV.open) return;
  PV.open = false;
  $('#portraits').hidden = true; $('#btnPortraits').classList.remove('on');
  renderEditor();
}

function pvImg(cid, emo, src) {
  const n = pvCounts(cid)[src];
  if (emo >= n) return null;
  const img = h('img', { src: `/api/${src}/${cid}/${emo}.png?v=${PV.ver}`, alt: '' });
  img.onerror = () => img.replaceWith(h('div', { class: 'ph2' }, '×'));
  return img;
}

function pvSprite(cid, cls) {
  const sp = PV.status && PV.status.chars[cid] && PV.status.chars[cid].sprite;
  if (!sp) return null;
  const img = h('img', { class: 'pv-spr ' + (cls || ''), src: `/api/sprite/${cid}.png?v=${PV.ver}`, alt: '', title: `Спрайт: ${sp.sheet}, тайл ${sp.tile}\n${sp.from}` });
  img.onerror = () => img.remove();
  return img;
}

function renderPortraits() {
  const root = $('#portraits'); root.innerHTML = '';
  const use = pvUsage();
  const ids = new Set(Object.keys(PV.status ? PV.status.chars : {}).map(Number));
  Object.keys(use).forEach(k => { if (k !== 'null') ids.add(+k); });
  const list = [...ids].sort((a, b) => a - b).map(cid => ({ cid, s: pvSummary(cid, use) }));
  const shown = list.filter(x => PV.filter === 'all' || (PV.filter === 'miss' ? x.s.missing.length : x.s.used.length));
  if (PV.cid == null && list.length) PV.cid = (list.find(x => x.s.missing.length) || list[0]).cid;

  const totalMiss = list.reduce((a, x) => a + x.s.missing.length, 0);

  // ---------- toolbar
  const conv = (dir, ids, extra = {}) => pvConvert(dir, ids, extra);
  root.append(h('div', { class: 'pv-top' },
    h('b', null, 'Портреты'),
    h('span', { class: 'muted' }, `${list.length} перс. · не хватает эмоций: ${totalMiss}`),
    h('div', { class: 'seg' }, [['all', 'Все'], ['used', 'В диалогах'], ['miss', 'С пробелами']].map(([v, l]) =>
      h('button', { class: PV.filter === v ? 'on' : '', onclick: () => { PV.filter = v; renderPortraits(); } }, l))),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn small', title: 'Листы = внутриигровая графика project/images/charNN.bmp. Все листы → ленты charNN_faces.bmp', disabled: PV.busy,
      onclick: () => conv('unpack', list.filter(x => x.s.st.sheet).map(x => x.cid)) }, 'Все листы (игра) → ленты'),
    h('button', { class: 'btn small', title: 'Все ленты → листы движка (сначала проверка)', disabled: PV.busy,
      onclick: () => conv('pack', list.filter(x => x.s.st.strip).map(x => x.cid)) }, 'Все ленты → листы (игра)'),
    h('button', { class: 'btn small ghost', onclick: () => openPortraits() }, '⟳'),
    h('button', { class: 'btn small ghost', onclick: closePortraits }, '✕ к диалогам')));

  const body = h('div', { class: 'pv-body' });
  // ---------- character list
  const ul = h('div', { class: 'pv-list' });
  for (const { cid, s } of shown) {
    const thumb = pvImg(cid, 0, s.sheet ? 'sheet' : 'strip') || h('div', { class: 'ph2' }, (charName(cid)[0] || '?'));
    ul.append(h('div', { class: 'pv-row' + (cid === PV.cid ? ' on' : ''), onclick: () => { PV.cid = cid; renderPortraits(); } },
      thumb,
      pvSprite(cid, 'sm'),
      h('div', { class: 'pv-row-t' },
        h('div', null, `${charName(cid)} `, h('span', { class: 'muted' }, `char${String(cid).padStart(2, '0')}`)),
        h('div', { class: 'pv-tags' },
          h('span', { class: 'tag' }, `есть ${s.have}`),
          s.used.length ? h('span', { class: 'tag' }, `в диалогах ${s.used.length}`) : null,
          s.missing.length ? h('span', { class: 'tag err' }, `нет ${s.missing.length}`) : null,
          s.st.sheet && s.st.strip && s.st.strip.mtime > s.st.sheet.mtime ? h('span', { class: 'tag warn', title: 'лента новее листа — не собрана' }, 'не собрано') : null))));
  }
  if (use.null) {
    const n = Object.values(use.null).reduce((a, v) => a + v.length, 0);
    ul.append(h('div', { class: 'pv-row warn', title: 'who = −1, а NPC диалога не задан и не угадан' },
      h('div', { class: 'ph2' }, '?'), h('div', { class: 'pv-row-t' }, `NPC не задан: ${n} реплик`)));
  }
  body.append(ul);

  // ---------- detail
  body.append(PV.cid != null ? pvDetail(PV.cid, use) : h('div', { class: 'empty' }, 'Нет персонажей'));
  root.append(body);
}

function pvDetail(cid, use) {
  const s = pvSummary(cid, use), u = use[cid] || {};
  const det = h('div', { class: 'pv-detail' });
  const src = (PV.src === 'strip' && s.strip) || !s.sheet ? 'strip' : 'sheet';
  const warns = [];
  if (s.st.sheet && s.st.strip && s.sheet !== s.strip) warns.push(`в листе ${s.sheet}, в ленте ${s.strip} эмоций`);
  if (s.st.sheet && s.st.strip && s.st.strip.mtime > s.st.sheet.mtime) warns.push('лента новее листа — нажмите «Лента → лист»');
  if (s.sheet && s.inc !== s.sheet) warns.push(`в собранной графике (.inc) ${s.inc} эмоц. — превью диалогов устарело, нужен build_graphics.sh`);
  if (s.st.sheet && s.st.sheet.error) warns.push('лист: ' + s.st.sheet.error);
  if (s.st.strip && s.st.strip.error) warns.push('лента: ' + s.st.strip.error);

  det.append(h('div', { class: 'pv-head' },
    pvSprite(cid, 'lg'),
    h('h2', null, `${charName(cid)} · char${String(cid).padStart(2, '0')}`),
    h('div', { class: 'seg' },
      h('button', { class: src === 'sheet' ? 'on' : '', disabled: !s.sheet, title: 'лист = внутриигровая графика: project/images/charNN.bmp', onclick: () => { PV.src = 'sheet'; renderPortraits(); } }, `лист · игра (${s.sheet})`),
      h('button', { class: src === 'strip' ? 'on' : '', disabled: !s.strip, title: 'editors/portraits/charNN_faces.bmp', onclick: () => { PV.src = 'strip'; renderPortraits(); } }, `лента (${s.strip})`)),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn small', disabled: !s.st.sheet || PV.busy, onclick: () => pvConvert('unpack', [cid]) }, 'Лист (игра) → лента'),
    h('button', { class: 'btn small primary', disabled: !s.st.strip || PV.busy, onclick: () => pvConvert('pack', [cid]) }, 'Лента → лист (игра)'),
    h('button', { class: 'btn small', disabled: !s.st.big || PV.busy, title: 'editors/portraits/charNN_faces_big.bmp (x10) → лента: ресайз /10 + палитра chr_spr_witch.bmp',
      onclick: () => pvConvert('big', [cid]) }, 'Большой → лента'),
    h('button', { class: 'btn small', disabled: !s.st.strip || PV.busy, title: 'Чистка лайна: локти, выбивающиеся ступеньки, затемнение во внутренних уголках',
      onclick: () => pvConvert('pixelart', [cid]) }, 'Пиксельарт-прогон')));
  if (warns.length) det.append(h('div', { class: 'pv-warn' }, warns.map(w => h('div', null, '⚠ ' + w))));
  det.append(h('div', { class: 'pv-legend muted' },
    `Используется: ${s.used.join(', ') || '—'} · `,
    h('span', { class: s.missing.length ? 'err-t' : '' }, `дорисовать: ${s.missing.join(', ') || 'ничего'}`),
    ` · не используются: ${s.unused.join(', ') || '—'}`));

  const grid = h('div', { class: 'pv-grid' });
  const maxE = Math.max(s.have, ...s.used.map(e => e + 1), 0);
  for (let e = 0; e < maxE; e++) {
    const refs = u[e] || [];
    const exists = e < s.have;
    const cls = !exists ? 'miss' : refs.length ? 'used' : 'idle';
    const img = exists ? pvImg(cid, e, e < s[src] ? src : (src === 'sheet' ? 'strip' : 'sheet')) : null;
    grid.append(h('div', { class: 'pv-cell ' + cls, title: refs.slice(0, 12).map(r => `${r.name}#${r.i}: ${r.text}`).join('\n') },
      img || h('div', { class: 'ph2' }, exists ? '×' : 'нарисовать'),
      h('div', { class: 'pv-cap' }, `${e} · ${emotionName(e)}`),
      h('div', { class: 'pv-n' }, refs.length ? `${refs.length} реплик` : exists ? 'не используется' : ''),
      refs.length ? h('div', { class: 'pv-refs' }, refs.slice(0, 4).map(r =>
        h('a', { href: '#', onclick: ev => { ev.preventDefault(); ev.stopPropagation(); closePortraits(); select(r.name, r.i); } }, `${r.name} #${r.i}`)),
        refs.length > 4 ? h('span', { class: 'muted' }, `+${refs.length - 4}`) : null) : null));
  }
  det.append(grid);
  return det;
}

async function pvConvert(direction, ids, extra = {}) {
  if (!ids.length) return toast('Нечего конвертировать');
  PV.busy = true; renderPortraits();
  try {
    if (direction === 'big' || direction === 'pixelart') {   // тяжёлые: без пробного прогона, бэкап ленты в portraits/backups
      if (!confirm(direction === 'big' ? 'Перезаписать ленту из большого файла (_big)?' : 'Прогнать ленту пиксельарт-чисткой?')) return;
      toast('Считаю… (большой файл может обрабатываться десятки секунд)');
      const res = await api('/api/portraits/convert', { direction, chars: ids });
      const bad = res.log.filter(l => !l.ok);
      toast(res.log.map(l => l.msg).join(' · '), bad.length ? 'err' : '');
      await pvLoad();
      return;
    }
    // сначала проверка, потом подтверждение
    const dry = await api('/api/portraits/convert', { direction, chars: ids, dryRun: true, ...extra });
    const lines = dry.log.map(l => (l.ok ? '✓ ' : '✕ ') + l.msg).join('\n');
    const newer = dry.log.filter(l => l.newer).map(l => l.cid);
    let force = false;
    if (newer.length) force = confirm(lines + `\n\nЛенты новее листов (${newer.length}). Перезаписать их всё равно? (бэкап будет в portraits/backups)`);
    const todo = dry.log.filter(l => l.ok && !/без изменений/.test(l.msg)).map(l => l.cid).concat(force ? newer : []);
    if (!todo.length) { toast(lines.split('\n').slice(0, 3).join(' · ') || 'Без изменений'); return; }
    if (!newer.length && !confirm((direction === 'pack' ? 'Записать листы движка?\n\n' : 'Распаковать в ленты?\n\n') + lines)) return;
    let trim = false;
    if (direction === 'pack' && dry.log.some(l => /остальные из оригинала/.test(l.msg)))
      trim = confirm('В некоторых лентах меньше эмоций, чем в листе. Удалить лишние эмоции из листа (--trim)?\nОтмена = оставить их из оригинала.');
    const res = await api('/api/portraits/convert', { direction, chars: todo, force, trim });
    const bad = res.log.filter(l => !l.ok);
    toast(`${direction === 'pack' ? 'Собрано' : 'Распаковано'}: ${res.log.length - bad.length}` + (bad.length ? ` · ошибок ${bad.length}: ${bad[0].msg}` : ''), bad.length ? 'err' : '');
    await pvLoad();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'err');
  } finally {
    PV.busy = false; renderPortraits();
  }
}

// ---------- wiring
$('#btnPortraits').onclick = () => PV.open ? closePortraits() : openPortraits();
{
  const _select = select;
  // eslint-disable-next-line no-global-assign
  select = function (name, scrollTo) { if (PV.open) { PV.open = false; $('#portraits').hidden = true; $('#btnPortraits').classList.remove('on'); } return _select(name, scrollTo); };
}
