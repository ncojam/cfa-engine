// ============================================================ Вкладка «Подмена тайлов» (fgtile / supertiles.cpp)
// Пара = два состояния одного места (a - игрок слева/сверху, b - справа/снизу).
// Состояние: куда (тайл VRAM), откуда (тайл СЖАТОГО тайлсета), сколько. Всё в тайлах;
// в supertiles.cpp «куда/откуда» записаны ×2 - сервер переводит туда и обратно.
// Тайлсет рисуется уже сжатым, как его собирает tmx2incl (без повторов и отражений):
// именно в этой нумерации считает setSuperTile. Первые vramTiles тайлов лежат в VRAM.

const TL = {
  state: null, pairs: [], orig: [], sel: 0, side: 'a', mode: 'from',
  bmp: null, tmx: null, view: 'sel', zoom: store.get('tl.zoom', 2), perRow: store.get('tl.perRow', 32),
  mapZoom: store.get('tl.mapZoom', 1), mark: store.get('tl.mark', true), filter: '',
  sets: {}, maps: {}, drag: null, busy: false,
  fgs: {}, fgSel: null, fgSeq: 0, fgShow: store.get('tl.fgShow', true), fgAll: store.get('tl.fgAll', false), fgFocus: false,
};

const tlClone = o => JSON.parse(JSON.stringify(o));
const tlKey = p => JSON.stringify([p.a.to, p.a.from, p.a.len, p.b.to, p.b.from, p.b.len, p.name_a, p.name_b]);
const tlDirty = i => i >= TL.orig.length || tlKey(TL.pairs[i]) !== tlKey(TL.orig[i]);
const tlAnyDirty = () => TL.pairs.some((_, i) => tlDirty(i)) || Object.keys(TL.fgs || {}).some(tlFgDirty);
const tlUse = i => [...new Set([...(TL.state.use[2 * i] || []), ...(TL.state.use[2 * i + 1] || [])])].sort();
const tlMapOf = where => 'map-' + where.split(' ')[0] + '.tmx';

async function openTiles() {
  $('#tiles').hidden = false;
  if (!TL.state) await tlLoad();
  else tlRender();
}

async function tlLoad(keepSel) {
  try {
    const st = await api('/api/tiles/state');
    if (st.error) throw new Error(st.error);
    tlIngest(st, keepSel);
  } catch (e) {
    const root = $('#tiles'); root.innerHTML = '';
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Не удалось загрузить таблицу подмены'),
      h('div', { class: 'empty-sub' }, e.message)));
  }
}

function tlIngest(st, keepSel) {
  TL.state = st;
  TL.pairs = tlClone(st.pairs);
  TL.orig = tlClone(st.pairs);
  if (!keepSel) TL.sel = Math.min(store.get('tl.sel', 0), TL.pairs.length - 1);
  tlPick(TL.sel, true, keepSel && !!TL.tmx);   // после сохранения/перечитывания остаёмся на той же карте
}

// выбрать пару; карта/тайлсет по умолчанию - из «где используется»
function tlPick(i, force, keepMap) {
  if (i < 0 || i >= TL.pairs.length) return;
  const changed = force || i !== TL.sel;
  TL.sel = i; store.set('tl.sel', i);
  if (changed && !keepMap) {
    const use = tlUse(i).map(tlMapOf);
    const maps = TL.state.maps.map(m => m.tmx);
    const tmx = use.find(m => maps.includes(m));
    if (tmx) { TL.tmx = tmx; }
    else if (!TL.tmx) TL.tmx = null;
    const def = TL.state.maps.find(m => m.tmx === TL.tmx);
    if (def && def.tileset) TL.bmp = def.tileset;
    if (!TL.bmp) { const t = TL.state.tilesets.find(t => t.used); TL.bmp = t ? t.bmp : null; }
  }
  tlRender();
}

async function tlTileset(bmp) {
  if (!bmp) return null;
  if (!TL.sets[bmp]) {
    const info = TL.state.tilesets.find(t => t.bmp === bmp) || {};
    const j = await api(`/api/tiles/tileset?bmp=${encodeURIComponent(bmp)}&unless=${info.unless ? 1 : 0}`);
    const raw = Uint8Array.from(atob(j.tiles), c => c.charCodeAt(0));
    const pal = new Uint32Array(256);
    j.pal.forEach(([r, g, b], k) => { pal[k] = 0xFF000000 | (b << 16) | (g << 8) | r; });
    j.raw = raw; j.pal32 = pal;
    // сжатый тайлсет одной картинкой: perRow тайлов в ряд
    TL.sets[bmp] = j;
  }
  return TL.sets[bmp];
}

async function tlMap(tmx) {
  if (!tmx) return null;
  if (!TL.maps[tmx]) TL.maps[tmx] = await api(`/api/tiles/map?tmx=${encodeURIComponent(tmx)}`);
  return TL.maps[tmx];
}

// ------------------------------------------------------------ проверки
function tlIssues(s, ts) {
  const v = TL.state.vramTiles, out = [];
  if (!(s.len > 0)) out.push(['err', 'сколько должно быть больше 0']);
  if (s.to < 0 || s.from < 0) out.push(['err', 'отрицательный номер тайла']);
  if (s.to + s.len > v) out.push(['err', `«куда» выходит за VRAM фона (${v} тайлов): ${s.to}…${s.to + s.len - 1} затрёт память после тайлов`]);
  if (ts && s.from + s.len > ts.optCount) out.push(['err', `«откуда» выходит за сжатый тайлсет ${ts.bmp} (${ts.optCount} тайлов) — возьмёт мусор`]);
  if (s.odd) out.push(['warn', 'в коде нечётное значение (полтайла) — редактор показывает округлённо']);
  return out;
}

// ------------------------------------------------------------ рендер вкладки
function tlRender() {
  const root = $('#tiles'); root.innerHTML = '';
  if (!TL.state) return;
  const P = TL.pairs[TL.sel];
  root.append(h('div', { class: 'tl' }, tlRenderList(), h('section', { class: 'tl-main' },
    P ? [tlRenderHead(P), tlRenderStates(P),
      h('div', { class: 'tl-views' }, tlRenderTileset(), tlRenderMap())] : h('div', { class: 'empty' }, 'Таблица пуста'))));
  tlDraw();
}

// карта -> номера уровней (portTo), из mapDescs через supertile_usage.py
function tlLevelsOf(map) {
  return Object.entries(TL.state.levels || {}).filter(([, m]) => m === map).map(([i]) => +i);
}
function tlLevelChip(where) {   // "town-fun" или "town-fun (дверь из 101)"
  const map = where.split(' ')[0], rest = where.slice(map.length).trim();
  const lv = tlLevelsOf(map);
  return h('span', { class: 'tl-lv', title: rest ? `${map}: подмена при входе ${rest.replace(/[()]/g, '')}` : `${map}: триггер на этой карте` },
    lv.length ? h('b', null, lv.join('/')) : null, map, rest ? h('i', null, ' 🚪') : null);
}

