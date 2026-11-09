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
};

const tlClone = o => JSON.parse(JSON.stringify(o));
const tlKey = p => JSON.stringify([p.a.to, p.a.from, p.a.len, p.b.to, p.b.from, p.b.len, p.name_a, p.name_b]);
const tlDirty = i => i >= TL.orig.length || tlKey(TL.pairs[i]) !== tlKey(TL.orig[i]);
const tlAnyDirty = () => TL.pairs.some((_, i) => tlDirty(i));
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
  tlPick(TL.sel, true);
}

// выбрать пару; карта/тайлсет по умолчанию - из «где используется»
function tlPick(i, force) {
  if (i < 0 || i >= TL.pairs.length) return;
  const changed = force || i !== TL.sel;
  TL.sel = i; store.set('tl.sel', i);
  if (changed) {
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
    P ? [tlRenderHead(P), tlRenderStates(P), tlRenderTileset(), tlRenderMap()] : h('div', { class: 'empty' }, 'Таблица пуста'))));
  tlDraw();
}

function tlRenderList() {
  const q = TL.filter.trim().toLowerCase();
  const list = h('div', { class: 'tl-items' });
  TL.pairs.forEach((p, i) => {
    const use = tlUse(i);
    const text = `[${2 * i}] [${2 * i + 1}] ${p.name_a} ${p.name_b} ${use.join(' ')} ${(p.notes || []).join(' ')}`.toLowerCase();
    if (q && !text.includes(q)) return;
    if (p.notes && p.notes.length && !q) for (const n of p.notes) list.append(h('div', { class: 'tl-note' }, n));
    list.append(h('div', { class: 'tl-item' + (i === TL.sel ? ' sel' : '') + (tlDirty(i) ? ' dirty' : ''), onclick: () => tlPick(i) },
      h('div', { class: 'tl-item-t' }, h('span', { class: 'tl-idx' }, `${2 * i}|${2 * i + 1}`), ` ${p.name_a || '?'} → ${p.name_b || '?'}`),
      h('div', { class: 'tl-item-u' }, use.length ? use.join(', ') : 'нигде не используется')));
  });
  return h('aside', { class: 'tl-list' },
    h('div', { class: 'side-tools' },
      h('input', { type: 'search', placeholder: 'Поиск: номер из tmx, название, карта…', value: TL.filter,
        oninput: e => { TL.filter = e.target.value; const s = e.target.selectionStart; tlRender(); const n = $('.tl-list input'); n.focus(); n.setSelectionRange(s, s); } }),
      h('div', { class: 'tl-hint' }, 'Число из tmx (treetype / switch2dial / switchTile) = номер слева.')),
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
  return h('div', { class: 'tl-block' },
    h('div', { class: 'tl-tools' },
      h('b', null, 'Сжатый тайлсет'),
      h('span', { class: 'tl-hint' }, 'мышью по тайлсету:'),
      btn('from', '🟩 выделить «откуда»', 'Протяните по тайлам - задаст «откуда» и «сколько». Клик - сдвинуть начало.'),
      btn('to', '🟥 выделить «куда»', 'Протяните по тайлам - задаст «куда» и «сколько». Клик - сдвинуть начало.'),
      h('div', { class: 'spacer' }),
      h('label', null, 'в ряд ', sel(TL.perRow, [16, 32, 64], v => { TL.perRow = v; store.set('tl.perRow', v); tlDraw(); })),
      h('label', null, ' масштаб ', sel(TL.zoom, [1, 2, 3, 4], v => { TL.zoom = v; store.set('tl.zoom', v); tlDraw(); }))),
    h('div', { class: 'tl-legend' },
      h('span', { class: 'lg from' }, 'откуда'), h('span', { class: 'lg to' }, 'куда (эти тайлы VRAM заменятся)'),
      h('span', { class: 'lg other' }, 'второе состояние пары'), h('span', { class: 'lg out' }, 'вне VRAM: только как «откуда»'),
      h('span', { id: 'tlHover', class: 'tl-hover' }, '')),
    h('div', { class: 'tl-canvas-wrap' }, h('canvas', { id: 'tlSet' })));
}

function tlRenderMap() {
  const btn = (v, label) => h('button', { class: 'chip' + (TL.view === v ? ' on' : ''), onclick: () => { TL.view = v; tlRender(); } }, label);
  const sel = (v, opts, on) => h('select', { onchange: e => on(+e.target.value) }, opts.map(o => h('option', { value: o, selected: o === v }, o)));
  return h('div', { class: 'tl-block' },
    h('div', { class: 'tl-tools' },
      h('b', null, 'Карта ' + (TL.tmx || '')),
      btn('none', 'без подмены'), btn('a', `как в ${2 * TL.sel}`), btn('b', `как в ${2 * TL.sel + 1}`), btn('sel', 'как в выбранном'),
      h('label', { title: 'Обвести клетки карты, которые нарисованы тайлами из «куда»' },
        h('input', { type: 'checkbox', checked: TL.mark, onchange: e => { TL.mark = e.target.checked; store.set('tl.mark', TL.mark); tlDraw(); } }), ' обвести меняемое'),
      h('button', { class: 'btn small', onclick: tlScrollToChange }, '→ к изменениям'),
      h('div', { class: 'spacer' }),
      h('label', null, 'масштаб ', sel(TL.mapZoom, [1, 2, 3], v => { TL.mapZoom = v; store.set('tl.mapZoom', v); tlDraw(); }))),
    h('div', { class: 'tl-map-wrap', id: 'tlMapWrap' }, TL.tmx ? h('canvas', { id: 'tlMap' }) : h('div', { class: 'tl-hint', style: 'padding:12px' }, 'Карта не выбрана — превью нет. Выберите карту в шапке.')));
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
  // пересчитать проверки «откуда» под только что загруженный тайлсет
  if (!tlDraw.seen || tlDraw.seen !== ts.bmp) { tlDraw.seen = ts.bmp; tlChanged(true); }
  tlDrawSet(ts, P);
  if (TL.tmx) {
    try { tlDrawMap(ts, await tlMap(TL.tmx)); } catch (e) { toast('Карта: ' + e.message, 'err'); }
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

function tlDrawSet(ts, P) {
  const cv = $('#tlSet'); if (!cv) return;
  const n = ts.optCount, per = TL.perRow, rows = Math.ceil(n / per), z = TL.zoom, cell = 8 * z;
  const W = per * 8, H = rows * 8;
  if (!ts.sheet || ts.sheetPer !== per) {   // сама картинка тайлсета кэшируется
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const ctx = off.getContext('2d'), img = ctx.createImageData(W, H), px = new Uint32Array(img.data.buffer);
    px.fill(0xFF201a1a);
    for (let t = 0; t < n; t++) tlTilePixels(ts, t, px, W, (t % per) * 8, Math.floor(t / per) * 8, 0, false);
    ctx.putImageData(img, 0, 0);
    ts.sheet = off; ts.sheetPer = per;
  }
  cv.width = W * z; cv.height = H * z;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(ts.sheet, 0, 0, W * z, H * z);
  const v = TL.state.vramTiles;
  const xy = t => [(t % per) * cell, Math.floor(t / per) * cell];
  // вне VRAM - притушить
  g.fillStyle = 'rgba(0,0,0,.45)';
  for (let t = v; t < n; t++) { const [x, y] = xy(t); g.fillRect(x, y, cell, cell); }
  // граница VRAM
  if (v < n) { const [x, y] = xy(v); g.strokeStyle = '#e0a43a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y + cell); g.lineTo(x, y + cell); g.lineTo(x, y); g.lineTo(W * z, y); g.stroke(); }
  const range = (from, len, fill, stroke, dash) => {
    g.save(); g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = Math.max(1, z * .75); if (dash) g.setLineDash([3, 3]);
    for (let k = 0; k < len; k++) { const t = from + k; if (t >= rows * per) break; const [x, y] = xy(t); if (fill) g.fillRect(x, y, cell, cell); g.strokeRect(x + .5, y + .5, cell - 1, cell - 1); }
    g.restore();
  };
  const other = P[TL.side === 'a' ? 'b' : 'a'], s = P[TL.side];
  range(other.from, other.len, null, 'rgba(120,200,255,.6)', true);
  range(other.to, other.len, null, 'rgba(255,150,220,.6)', true);
  range(s.to, s.len, 'rgba(239,91,91,.28)', '#ef5b5b');
  range(s.from, s.len, 'rgba(79,191,114,.28)', '#4fbf72');
  if (TL.drag) { const a = Math.min(TL.drag.a, TL.drag.b), b = Math.max(TL.drag.a, TL.drag.b); range(a, b - a + 1, 'rgba(255,255,255,.25)', '#fff'); }

  const cellAt = e => { const r = cv.getBoundingClientRect(); const cx = Math.floor((e.clientX - r.left) / cell), cy = Math.floor((e.clientY - r.top) / cell); return cx < 0 || cx >= per ? -1 : cy * per + cx; };
  cv.onmousemove = e => {
    const t = cellAt(e); if (t < 0 || t >= n) { $('#tlHover').textContent = ''; return; }
    if (TL.drag) { TL.drag.b = t; tlDrawSet(ts, P); }
    let txt = `тайл ${t} (в коде ${t * 2})` + (t >= v ? ' · вне VRAM' : '');
    if (t >= s.from && t < s.from + s.len) txt += ` · встанет в VRAM ${s.to + t - s.from}`;
    if (t >= s.to && t < s.to + s.len) txt += ` · сюда встанет тайл ${s.from + t - s.to}`;
    $('#tlHover').textContent = txt;
  };
  cv.onmousedown = e => { const t = cellAt(e); if (t < 0 || t >= n) return; TL.drag = { a: t, b: t }; e.preventDefault(); };
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

function tlDrawMap(ts, map) {
  const cv = $('#tlMap'); if (!cv || !map) return;
  const layers = map.layers.filter(l => !l.walls);
  if (!layers.length) return;
  const mw = Math.max(...layers.map(l => l.w)), mh = Math.max(...layers.map(l => l.h));
  const W = mw * 8, H = mh * 8, v = TL.state.vramTiles;
  // что лежит в каждом тайле VRAM при выбранном режиме
  const vram = new Int32Array(v); for (let k = 0; k < v; k++) vram[k] = k < ts.optCount ? k : -1;
  const s = tlStateFor(TL.view);
  if (s) for (let k = 0; k < s.len; k++) { const d = s.to + k, f = s.from + k; if (d >= 0 && d < v) vram[d] = f < ts.optCount ? f : -1; }
  const mk = TL.mark ? (tlStateFor('sel') || TL.pairs[TL.sel].a) : null;
  cv.width = W; cv.height = H;
  cv.style.width = (W * TL.mapZoom) + 'px'; cv.style.height = (H * TL.mapZoom) + 'px';
  const g = cv.getContext('2d'), img = g.createImageData(W, H), px = new Uint32Array(img.data.buffer);
  px.fill(ts.pal32[0]);
  const marked = [];
  layers.forEach((L, li) => {
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const r = L.data[y * L.w + x];
      if (li > 0 && r === 0) continue;
      const e = ts.opt[r];
      if (e === undefined) continue;
      const oi = e & 1023, orient = e >> 10;
      if (oi >= v || vram[oi] < 0) {   // за VRAM или мусор - пурпурным
        for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) px[(y * 8 + yy) * W + x * 8 + xx] = ((xx + yy) & 2) ? 0xFFFF00FF : 0xFF400040;
        continue;
      }
      tlTilePixels(ts, vram[oi], px, W, x * 8, y * 8, orient, li > 0);
      if (mk && oi >= mk.to && oi < mk.to + mk.len) marked.push([x, y]);
    }
  });
  g.putImageData(img, 0, 0);
  if (marked.length) {
    g.strokeStyle = 'rgba(239,91,91,.9)'; g.lineWidth = 1;
    for (const [x, y] of marked) g.strokeRect(x * 8 + .5, y * 8 + .5, 7, 7);
  }
  TL.marked = marked;
}

function tlScrollToChange() {
  const w = $('#tlMapWrap'); if (!w || !TL.marked || !TL.marked.length) { toast('На карте нет клеток с этими тайлами'); return; }
  const xs = TL.marked.map(m => m[0]), ys = TL.marked.map(m => m[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 * 8 * TL.mapZoom, cy = (Math.min(...ys) + Math.max(...ys)) / 2 * 8 * TL.mapZoom;
  w.scrollTo({ left: cx - w.clientWidth / 2, top: cy - w.clientHeight / 2, behavior: 'smooth' });
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
  TL.sets = {}; TL.maps = {}; TL.state = null;
  await tlLoad(true);
  toast('Перечитано с диска');
}

async function tlSave(force) {
  const edits = [];
  TL.pairs.forEach((p, i) => {
    if (!tlDirty(i)) return;
    edits.push({ idx: i < TL.orig.length ? i : null, a: p.a, b: p.b, name_a: p.name_a, name_b: p.name_b });
  });
  if (!edits.length) return;
  const bad = TL.pairs.flatMap((p, i) => tlDirty(i) ? ['a', 'b'].flatMap(k => tlIssues(p[k], TL.sets[TL.bmp]).filter(x => x[0] === 'err').map(x => `[${2 * i + (k === 'b')}] ${x[1]}`)) : []);
  if (bad.length && !confirm('Есть ошибки:\n' + bad.slice(0, 6).join('\n') + '\n\nВсё равно сохранить?')) return;
  TL.busy = true;
  try {
    const st = await api('/api/tiles/save', { hash: TL.state.hash, edits, force: !!force });
    tlIngest(st, true);
    toast(st.changed ? 'supertiles.cpp сохранён' : 'Без изменений', 'ok');
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