function tlRenderList() {
  const q = TL.filter.trim().toLowerCase();
  const list = h('div', { class: 'tl-items' });
  TL.pairs.forEach((p, i) => {
    const use = tlUse(i);
    const text = `[${2 * i}] [${2 * i + 1}] ${p.name_a} ${p.name_b} ${use.join(' ')} ${(p.notes || []).join(' ')}`.toLowerCase();
    if (q && !text.includes(q)) return;
    if (p.notes && p.notes.length && !q) for (const n of p.notes) {
      const m = /portTo\s*=\s*(\d+)/i.exec(n);
      if (m) {
        const map = (TL.state.levels || {})[m[1]];
        list.append(h('div', { class: 'tl-level' }, h('span', { class: 'tl-level-n' }, m[1]), h('span', null, map ? `map-${map}` : 'уровень ' + m[1]),
          h('span', { class: 'tl-hint' }, ' portTo')));
      } else list.append(h('div', { class: 'tl-note' }, n));
    }
    list.append(h('div', { class: 'tl-item' + (i === TL.sel ? ' sel' : '') + (tlDirty(i) ? ' dirty' : ''), onclick: () => { const f = tlFgSelObj(); if (f && tlFgPair(f) !== i) TL.fgSel = null; TL.fgFocus = true; tlPick(i); } },
      h('div', { class: 'tl-item-t' }, h('span', { class: 'tl-idx' }, `${2 * i}|${2 * i + 1}`), ` ${p.name_a || '?'} → ${p.name_b || '?'}`),
      h('div', { class: 'tl-item-u' }, use.length ? use.map(tlLevelChip) : h('span', { class: 'tl-hint' }, 'нигде не используется'))));
  });
  return h('aside', { class: 'tl-list' },
    h('div', { class: 'side-tools' },
      h('input', { type: 'search', placeholder: 'Поиск: номер из tmx, название, карта…', value: TL.filter,
        oninput: e => { TL.filter = e.target.value; const s = e.target.selectionStart; tlRender(); const n = $('.tl-list input'); n.focus(); n.setSelectionRange(s, s); } }),
      h('div', { class: 'tl-hint' }, 'Число из tmx (treetype / switch2dial / switchTile) = номер слева. Плашки — уровень (portTo) и карта, 🚪 — подмена при входе через дверь.')),
    list,
    h('div', { class: 'side-foot' },
      h('button', { class: 'btn small', onclick: tlAddPair, title: 'Новая пара в конец таблицы (номера старых не меняются)' }, '+ пара'),
      h('span', { class: 'tl-hint' }, `${TL.pairs.length} пар · ${TL.pairs.length * 2} состояний`)));
}

function tlRenderHead(P) {
  const i = TL.sel;
  const dirty = tlAnyDirty();
  const tsSel = h('select', { onchange: e => { TL.bmp = e.target.value; tlRender(); } },
    TL.state.tilesets.map(t => h('option', { value: t.bmp, selected: t.bmp === TL.bmp }, t.bmp + (t.used ? '' : '  (не в build_graphics)'))));
  const use = tlUse(i).map(tlMapOf);
  const maps = TL.state.maps.slice().sort((a, b) => (use.includes(b.tmx) - use.includes(a.tmx)) || a.tmx.localeCompare(b.tmx));
  const mapSel = h('select', { onchange: e => { TL.tmx = e.target.value || null; const d = TL.state.maps.find(m => m.tmx === TL.tmx); if (d && d.tileset) TL.bmp = d.tileset; tlRender(); } },
    h('option', { value: '' }, '— без карты —'),
    maps.map(m => h('option', { value: m.tmx, selected: m.tmx === TL.tmx }, (use.includes(m.tmx) ? '★ ' : '') + m.tmx)));
  return h('div', { class: 'tl-head' },
    h('div', { class: 'tl-title' }, h('span', { class: 'tl-idx big' }, `[${2 * i}] [${2 * i + 1}]`),
      h('span', { class: 'tl-uses' }, tlUse(i).join(' · ') || 'нигде не используется')),
    h('label', null, 'Карта ', mapSel),
    h('label', null, 'Тайлсет ', tsSel),
    h('div', { class: 'spacer' }),
    tlDirty(i) && i < TL.orig.length ? h('button', { class: 'btn small ghost', onclick: () => { TL.pairs[i] = tlClone(TL.orig[i]); tlRender(); } }, 'сбросить пару') : null,
    h('button', { class: 'btn', onclick: () => tlReload(), title: 'Перечитать supertiles.cpp и карты с диска' }, '⟳ С диска'),
    h('button', { class: 'btn primary' + (dirty ? ' dirty' : ''), disabled: !dirty || TL.busy, onclick: () => tlSave(), title: 'Записать в src/supertiles.cpp (Ctrl+S)' }, 'Сохранить'));
}

function tlRenderStates(P) {
  const ts = TL.sets[TL.bmp];
  const card = side => {
    const s = P[side], idx = 2 * TL.sel + (side === 'b' ? 1 : 0);
    const num = (k, title) => h('label', { class: 'tl-num', title },
      h('span', null, { to: 'куда', from: 'откуда', len: 'сколько' }[k]),
      h('input', { type: 'number', min: 0, value: s[k], onfocus: () => { if (TL.side !== side) { TL.side = side; tlDraw(); tlMarkSide(); } },
        oninput: e => { s[k] = Math.max(0, parseInt(e.target.value, 10) || 0); s.odd = false; tlChanged(); } }));
    const issues = tlIssues(s, ts);
    return h('div', { class: 'tl-state' + (TL.side === side ? ' on' : ''), 'data-side': side, onclick: () => { if (TL.side !== side) { TL.side = side; tlDraw(); tlMarkSide(); } } },
      h('div', { class: 'tl-state-h' },
        h('span', { class: 'tl-idx' }, idx), ' ', side === 'a' ? 'слева / сверху' : 'справа / снизу',
        h('input', { class: 'tl-name', value: P['name_' + side], placeholder: 'что тут нарисовано',
          oninput: e => { P['name_' + side] = e.target.value; tlChanged(true); } })),
      h('div', { class: 'tl-nums' },
        num('to', 'Номер тайла в VRAM, куда копируем'), num('from', 'Номер тайла сжатого тайлсета, откуда берём'), num('len', 'Сколько тайлов')),
      h('div', { class: 'tl-code' }, `в коде: {${s.to * 2},${s.from * 2},${s.len}}  ·  VRAM ${s.to}…${s.to + s.len - 1} ← тайлсет ${s.from}…${s.from + s.len - 1}`),
      h('div', { class: 'tl-issues' }, issues.map(([c, m]) => h('div', { class: 'tl-issue ' + c }, (c === 'err' ? '⛔ ' : '⚠ ') + m))));
  };
  return h('div', { class: 'tl-states' }, card('a'), card('b'));
}

function tlMarkSide() { $$('.tl-state').forEach(e => e.classList.toggle('on', e.dataset.side === TL.side)); }

// мелкие правки: перерисовать канвасы и шапку без пересборки инпутов (иначе теряется фокус)
let tlTimer = null;
function tlChanged(nameOnly) {
  const P = TL.pairs[TL.sel], ts = TL.sets[TL.bmp];
  $$('.tl-state').forEach(el => {
    const s = P[el.dataset.side];
    el.querySelector('.tl-code').textContent = `в коде: {${s.to * 2},${s.from * 2},${s.len}}  ·  VRAM ${s.to}…${s.to + s.len - 1} ← тайлсет ${s.from}…${s.from + s.len - 1}`;
    const box = el.querySelector('.tl-issues'); box.innerHTML = '';
    tlIssues(s, ts).forEach(([c, m]) => box.append(h('div', { class: 'tl-issue ' + c }, (c === 'err' ? '⛔ ' : '⚠ ') + m)));
  });
  const it = $('.tl-item.sel');
  if (it) { it.classList.toggle('dirty', tlDirty(TL.sel)); it.querySelector('.tl-item-t').lastChild.textContent = ` ${P.name_a || '?'} → ${P.name_b || '?'}`; }
  const sv = $('.tl-head .btn.primary'); if (sv) { sv.disabled = !tlAnyDirty(); sv.classList.toggle('dirty', tlAnyDirty()); }
  if (nameOnly) return;
  clearTimeout(tlTimer); tlTimer = setTimeout(tlDraw, 60);
}

function tlRenderTileset() {
  const btn = (m, label, title) => h('button', { class: 'chip' + (TL.mode === m ? ' on' : ''), title, onclick: () => { TL.mode = m; tlRender(); } }, label);
  const sel = (v, opts, on) => h('select', { onchange: e => on(+e.target.value) }, opts.map(o => h('option', { value: o, selected: o === v }, o)));
  return h('div', { class: 'tl-panel tl-set-panel' },
    h('div', { class: 'tl-tools' },
      h('b', null, 'Сжатый тайлсет'),
      btn('from', '🟩 «откуда»', 'Протяните по тайлам - задаст «откуда» и «сколько». Клик - сдвинуть начало.'),
      btn('to', '🟥 «куда»', 'Протяните по тайлам - задаст «куда» и «сколько». Клик - сдвинуть начало.'),
      h('div', { class: 'spacer' }),
      h('label', null, 'в ряд ', sel(TL.perRow, [16, 32, 64], v => { TL.perRow = v; store.set('tl.perRow', v); tlDraw(); })),
      h('label', null, ' ×', sel(TL.zoom, [1, 2, 3, 4], v => { TL.zoom = v; store.set('tl.zoom', v); tlDraw(); }))),
    h('div', { class: 'tl-legend' },
      h('span', { class: 'lg from' }, 'откуда'), h('span', { class: 'lg to' }, 'куда'),
      h('span', { class: 'lg other' }, 'второе состояние'),
      h('span', { id: 'tlHover', class: 'tl-hover' }, '')),
    h('div', { class: 'tl-canvas-wrap' }, h('canvas', { id: 'tlSet' })));
}

function tlRenderMap() {
  const btn = (v, label) => h('button', { class: 'chip' + (TL.view === v ? ' on' : ''), onclick: () => { TL.view = v; tlRender(); } }, label);
  return h('div', { class: 'tl-panel tl-map-panel' },
    h('div', { class: 'tl-tools' },
      h('b', null, TL.tmx || 'Карта'),
      btn('none', 'без подмены'), btn('a', `${2 * TL.sel}`), btn('b', `${2 * TL.sel + 1}`), btn('sel', 'выбранное'),
      h('label', { title: 'Обвести на карте (жёлтым) области, нарисованные тайлами из «куда»' },
        h('input', { type: 'checkbox', checked: TL.mark, onchange: e => { TL.mark = e.target.checked; store.set('tl.mark', TL.mark); tlMapPaint(); } }), ' обвести'),
      h('label', { title: 'Показывать fgtile на карте' }, h('input', { type: 'checkbox', checked: TL.fgShow, onchange: e => { TL.fgShow = e.target.checked; store.set('tl.fgShow', TL.fgShow); tlMapPaint(); } }), ' fgtile'),
      h('label', { title: 'Показывать и остальные fgtile (двери без подмены, телепорты, кровать…)' }, h('input', { type: 'checkbox', checked: TL.fgAll, onchange: e => { TL.fgAll = e.target.checked; store.set('tl.fgAll', TL.fgAll); tlMapPaint(); } }), ' все'),
      h('button', { class: 'btn small', onclick: () => tlFgAdd(false), title: 'Новый триггер подмены для выбранной пары - в центр видимой части карты' }, '+ fgtile'),
      h('button', { class: 'btn small', onclick: () => tlFgAdd(true), title: 'Новая пара в конец таблицы и триггер для неё' }, '+ пара с fgtile'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => tlFgFocus() || toast('У этой пары нет fgtile на этой карте'), title: 'Приблизить к fgtile выбранной пары' }, '→ к fgtile'),
      h('button', { class: 'btn small', onclick: () => tlMapFit('all'), title: 'Вся карта' }, '⤢ целиком'),
      h('button', { class: 'btn small', onclick: () => tlMapFit('change'), title: 'Приблизить к меняемым местам' }, '→ к изменениям'),
      h('span', { id: 'tlMapZoom', class: 'tl-hint' }, '')),
    h('div', { class: 'tl-fg-bar', id: 'tlFgBar' }),
    h('div', { class: 'tl-map-wrap', id: 'tlMapWrap' }, TL.tmx ? h('canvas', { id: 'tlMap' }) : h('div', { class: 'tl-hint', style: 'padding:12px' }, 'Карта не выбрана — выберите в шапке.')),
    h('div', { class: 'tl-hint', id: 'tlMapHover' }, 'колёсико — масштаб, средняя (или левая) кнопка — двигать карту'));
}

// ------------------------------------------------------------ отрисовка
function tlStateFor(view) {
  const P = TL.pairs[TL.sel];
  if (view === 'none') return null;
  return P[view === 'sel' ? TL.side : view];
}

async function tlDraw() {
  const P = TL.pairs[TL.sel]; if (!P) return;
  let ts = null;
  try { ts = await tlTileset(TL.bmp); } catch (e) { toast('Тайлсет: ' + e.message, 'err'); }
  if (!ts) return;
  if (!tlDraw.seen || tlDraw.seen !== ts.bmp) { tlDraw.seen = ts.bmp; tlChanged(true); }
  tlDrawSet(ts, P);
  if (TL.tmx) {
    try { await tlFgLoad(TL.tmx); tlDrawMap(ts, await tlMap(TL.tmx)); tlFgRenderBar(); if (TL.fgFocus) { TL.fgFocus = false; tlFgFocus(); } } catch (e) { toast('Карта: ' + e.message, 'err'); }
  }
}

function tlTilePixels(ts, t, out, ow, ox, oy, orient, transparent) {
  const raw = ts.raw, pal = ts.pal32, base = t * 64;
  for (let y = 0; y < 8; y++) {
    const sy = (orient & 2) ? 7 - y : y;
    let o = (oy + y) * ow + ox;
    for (let x = 0; x < 8; x++, o++) {
      const sx = (orient & 1) ? 7 - x : x;
      const c = raw[base + sy * 8 + sx];
      if (transparent && c === 0) continue;
      out[o] = pal[c];
    }
  }
}

// Обвести ОБЛАСТЬ из клеток (а не каждую клетку): рисуем только края, у которых нет соседа.
// cells - массив [cx, cy] в целых координатах сетки, toPx(cx, cy) -> [x, y] левый верх клетки.
function tlOutline(g, cells, cell, toPx) {
  const has = new Set(cells.map(([x, y]) => x + ',' + y));
  g.beginPath();
  for (const [x, y] of cells) {
    const [px, py] = toPx(x, y);
    if (!has.has(x + ',' + (y - 1))) { g.moveTo(px, py); g.lineTo(px + cell, py); }
    if (!has.has(x + ',' + (y + 1))) { g.moveTo(px, py + cell); g.lineTo(px + cell, py + cell); }
    if (!has.has((x - 1) + ',' + y)) { g.moveTo(px, py); g.lineTo(px, py + cell); }
    if (!has.has((x + 1) + ',' + y)) { g.moveTo(px + cell, py); g.lineTo(px + cell, py + cell); }
  }
  g.stroke();
}

// Сетка тайлсета: сначала тайлы VRAM (0..v-1), потом полоса «ROM», потом остальные - с новой строки.
function tlSetLayout(ts) {
  const per = TL.perRow, z = TL.zoom, cell = 8 * z, v = TL.state.vramTiles, n = ts.optCount;
  const gut = 44, head = 18, band = 26;
  const rowsV = Math.ceil(Math.min(n, v) / per), rowsR = Math.ceil(Math.max(0, n - v) / per);
  const romY = head + rowsV * cell;
  const grid = t => t < v ? [t % per, Math.floor(t / per)] : [(t - v) % per, rowsV + 1000 + Math.floor((t - v) / per)];
  const gridPx = (cx, cy) => cy < 1000 ? [gut + cx * cell, head + cy * cell] : [gut + cx * cell, romY + band + (cy - rowsV - 1000) * cell];
  return { per, z, cell, v, n, gut, head, band, rowsV, rowsR, romY, grid, gridPx,
    W: gut + per * cell, H: romY + (rowsR ? band + rowsR * cell : 0) };
}

function tlSheet(ts, from, to, per) {   // кусок тайлсета картинкой 1:1, per тайлов в ряд
  const n = Math.max(0, to - from), rows = Math.ceil(n / per);
  const off = document.createElement('canvas'); off.width = per * 8; off.height = Math.max(1, rows * 8);
  if (!n) return off;
  const ctx = off.getContext('2d'), img = ctx.createImageData(off.width, off.height), px = new Uint32Array(img.data.buffer);
  px.fill(0xFF201a1a);
  for (let k = 0; k < n; k++) tlTilePixels(ts, from + k, px, off.width, (k % per) * 8, Math.floor(k / per) * 8, 0, false);
  ctx.putImageData(img, 0, 0);
  return off;
}

function tlDrawSet(ts, P) {
  const cv = $('#tlSet'); if (!cv) return;
  const L = tlSetLayout(ts), { cell, v, n, per } = L;
  if (!ts.sheets || ts.sheets.per !== per) ts.sheets = { per, vram: tlSheet(ts, 0, Math.min(n, v), per), rom: tlSheet(ts, v, n, per) };
  cv.width = L.W; cv.height = L.H;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0c0d10'; g.fillRect(0, 0, L.W, L.H);
  // шапка VRAM
  g.fillStyle = '#1d2129'; g.fillRect(0, 0, L.W, L.head);
  g.fillStyle = '#9fb3ff'; g.font = '600 11px system-ui'; g.textBaseline = 'middle';
  g.fillText(`VRAM фона: тайлы 0–${Math.min(n, v) - 1} (сюда пишет «куда»)`, 6, L.head / 2);
  g.drawImage(ts.sheets.vram, L.gut, L.head, per * cell, L.rowsV * cell);
  if (L.rowsR) {
    g.fillStyle = '#3a2f17'; g.fillRect(0, L.romY, L.W, L.band);
    g.fillStyle = '#e0a43a'; g.fillRect(0, L.romY, L.W, 2);
    g.fillStyle = '#f3c66f'; g.font = '700 12px system-ui';
    g.fillText(`▼ ROM: тайлы ${v}–${n - 1} — в VRAM не грузятся, отсюда только берём («откуда»)`, 6, L.romY + L.band / 2 + 1);
    g.drawImage(ts.sheets.rom, L.gut, L.romY + L.band, per * cell, L.rowsR * cell);
  }
  // номера строк слева
  g.fillStyle = '#5d6573'; g.font = '10px ui-monospace, monospace'; g.textAlign = 'right';
  const step = cell < 12 ? 4 : cell < 16 ? 2 : 1;
  for (let r = 0; r < L.rowsV; r += step) { const [, y] = L.gridPx(0, r); g.fillText(r * per, L.gut - 4, y + cell / 2); }
  for (let r = 0; r < L.rowsR; r += step) { const [, y] = L.gridPx(0, L.rowsV + 1000 + r); g.fillText(v + r * per, L.gut - 4, y + cell / 2); }
  g.textAlign = 'left';

  const cellsOf = (from, len) => { const out = []; for (let k = 0; k < len; k++) { const t = from + k; if (t < 0 || t >= n) break; out.push(L.grid(t)); } return out; };
  const area = (from, len, fill, stroke, dash, w) => {
    const cs = cellsOf(from, len); if (!cs.length) return;
    if (fill) { g.fillStyle = fill; for (const [cx, cy] of cs) { const [x, y] = L.gridPx(cx, cy); g.fillRect(x, y, cell, cell); } }
    g.save(); if (dash) g.setLineDash([4, 3]);
    if (!dash) { g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = (w || 2) + 2; tlOutline(g, cs, cell, L.gridPx); }
    g.strokeStyle = stroke; g.lineWidth = w || 2; tlOutline(g, cs, cell, L.gridPx); g.restore();
  };
  const other = P[TL.side === 'a' ? 'b' : 'a'], s = P[TL.side];
  area(other.from, other.len, null, 'rgba(120,200,255,.75)', true, 1.5);
  area(other.to, other.len, null, 'rgba(255,150,220,.75)', true, 1.5);
  area(s.to, s.len, 'rgba(239,91,91,.25)', '#ef5b5b');
  area(s.from, s.len, 'rgba(79,191,114,.25)', '#4fbf72');
  if (TL.drag) { const a = Math.min(TL.drag.a, TL.drag.b), b = Math.max(TL.drag.a, TL.drag.b); area(a, b - a + 1, 'rgba(255,255,255,.22)', '#fff'); }

  const cellAt = e => {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * cv.width / r.width - L.gut, y = (e.clientY - r.top) * cv.height / r.height;
    if (x < 0) return -1;
    const cx = Math.floor(x / cell); if (cx >= per) return -1;
    if (y >= L.head && y < L.romY) { const t = Math.floor((y - L.head) / cell) * per + cx; return t < Math.min(n, v) ? t : -1; }
    if (y >= L.romY + L.band) { const t = v + Math.floor((y - L.romY - L.band) / cell) * per + cx; return t < n ? t : -1; }
    return -1;
  };
  cv.onmousemove = e => {
    const t = cellAt(e); if (t < 0) { $('#tlHover').textContent = ''; return; }
    if (TL.drag) { TL.drag.b = t; tlDrawSet(ts, P); }
    let txt = `тайл ${t} (в коде ${t * 2})` + (t >= v ? ' · ROM' : '');
    if (t >= s.from && t < s.from + s.len) txt += ` → VRAM ${s.to + t - s.from}`;
    if (t >= s.to && t < s.to + s.len) txt += ` ← тайл ${s.from + t - s.to}`;
    $('#tlHover').textContent = txt;
  };
  cv.onmousedown = e => { if (e.button !== 0) return; const t = cellAt(e); if (t < 0) return; TL.drag = { a: t, b: t }; e.preventDefault(); };
  cv.onmouseleave = () => { $('#tlHover').textContent = ''; };
  window.onmouseup = () => {
    if (!TL.drag) return;
    const d = TL.drag; TL.drag = null;
    const a = Math.min(d.a, d.b), len = Math.abs(d.b - d.a) + 1;
    const st = TL.pairs[TL.sel][TL.side];
    st[TL.mode] = a; if (len > 1) st.len = len; st.odd = false;
    tlRender();
  };
}

// ---- карта: собираем картинку 1:1 в offscreen, показываем через «камеру» (масштаб колёсиком, перетаскивание)
function tlDrawMap(ts, map) {
  if (!$('#tlMap') || !map) return;
  const layers = map.layers.filter(l => !l.walls);
  if (!layers.length) return;
  const mw = Math.max(...layers.map(l => l.w)), mh = Math.max(...layers.map(l => l.h));
  const W = mw * 8, H = mh * 8, v = TL.state.vramTiles;
  const vram = new Int32Array(v); for (let k = 0; k < v; k++) vram[k] = k < ts.optCount ? k : -1;
  const s = tlStateFor(TL.view);
  if (s) for (let k = 0; k < s.len; k++) { const d = s.to + k, f = s.from + k; if (d >= 0 && d < v) vram[d] = f < ts.optCount ? f : -1; }
  const mk = tlStateFor('sel') || TL.pairs[TL.sel].a;
  const key = JSON.stringify([map.tmx, ts.bmp, s ? [s.to, s.from, s.len] : null, [mk.to, mk.len]]);
  if (TL.mapKey === key && TL.mapImg && TL.mv && TL.mv.tmx === map.tmx) { tlMapBind(); tlMapPaint(); return; }
  TL.mapKey = key;
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const g = off.getContext('2d'), img = g.createImageData(W, H), px = new Uint32Array(img.data.buffer);
  px.fill(ts.pal32[0]);
  const marked = new Set();
  layers.forEach((Ly, li) => {
    for (let y = 0; y < Ly.h; y++) for (let x = 0; x < Ly.w; x++) {
      const r = Ly.data[y * Ly.w + x];
      if (li > 0 && r === 0) continue;
      const e = ts.opt[r];
      if (e === undefined) continue;
      const oi = e & 1023, orient = e >> 10;
      if (oi >= v || vram[oi] < 0) {
        for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) px[(y * 8 + yy) * W + x * 8 + xx] = ((xx + yy) & 2) ? 0xFFFF00FF : 0xFF400040;
        continue;
      }
      tlTilePixels(ts, vram[oi], px, W, x * 8, y * 8, orient, li > 0);
      if (oi >= mk.to && oi < mk.to + mk.len) marked.add(x + ',' + y);
    }
  });
  g.putImageData(img, 0, 0);
  const newMap = !TL.mv || TL.mv.tmx !== map.tmx || TL.mv.W !== W || TL.mv.H !== H;
  TL.mapImg = off;
  TL.marked = [...marked].map(k => k.split(',').map(Number));
  if (newMap) { TL.mv = { tmx: map.tmx, W, H, s: 1, ox: 0, oy: 0 }; }
  tlMapBind();
  if (newMap) tlMapFit('all'); else tlMapPaint();
}

function tlMapBind() {
  const cv = $('#tlMap'), wrap = $('#tlMapWrap'); if (!cv || cv._bound) return;
  cv._bound = true;
  if (TL.ro) TL.ro.disconnect();
  TL.ro = new ResizeObserver(() => tlMapPaint()); TL.ro.observe(wrap);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, mv = TL.mv;
    const k = Math.exp(-e.deltaY * 0.0015), ns = Math.min(16, Math.max(tlMapFitScale() * 0.5, mv.s * k));
    mv.ox = mx - (mx - mv.ox) * ns / mv.s; mv.oy = my - (my - mv.oy) * ns / mv.s; mv.s = ns;
    tlMapPaint();
  }, { passive: false });
  cv.addEventListener('mousedown', e => {
    if (e.button !== 1 && e.button !== 0) return;
    e.preventDefault();   // средняя кнопка: без автопрокрутки браузера
    if (e.button === 0) {
      const r = cv.getBoundingClientRect(), hit = tlFgHit(e.clientX - r.left, e.clientY - r.top);
      if (hit) {
        const f = hit.f; tlFgSelect(f, true);
        TL.fgDrag = { id: f.id, mode: hit.mode, x: e.clientX, y: e.clientY, fx: f.x, fy: f.y, route: parseInt(f.props.route, 10) || 1, num: parseInt(f.props.num, 10) || 1, moved: false };
        return;
      }
    }
    TL.pan = { x: e.clientX, y: e.clientY, ox: TL.mv.ox, oy: TL.mv.oy, moved: false, left: e.button === 0 };
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
}

// перетаскивание карты и подсказка под курсором - один раз на всё окно
addEventListener('mousemove', e => {
  const cv = $('#tlMap');
  if (TL.fgDrag && TL.mv) {
    const d = TL.fgDrag, f = tlFgSelObj(); if (!f || f.id !== d.id) { TL.fgDrag = null; return; }
    const dx = (e.clientX - d.x) / TL.mv.s, dy = (e.clientY - d.y) / TL.mv.s;
    if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) return;
    d.moved = true;
    if (d.mode === 'resize') {
      f.props.route = String(Math.max(1, d.route + Math.round(dx / 8))); f.props.num = String(Math.max(1, d.num + Math.round(dy / 8)));
      f.w = +f.props.route * 8; f.h = +f.props.num * 8;
    } else { f.x = Math.max(0, Math.round((d.fx + dx) / 8) * 8); f.y = Math.max(0, Math.round((d.fy + dy) / 8) * 8); }
    tlMapPaint(); return;
  }
  if (TL.pan && TL.mv) { if (Math.abs(e.clientX - TL.pan.x) + Math.abs(e.clientY - TL.pan.y) > 3) TL.pan.moved = true; TL.mv.ox = TL.pan.ox + e.clientX - TL.pan.x; TL.mv.oy = TL.pan.oy + e.clientY - TL.pan.y; tlMapPaint(); return; }
  if (!cv || e.target !== cv || !TL.mv) return;
  const r = cv.getBoundingClientRect(), wx = Math.floor((e.clientX - r.left - TL.mv.ox) / TL.mv.s / 8), wy = Math.floor((e.clientY - r.top - TL.mv.oy) / TL.mv.s / 8);
  const hv = $('#tlMapHover'); if (hv) hv.textContent = `клетка ${wx}, ${wy} (пиксели ${wx * 8}, ${wy * 8}) · колёсико — масштаб, средняя/левая кнопка — двигать`;
});
addEventListener('mouseup', () => {
  if (TL.fgDrag) { const moved = TL.fgDrag.moved; TL.fgDrag = null; if (moved) tlFgChanged(); }
  if (TL.pan) { const click = TL.pan.left && !TL.pan.moved; TL.pan = null; const c = $('#tlMap'); if (c) c.style.cursor = ''; if (click && TL.fgSel) { TL.fgSel = null; tlFgChanged(); } }
});

function tlMapFitScale(bw, bh) {
  const wrap = $('#tlMapWrap'), mv = TL.mv; if (!wrap || !mv) return 1;
  return Math.min(wrap.clientWidth / (bw || mv.W), wrap.clientHeight / (bh || mv.H));
}

function tlMapFit(what) {
  const wrap = $('#tlMapWrap'), mv = TL.mv; if (!wrap || !mv) return;
  let x0 = 0, y0 = 0, x1 = mv.W, y1 = mv.H;
  if (what === 'change') {
    if (!TL.marked || !TL.marked.length) { toast('На карте нет клеток с этими тайлами'); return; }
    const xs = TL.marked.map(m => m[0]), ys = TL.marked.map(m => m[1]);
    x0 = (Math.min(...xs) - 4) * 8; y0 = (Math.min(...ys) - 4) * 8; x1 = (Math.max(...xs) + 5) * 8; y1 = (Math.max(...ys) + 5) * 8;
  }
  const s = Math.min(what === 'change' ? 6 : 16, tlMapFitScale(x1 - x0, y1 - y0));
  mv.s = s; mv.ox = (wrap.clientWidth - (x1 - x0) * s) / 2 - x0 * s; mv.oy = (wrap.clientHeight - (y1 - y0) * s) / 2 - y0 * s;
  tlMapPaint();
}

function tlMapPaint() {
  const cv = $('#tlMap'), wrap = $('#tlMapWrap'), mv = TL.mv; if (!cv || !wrap || !mv || !TL.mapImg) return;
  const dpr = window.devicePixelRatio || 1, cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = cw + 'px'; cv.style.height = ch + 'px'; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
  g.imageSmoothingEnabled = false;
  g.drawImage(TL.mapImg, mv.ox, mv.oy, mv.W * mv.s, mv.H * mv.s);
  g.strokeStyle = '#333a46'; g.lineWidth = 1; g.strokeRect(mv.ox - .5, mv.oy - .5, mv.W * mv.s + 1, mv.H * mv.s + 1);
  if (TL.mark && TL.marked && TL.marked.length) {
    const c = 8 * mv.s, toPx = (x, y) => [mv.ox + x * c, mv.oy + y * c];
    g.fillStyle = 'rgba(255,212,0,.16)';
    for (const [x, y] of TL.marked) { const [px, py] = toPx(x, y); g.fillRect(px, py, c, c); }
    g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 4; tlOutline(g, TL.marked, c, toPx);   // тёмная подложка - видно на любом фоне
    g.strokeStyle = '#ffd400'; g.lineWidth = 2; tlOutline(g, TL.marked, c, toPx);
  }
  tlFgDraw(g, mv);
  const z = $('#tlMapZoom'); if (z) z.textContent = `${Math.round(mv.s * 100)}%`;
}

// ------------------------------------------------------------ правки / сохранение
function tlAddPair() {
  const last = TL.pairs[TL.pairs.length - 1];
  const s = last ? tlClone(last.a) : { to: 0, from: 0, len: 1 };
  TL.pairs.push({ a: tlClone(s), b: tlClone(s), name_a: '', name_b: '', notes: [] });
  tlPick(TL.pairs.length - 1, true);
}

async function tlReload() {
  if (tlAnyDirty() && !confirm('Есть несохранённые правки подмены тайлов. Перечитать с диска и потерять их?')) return;
  TL.sets = {}; TL.maps = {}; TL.fgs = {}; TL.fgSel = null; TL.state = null;
  await tlLoad(true);
  toast('Перечитано с диска');
}

async function tlSave(force) {
  const edits = [];
  TL.pairs.forEach((p, i) => {
    if (!tlDirty(i)) return;
    edits.push({ idx: i < TL.orig.length ? i : null, a: p.a, b: p.b, name_a: p.name_a, name_b: p.name_b });
  });
  const fg = tlFgPayload();
  if (!edits.length && !fg.length) return;
  const bad = TL.pairs.flatMap((p, i) => tlDirty(i) ? ['a', 'b'].flatMap(k => tlIssues(p[k], TL.sets[TL.bmp]).filter(x => x[0] === 'err').map(x => `[${2 * i + (k === 'b')}] ${x[1]}`)) : []);
  if (bad.length && !confirm('Есть ошибки:\n' + bad.slice(0, 6).join('\n') + '\n\nВсё равно сохранить?')) return;
  TL.busy = true;
  try {
    const st = await api('/api/tiles/save', { hash: TL.state.hash, edits, fg, force: !!force });
    // новые fgtile получили id в tmx - выбранный остаётся выбранным
    const nid = TL.fgSel && typeof TL.fgSel === 'string' && TL.tmx && st.newIds && st.newIds[TL.tmx];
    if (nid) { const F = tlFgCur(); const k = F.list.filter(f => typeof f.id === 'string').findIndex(f => f.id === TL.fgSel); TL.fgSel = k >= 0 ? nid[k] : null; }
    TL.fgs = {};
    tlIngest(st, true);
    toast(st.changed ? (fg.length ? 'Сохранено: supertiles.cpp и ' + fg.map(x => x.tmx).join(', ') + ' — пересоберите графику (build_graphics.sh)' : 'supertiles.cpp сохранён') : 'Без изменений', 'ok');
  } catch (e) {
    if (e.status === 409 && confirm(e.message + '\n\nПерезаписать файл своими правками?')) { TL.busy = false; return tlSave(true); }
    toast('Не сохранено: ' + e.message, 'err');
  } finally { TL.busy = false; if (TL.state) tlRender(); }
}

addEventListener('keydown', e => {
  if (typeof TABS === 'undefined' || TABS.cur !== 'tiles') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); tlSave(); }
  else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); tlPick(TL.sel + (e.key === 'ArrowDown' ? 1 : -1)); }
});
addEventListener('beforeunload', e => { if (tlAnyDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ============================================================ fgtile на карте
// Триггер подмены: область начинается в клетке (x/8, y/8) из tmx, ширина route клеток,
// высота num клеток (hitBoxx в fgtile.cpp). turn 0: слева - состояние treetype, справа - +1;
// turn 1: сверху / снизу. Двери (portTo) со switch2dial/switchTile меняют тайлы на карте назначения.

const tlFgDirty = tmx => { const F = TL.fgs[tmx]; return !!F && JSON.stringify(F.list) !== F.orig; };
const tlFgPair = f => {
  const p = f.props;
  if (f.kind === 'trigger') return (parseInt(p.treetype, 10) || 0) >> 1;
  const v = parseInt(p.switch2dial ?? '-1', 10); const w = parseInt(p.switchTile ?? '-1', 10);
  return v >= 0 ? v >> 1 : w >= 0 ? w >> 1 : -1;
};
const tlFgLinked = f => {
  if (f.kind === 'trigger') return tlFgPair(f) === TL.sel;
  if (f.kind === 'door') return ['switch2dial', 'switchTile'].some(k => { const v = parseInt(f.props[k] ?? '-1', 10); return v >= 0 && (v >> 1) === TL.sel; });
  return false;
};
function tlFgRect(f) {
  if (f.kind === 'trigger') {
    const x = Math.floor(f.x / 8) * 8, y = Math.floor(f.y / 8) * 8;
    return [x, y, Math.max(1, parseInt(f.props.route, 10) || 0) * 8, Math.max(1, parseInt(f.props.num, 10) || 0) * 8];
  }
  return [f.x, f.y, f.w || 16, f.h || 16];
}
const tlFgVisible = f => TL.fgShow && (f.kind !== 'other' || TL.fgAll);
const tlFgCur = () => TL.tmx && TL.fgs[TL.tmx];
const tlFgSelObj = () => { const F = tlFgCur(); return F && F.list.find(f => f.id === TL.fgSel); };

async function tlFgLoad(tmx) {
  if (!TL.fgs[tmx]) {
    const j = await api(`/api/tiles/fg?tmx=${encodeURIComponent(tmx)}`);
    TL.fgs[tmx] = { list: j.list, orig: JSON.stringify(j.list), hash: j.hash };
  }
  return TL.fgs[tmx];
}

function tlFgDraw(g, mv) {
  const F = tlFgCur(); if (!F || !TL.fgShow) return;
  const big = 8 * mv.s >= 6;
  g.save();
  g.font = '600 11px ui-monospace, monospace'; g.textBaseline = 'bottom';
  const order = F.list.filter(tlFgVisible).sort((a, b) => (tlFgLinked(a) - tlFgLinked(b)) || ((a.id === TL.fgSel) - (b.id === TL.fgSel)));
  for (const f of order) {
    const [x, y, w, hh] = tlFgRect(f), sx = mv.ox + x * mv.s, sy = mv.oy + y * mv.s, sw = Math.max(3, w * mv.s), sh = Math.max(3, hh * mv.s);
    const linked = tlFgLinked(f), sel = f.id === TL.fgSel;
    if (f.kind === 'trigger') {
      g.fillStyle = linked ? 'rgba(0,220,255,.30)' : 'rgba(255,255,255,.10)';
      g.strokeStyle = linked ? '#00e0ff' : 'rgba(255,255,255,.75)';
      g.lineWidth = linked ? 2 : 1.5; g.setLineDash([]);
    } else if (f.kind === 'door') {
      g.fillStyle = linked ? 'rgba(255,160,40,.35)' : 'rgba(255,160,40,.12)';
      g.strokeStyle = '#ffa028'; g.lineWidth = linked ? 2 : 1.2; g.setLineDash([4, 3]);
    } else {
      g.fillStyle = 'rgba(160,160,160,.08)'; g.strokeStyle = 'rgba(170,170,170,.6)'; g.lineWidth = 1; g.setLineDash([2, 3]);
    }
    g.fillRect(sx, sy, sw, sh);
    if (sel) { g.save(); g.setLineDash([]); g.strokeStyle = '#000'; g.lineWidth = 5; g.strokeRect(sx, sy, sw, sh); g.restore(); g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.setLineDash([]); }
    g.strokeRect(sx, sy, sw, sh);
    if (f.kind === 'trigger' && big) {   // где a, где b
      g.save(); g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.beginPath();
      if (f.props.turn === '1') { g.moveTo(sx, sy + sh / 2); g.lineTo(sx + sw, sy + sh / 2); } else { g.moveTo(sx + sw / 2, sy); g.lineTo(sx + sw / 2, sy + sh); }
      g.stroke(); g.restore();
    }
    if (big || linked || sel) {
      const tt = parseInt(f.props.treetype, 10);
      const label = f.kind === 'trigger' ? `${tt}${f.props.turn === '1' ? '↕' : '↔'}${tt + 1}`
        : f.kind === 'door' ? `🚪${f.props.switch2dial && f.props.switch2dial !== '-1' ? ' ' + f.props.switch2dial : ''}${f.props.switchTile && f.props.switchTile !== '-1' ? ' +' + f.props.switchTile : ''}` : '';
      if (label) {
        g.setLineDash([]); g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(label, sx, sy - 2);
        g.fillStyle = linked ? '#7ff0ff' : f.kind === 'door' ? '#ffc070' : '#fff'; g.fillText(label, sx, sy - 2);
      }
    }
    if (sel && f.kind === 'trigger') { g.setLineDash([]); g.fillStyle = '#fff'; g.fillRect(sx + sw - 4, sy + sh - 4, 8, 8); g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(sx + sw - 4, sy + sh - 4, 8, 8); }
  }
  g.restore();
}

// попадание: сначала выбранный, потом связанные, потом остальные; угол выбранного триггера - ресайз
function tlFgHit(mx, my) {
  const F = tlFgCur(), mv = TL.mv; if (!F || !mv || !TL.fgShow) return null;
  const sel = tlFgSelObj();
  if (sel && sel.kind === 'trigger') {
    const [x, y, w, hh] = tlFgRect(sel), ex = mv.ox + (x + w) * mv.s, ey = mv.oy + (y + hh) * mv.s;
    if (Math.abs(mx - ex) <= 7 && Math.abs(my - ey) <= 7) return { f: sel, mode: 'resize' };
  }
  const cand = F.list.filter(tlFgVisible).sort((a, b) => ((b.id === TL.fgSel) - (a.id === TL.fgSel)) || (tlFgLinked(b) - tlFgLinked(a)) || ((a.kind === 'other') - (b.kind === 'other')));
  for (const f of cand) {
    const [x, y, w, hh] = tlFgRect(f), sx = mv.ox + x * mv.s, sy = mv.oy + y * mv.s;
    const pad = 3;   // тонкие (1 клетка) триггеры тоже должны ловиться при малом масштабе
    if (mx >= sx - pad && mx <= sx + Math.max(3, w * mv.s) + pad && my >= sy - pad && my <= sy + Math.max(3, hh * mv.s) + pad) return { f, mode: 'move' };
  }
  return null;
}

function tlFgSelect(f, fromMap) {
  TL.fgSel = f ? f.id : null;
  if (f) {
    const p = tlFgPair(f);
    if (p >= 0 && p < TL.pairs.length && p !== TL.sel) {   // tlPick перерисует всё
      tlPick(p, false, true);
      const it = $('.tl-item.sel'); if (it) it.scrollIntoView({ block: 'center' });
      return;
    }
  }
  tlFgRenderBar(); tlMapPaint();
  if (fromMap && f) { const it = $('.tl-item.sel'); if (it) it.scrollIntoView({ block: 'nearest' }); }
}

function tlFgChanged() {
  tlFgRenderBar(); tlMapPaint();
  const sv = $('.tl-head .btn.primary'); if (sv) { sv.disabled = !tlAnyDirty(); sv.classList.toggle('dirty', tlAnyDirty()); }
}

function tlFgAdd(withPair) {
  const F = tlFgCur(), mv = TL.mv, wrap = $('#tlMapWrap');
  if (!F || !mv || !wrap) { toast('Сначала выберите карту'); return; }
  if (withPair) tlAddPair();
  const x = Math.max(0, Math.floor((wrap.clientWidth / 2 - mv.ox) / mv.s / 8) * 8), y = Math.max(0, Math.floor((wrap.clientHeight / 2 - mv.oy) / mv.s / 8) * 8);
  const f = { id: 'n' + (++TL.fgSeq), x, y, w: 8, h: 96, kind: 'trigger', props: { treetype: String(2 * TL.sel), turn: '0', route: '1', num: '12' } };
  tlFgCur().list.push(f);
  TL.fgSel = f.id;
  if (withPair) { tlRender(); } else tlFgChanged();
  toast(`fgtile добавлен в центр карты: ${2 * TL.sel}↔${2 * TL.sel + 1}. Перетащите на место.`);
}

function tlFgDelete() {
  const F = tlFgCur(), f = tlFgSelObj(); if (!F || !f) return;
  F.list.splice(F.list.indexOf(f), 1); TL.fgSel = null; tlFgChanged();
}

function tlFgRenderBar() {
  const bar = $('#tlFgBar'); if (!bar) return;
  bar.innerHTML = '';
  const f = tlFgSelObj();
  if (!f) {
    bar.append(h('span', { class: 'tl-hint' }, 'Клик по fgtile — выбрать (и его пару в списке) · тащить — двигать · белый уголок — размер · Del — удалить · стрелки — сдвиг на клетку'));
    return;
  }
  const upd = (k, v, isProp = true) => { if (isProp) f.props[k] = String(v); else f[k] = v; if (f.kind === 'trigger') { f.w = (parseInt(f.props.route, 10) || 1) * 8; f.h = (parseInt(f.props.num, 10) || 1) * 8; } tlFgChanged(); };
  const num = (label, k, val, isProp = true, title = '') => h('label', { class: 'tl-fg-f', title }, label,
    h('input', { type: 'number', value: val, onchange: e => { upd(k, parseInt(e.target.value, 10) || 0, isProp); if (k === 'treetype' || k === 'switch2dial' || k === 'switchTile') tlFgSelect(f); } }));
  const kindTxt = { trigger: 'триггер подмены', door: 'дверь', other: 'fgtile' }[f.kind];
  bar.append(h('b', null, `${kindTxt} #${typeof f.id === 'string' ? 'новый' : f.id}`));
  if (f.kind === 'trigger') {
    const tt = parseInt(f.props.treetype, 10) || 0;
    bar.append(num('treetype', 'treetype', tt, true, 'Номер состояния a (чётный); b = treetype+1'),
      h('label', { class: 'tl-fg-f' }, 'turn', h('select', { onchange: e => upd('turn', e.target.value) },
        h('option', { value: '0', selected: f.props.turn !== '1' }, '0 ↔ слева a / справа b'),
        h('option', { value: '1', selected: f.props.turn === '1' }, '1 ↕ сверху a / снизу b'))),
      num('ширина (route)', 'route', parseInt(f.props.route, 10) || 0, true, 'клеток по 8 px'),
      num('высота (num)', 'num', parseInt(f.props.num, 10) || 0, true, 'клеток по 8 px'));
    if (tt % 2) bar.append(h('span', { class: 'tl-issue warn' }, '⚠ нечётный treetype — возьмёт половины двух пар'));
    if ((tt >> 1) >= TL.pairs.length) bar.append(h('span', { class: 'tl-issue err' }, '⛔ такой пары нет'));
    if (f.props.num === '99' || f.props.num === '10') bar.append(h('span', { class: 'tl-issue err' }, '⛔ num 99/10 игра не считает подменой'));
  } else if (f.kind === 'door') {
    bar.append(num('switch2dial', 'switch2dial', parseInt(f.props.switch2dial ?? '-1', 10)), num('switchTile', 'switchTile', parseInt(f.props.switchTile ?? '-1', 10)),
      h('span', { class: 'tl-hint' }, `portTo ${f.props.portTo} → ${(TL.state.levels || {})[f.props.portTo] || '?'}`));
  } else {
    bar.append(h('span', { class: 'tl-hint' }, Object.entries(f.props).map(([k, v]) => `${k}=${v}`).join(' · ')));
  }
  bar.append(num('x', 'x', f.x, false, 'пиксели'), num('y', 'y', f.y, false, 'пиксели'),
    h('button', { class: 'btn small', onclick: tlFgDelete, title: 'Удалить fgtile (Del)' }, '🗑'));
}

function tlFgFocus() {   // приблизить к связанным с парой fgtile
  const F = tlFgCur(), wrap = $('#tlMapWrap'), mv = TL.mv; if (!F || !wrap || !mv) return false;
  const L = F.list.filter(tlFgLinked); if (!L.length) return false;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const f of L) { const [x, y, w, hh] = tlFgRect(f); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + hh); }
  x0 -= 96; y0 -= 96; x1 += 96; y1 += 96;
  const s = Math.min(3, tlMapFitScale(x1 - x0, y1 - y0));
  mv.s = s; mv.ox = (wrap.clientWidth - (x1 - x0) * s) / 2 - x0 * s; mv.oy = (wrap.clientHeight - (y1 - y0) * s) / 2 - y0 * s;
  tlMapPaint(); return true;
}

function tlFgPayload() {
  const out = [];
  for (const [tmx, F] of Object.entries(TL.fgs)) {
    if (!tlFgDirty(tmx)) continue;
    const orig = JSON.parse(F.orig), byId = new Map(orig.map(f => [f.id, JSON.stringify(f)]));
    const ids = new Set(F.list.map(f => f.id));
    out.push({
      tmx, hash: F.hash,
      changed: F.list.filter(f => typeof f.id === 'number' && byId.get(f.id) !== JSON.stringify(f)),
      added: F.list.filter(f => typeof f.id === 'string'),
      deleted: orig.filter(f => !ids.has(f.id)).map(f => f.id),
    });
  }
  return out;
}

addEventListener('keydown', e => {
  if (typeof TABS === 'undefined' || TABS.cur !== 'tiles' || !TL.fgSel) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const f = tlFgSelObj(); if (!f) return;
  const d = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
  if (d && !e.altKey) { e.preventDefault(); f.x = Math.max(0, f.x + d[0]); f.y = Math.max(0, f.y + d[1]); tlFgChanged(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); tlFgDelete(); }
  else if (e.key === 'Escape') { TL.fgSel = null; tlFgChanged(); }
});
