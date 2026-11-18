// ============================================================ Вкладка «Тайлсет»: чистка, упаковка картинки, сжатие, tmx
// Шесть шагов, у каждого свои кнопки и параметры. Вся математика (сжатие как в tmx2incl, раскладка,
// пересчёт supertiles.cpp) - на сервере (tpcore.py); здесь только выбор и показ.
// Тайл = ячейка bmp 8x8. «Класс» = тайл с учётом повторов и отражений (столько места он занимает в VRAM).
// Ориентация o: бит 0 - зеркало по X, бит 1 - по Y.

const TPK = {
  built: false, st: null, bmp: null, maps: [], off: {}, limit: 864,
  scan: null, sel: new Set(), cellRoot: null, tsImg: null,
  pic: null, picImg: null, repl: {}, locked: new Set(), sugg: null, wantSugg: false, doAuto: false,
  auto: { existing: true, new: true }, layout: { mode: 'packed', width: 32 }, place: { mode: 'holes', row: 0, col: 0 },
  areas: new Set(), skip: new Set(), mode1: 'del', target: { mode: 'copy', name: '', dir: 'resources/tilepack_out' },
  plan: null, pick: null, zoom: store.get('tpk.zoom', 2), showD: false, rows: 40, filter: 'all',
  export: { name: 'building', layer: 'building', outDir: 'resources/tilepack_out', tsx: '' },
  busy: false, again: false, log: [], timer: null, el: {},
};

const tpkNum = n => (n == null ? '-' : String(n));

async function openTilepack() {
  const root = $('#tilepack');
  root.hidden = false;
  if (!TPK.built) tpkBuild(root);
  if (!TPK.st) await tpkInit();
}

function tpkBuild(root) {
  TPK.built = true;
  const card = (n, title) => h('section', { class: 'tp-card' }, h('h3', null, h('span', { class: 'tp-n' }, n), ' ', title));
  const e = TPK.el;
  e.head = h('div', { class: 'tp-head' });
  e.c1 = card(1, 'Неиспользуемые тайлы'); e.b1 = h('div', { class: 'tp-body' }); e.c1.append(e.b1);
  e.c2 = card(2, 'Сколько места'); e.b2 = h('div', { class: 'tp-body' }); e.c2.append(e.b2);
  e.c3 = card(3, 'Картинка'); e.b3 = h('div', { class: 'tp-body' }); e.c3.append(e.b3);
  e.c4 = card(4, 'Сжатие'); e.b4 = h('div', { class: 'tp-body' }); e.c4.append(e.b4);
  e.c5 = card(5, 'Размещение и запись в bmp'); e.b5 = h('div', { class: 'tp-body' }); e.c5.append(e.b5);
  e.c6 = card(6, 'Карта (tmx) со зданием'); e.b6 = h('div', { class: 'tp-body' }); e.c6.append(e.b6);
  root.append(h('div', { class: 'tp-main' }, e.head, e.c1, e.c2, e.c3, e.c4, e.c5, e.c6));
}

async function tpkInit() {
  try {
    TPK.st = await api('/api/tilepack/state');
    TPK.limit = TPK.st.limit;
    TPK.export.outDir = TPK.st.outDir; TPK.target.dir = TPK.st.outDir;
    const want = store.get('tpk.bmp', '');
    const t = TPK.st.tilesets.find(x => x.bmp === want) || TPK.st.tilesets.find(x => x.used && x.maps.length) || TPK.st.tilesets[0];
    if (!t) throw new Error('в images/ нет тайлсетов mts-*.bmp');
    tpkPickBmp(t);
    await tpkScan();
  } catch (err) {
    TPK.el.head.replaceChildren(h('div', { class: 'tp-err' }, 'Не удалось загрузить: ' + err.message));
  }
}

// ------------------------------------------------------------------ обмен с сервером

function tpkPickBmp(t) {
  TPK.bmp = t.bmp; store.set('tpk.bmp', t.bmp);
  const saved = store.get('tpk.maps.' + t.bmp, null);
  TPK.maps = (saved || t.maps).filter(m => TPK.st.allMaps.some(a => a.tmx === m));
  TPK.off = {}; TPK.sel = new Set(); TPK.areas = new Set(); TPK.skip = new Set();
  TPK.target.name = t.bmp.replace(/\.bmp$/i, '') + '_new';
}

function tpkLayers() {
  const res = {};
  for (const tmx of TPK.maps) {
    const ls = (TPK.scan && TPK.scan.layers[tmx]) || [];
    const off = TPK.off[tmx] || new Set();
    if (ls.length) res[tmx] = ls.map(l => l.name).filter(n => !off.has(n));
  }
  return res;
}

function tpkPayload(withPic = true) {
  const p = { bmp: TPK.bmp, maps: TPK.maps, layers: tpkLayers(), limit: TPK.limit, delete: [...TPK.sel], areas: [...TPK.areas], target: TPK.target, tsx: TPK.export.tsx };
  if (withPic && TPK.pic) {
    Object.assign(p, { img: TPK.pic.id, repl: TPK.repl, skip: [...TPK.skip], locked: [...TPK.locked], auto: TPK.auto,
      layout: TPK.layout, place: TPK.place });
  }
  return p;
}

function tpkLoadImg(src) {
  return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('картинка не загрузилась')); i.src = src; });
}

async function tpkScan(keepSel) {
  try {
    if (!keepSel) TPK.sel = new Set();
    const sc = await api('/api/tilepack/scan', Object.assign(tpkPayload(false), { delete: [...TPK.sel] }));
    TPK.scan = sc;
    TPK.cellRoot = new Array(sc.status.length).fill(-1);
    for (const [r, cells] of Object.entries(sc.groups)) for (const c of cells) TPK.cellRoot[c] = +r;
    TPK.tsImg = await tpkLoadImg('/api/tilepack/bmp.png?bmp=' + encodeURIComponent(TPK.bmp) + '&t=' + sc.mtime);
    tpkRenderAll();
    if (TPK.pic) tpkRefresh();
  } catch (err) { toast(err.message, 'err'); }
}

// пересчёт плана (шаги 2-5); вызовы схлопываются, пока идёт запрос
async function tpkRefresh(opts = {}) {
  clearTimeout(TPK.timer);
  if (TPK.busy) { TPK.again = true; if (opts.suggest) TPK.wantSugg = true; if (opts.auto) TPK.doAuto = true; return; }
  TPK.busy = true;
  const body = Object.assign(tpkPayload(true), { images: !!TPK.pic, suggest: TPK.wantSugg || !!opts.suggest, doAuto: TPK.doAuto || !!opts.auto });
  TPK.wantSugg = false; TPK.doAuto = false;
  tpkBusyMark(true);
  try {
    const pl = await api('/api/tilepack/plan', body);
    TPK.plan = pl;
    if (pl.suggest) TPK.sugg = pl.suggest;
    if (pl.repl) TPK.repl = pl.repl;
    TPK.replOk = JSON.stringify(TPK.repl);
    if (pl.images) {
      TPK.finalImg = await tpkLoadImg(pl.images.final);
      TPK.afterImg = pl.images.after ? await tpkLoadImg(pl.images.after) : null;
    }
  } catch (err) {   // не роняем картинку и замены: возвращаем последнее удачное состояние
    toast(err.message, 'err');
    try { TPK.repl = JSON.parse(TPK.replOk || '{}'); } catch (e2) { TPK.repl = {}; }
    if (!TPK.plan) TPK.plan = null;
  }
  TPK.busy = false;
  tpkBusyMark(false);
  tpkRenderAll();
  if (TPK.again) { TPK.again = false; tpkRefresh(); }
}

function tpkLater() { clearTimeout(TPK.timer); TPK.timer = setTimeout(() => tpkRefresh(), 350); }
function tpkBusyMark(on) { TPK.el.c1.classList.toggle('tp-busy', on); TPK.el.c4.classList.toggle('tp-busy', on); TPK.el.c5.classList.toggle('tp-busy', on); }

// ------------------------------------------------------------------ рисование

function tpkTile(src, cell, srcTw, o, z) {
  const c = h('canvas', { width: 8 * z, height: 8 * z, class: 'tp-thumb' });
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (o & 1) { g.translate(8 * z, 0); g.scale(-1, 1); }
  if (o & 2) { g.translate(0, 8 * z); g.scale(1, -1); }
  g.drawImage(src, (cell % srcTw) * 8, Math.floor(cell / srcTw) * 8, 8, 8, 0, 0, 8 * z, 8 * z);
  return c;
}

function tpkTargetTile(id, o, z) {
  const cell = +id.slice(1);
  if (id[0] === 'e') return tpkTile(TPK.tsImg, cell, TPK.scan.tw, o, z);
  return tpkTile(TPK.picImg, cell, TPK.pic.w, o, z);
}

function tpkDrawSet() {
  const cv = TPK.el.setCanvas; if (!cv || !TPK.scan) return;
  const { tw, th, status } = TPK.scan, z = TPK.zoom, S = 8 * z;
  cv.width = tw * S; cv.height = th * S;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(TPK.tsImg, 0, 0, cv.width, cv.height);
  const mir = new Set((TPK.plan && TPK.plan.tiles && TPK.plan.tiles.mirrorCells) || []);
  for (let i = 0; i < status.length; i++) {
    const x = (i % tw) * S, y = Math.floor(i / tw) * S, s = status[i];
    if (TPK.sel.has(TPK.cellRoot[i])) {
      g.fillStyle = s === 'f' ? 'rgba(230,60,50,.55)' : 'rgba(255,150,0,.6)'; g.fillRect(x, y, S, S);
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 2, y + 2); g.lineTo(x + S - 2, y + S - 2); g.moveTo(x + S - 2, y + 2); g.lineTo(x + 2, y + S - 2); g.stroke();
    }
    if (mir.has(i)) { g.fillStyle = 'rgba(170,90,255,.18)'; g.fillRect(x, y, S, S); g.setLineDash([3, 2]); g.strokeStyle = '#b05cff'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, S - 1, S - 1); g.setLineDash([]); }
    if (TPK.areas.has(i)) { g.fillStyle = 'rgba(170,90,255,.4)'; g.fillRect(x, y, S, S); g.strokeStyle = '#b05cff'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, S - 2, S - 2); }
    if (s === 'f') {
      g.strokeStyle = '#ff4a3d'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, S - 1, S - 1);
    } else if (s === 'p') { g.strokeStyle = '#27c7e8'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, S - 2, S - 2); }
    else if (s === 'd' && TPK.showD) { g.fillStyle = 'rgba(120,120,120,.5)'; g.fillRect(x, y, S, S); }
  }
}

function tpkDrawAfter() {
  const cv = TPK.el.afterCanvas; if (!cv) return;
  const pl = TPK.plan, img = TPK.afterImg;
  if (!img) { cv.width = 1; cv.height = 1; return; }
  const z = 2, S = 8 * z, tw = TPK.scan.tw;
  cv.width = img.width * z; cv.height = img.height * z;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, cv.width, cv.height);
  g.strokeStyle = '#3ddc84'; g.lineWidth = 1;
  for (const [r, c] of pl.layout.pos) g.strokeRect(c * S + .5, r * S + .5, S - 1, S - 1);
  g.strokeStyle = '#ff4a3d'; g.lineWidth = 2;
  for (const a of pl.layout.conflicts) g.strokeRect((a % tw) * S + 1, Math.floor(a / tw) * S + 1, S - 2, S - 2);
}

function tpkCellAt(ev, cv, z, tw) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) * cv.width / r.width / (8 * z));
  const y = Math.floor((ev.clientY - r.top) * cv.height / r.height / (8 * z));
  return { x, y, cell: y * tw + x };
}

// ------------------------------------------------------------------ отрисовка шагов

function tpkRenderAll() {
  tpkRenderHead(); tpkRender1(); tpkRender2(); tpkRender3(); tpkRender4(); tpkRender5(); tpkRender6();
}

function tpkBtn(label, fn, cls = '', title = '') {
  return h('button', { class: 'btn small ' + cls, onclick: fn, title }, label);
}

function tpkField(label, input, hint) {
  return h('label', { class: 'tp-field' }, h('span', null, label), input, hint ? h('span', { class: 'tl-hint' }, hint) : null);
}

function tpkRenderHead() {
  const st = TPK.st, sc = TPK.scan, e = TPK.el;
  if (!st) return;
  const sel = h('select', { onchange: ev => { tpkPickBmp(st.tilesets.find(x => x.bmp === ev.target.value)); tpkScan(); } },
    ...st.tilesets.map(t => h('option', { value: t.bmp, selected: t.bmp === TPK.bmp }, t.bmp + (t.used ? '' : '  (не в сборке)'))));
  const pick = h('details', { class: 'tp-pick' }, h('summary', null, 'Карты, по которым считаем (' + TPK.maps.length + ' из ' + st.allMaps.length + ')'),
    h('div', { class: 'tp-maplist' }, ...st.allMaps.map(m => h('label', { class: 'tp-chk', title: 'тайлсет карты по .tsx: ' + (m.bmp || '?') },
      h('input', { type: 'checkbox', checked: TPK.maps.includes(m.tmx), onchange: ev => {
        TPK.maps = ev.target.checked ? [...TPK.maps, m.tmx] : TPK.maps.filter(x => x !== m.tmx);
        store.set('tpk.maps.' + TPK.bmp, TPK.maps); TPK.sel = new Set(); tpkScan();
      } }), m.tmx + (m.bmp && m.bmp !== TPK.bmp ? '  [' + m.bmp + ']' : '')))));
  const maps = h('div', { class: 'tp-maps' });
  if (sc) {
    if (!sc.maps.length) maps.append(h('div', { class: 'tp-warn' }, 'Не выбрано ни одной карты - отметьте карты, по которым считать занятые тайлы.'));
    for (const tmx of sc.maps) {
      const off = TPK.off[tmx] || (TPK.off[tmx] = new Set());
      maps.append(h('div', { class: 'tp-map' }, h('b', null, tmx), ' ',
        ...(sc.layers[tmx] || []).map(l => h('label', { class: 'tp-chk', title: l.visible ? '' : 'скрытый слой в Tiled' },
          h('input', { type: 'checkbox', checked: !off.has(l.name), onchange: ev => { ev.target.checked ? off.delete(l.name) : off.add(l.name); TPK.sel = new Set(); tpkScan(); } }),
          l.name + ' (' + l.unique + ')'))));
    }
  }
  const lim = h('input', { type: 'number', value: TPK.limit, min: 1, max: 4096, style: 'width:70px', onchange: ev => { TPK.limit = +ev.target.value || 864; tpkScan(true); } });
  e.head.replaceChildren(
    h('div', { class: 'tp-row' }, tpkField('Тайлсет', sel), pick, tpkField('Лимит тайлов VRAM', lim, 'VRAM_TILES в stcore.py: столько сжатых тайлов грузится в видеопамять'),
      tpkBtn('↻ Анализировать заново', () => { TPK.sel = new Set(); tpkScan(); }, '', 'перечитать bmp и карты с диска')),
    maps,
    h('div', { class: 'tl-hint' }, 'Занятыми считаются тайлы всех отмеченных слоёв (скрытые слои стен и эскиза в Tiled тоже нужны глазу - снимите галочку, если они не нужны).'));
}

function tpkRender1() {
  const sc = TPK.scan, b = TPK.el.b1; if (!sc) return;
  const nSel = TPK.sel.size, cells = [...TPK.sel].reduce((a, r) => a + sc.groups[r].length, 0);
  const t = sc.tiles;
  const cvWrap = h('div', { class: 'tp-scroll' });
  const cv = TPK.el.setCanvas = h('canvas', { class: 'tp-canvas' });
  cvWrap.append(cv);
  let paint = null;
  const area = cell => {
    if (cell < 0 || cell >= sc.status.length) return;
    paint ? TPK.areas.add(cell) : TPK.areas.delete(cell);
  };
  cv.onmousedown = ev => {
    if (TPK.mode1 !== 'area' || TPK.pick) return;
    const { cell } = tpkCellAt(ev, cv, TPK.zoom, sc.tw);
    paint = !TPK.areas.has(cell); area(cell); tpkDrawSet(); ev.preventDefault();
  };
  window.addEventListener('mouseup', () => { if (paint !== null) { paint = null; tpkRender1Info(); tpkLater(); } });
  cv.onclick = ev => {
    if (TPK.mode1 === 'area' && !TPK.pick) return;
    const { cell } = tpkCellAt(ev, cv, TPK.zoom, sc.tw);
    if (TPK.pick) { tpkPickCell(cell); return; }
    const r = TPK.cellRoot[cell];
    if (r < 0) return;
    TPK.sel.has(r) ? TPK.sel.delete(r) : TPK.sel.add(r);
    tpkDrawSet(); tpkRender1Info(); tpkLater();
  };
  cv.onmousemove = ev => {
    const { cell } = tpkCellAt(ev, cv, TPK.zoom, sc.tw); cv.title = tpkCellTitle(cell);
    if (paint !== null && ev.buttons & 1) { area(cell); tpkDrawSet(); }
  };
  TPK.el.info1 = h('div', { class: 'tp-info' });
  const zoom = h('select', { onchange: ev => { TPK.zoom = +ev.target.value; store.set('tpk.zoom', TPK.zoom); tpkDrawSet(); } },
    ...[1, 2, 3, 4].map(z => h('option', { value: z, selected: z === TPK.zoom }, '×' + z)));
  b.replaceChildren(
    TPK.el.info1,
    h('div', { class: 'tp-legend' },
      h('span', { class: 'tp-sw', style: 'border-color:#ff4a3d' }), 'не используется - можно снести (клик выбирает тайл вместе с его копиями)  ',
      h('span', { class: 'tp-sw', style: 'background:rgba(255,150,0,.7)' }), 'выбран на удаление используемый тайл  ',
      h('span', { class: 'tp-sw', style: 'border-color:#b05cff;background:rgba(170,90,255,.4)' }), 'область подмены (пунктиром - её отражения по X, куда лягут отражённые копии)  ',
      h('span', { class: 'tp-sw', style: 'border-color:#27c7e8;border-width:2px' }), 'нужен подмене тайлов (fgtile) - трогать нельзя  ',
      h('span', { class: 'tp-sw', style: 'background:rgba(120,120,120,.6)' }), 'не используется, но это повтор/отражение нужного - память не освободит'),
    h('div', { class: 'tp-row' },
      tpkField('Клик по таблице', h('select', { onchange: ev => { TPK.mode1 = ev.target.value; } },
        h('option', { value: 'del', selected: TPK.mode1 === 'del' }, 'выбирает тайл на удаление (с копиями; можно и используемые)'),
        h('option', { value: 'area', selected: TPK.mode1 === 'area' }, 'размечает область подмены (зажмите и ведите)'))),
      tpkBtn('Выделить все неиспользуемые', () => { TPK.sel = new Set(sc.unused); tpkDrawSet(); tpkRender1Info(); tpkRefresh(); }, '', 'только те, что не нужны выбранным картам'),
      tpkBtn('Области = выбранные на удаление', () => { for (const r of TPK.sel) for (const c of sc.groups[r]) TPK.areas.add(c); tpkDrawSet(); tpkRender1Info(); tpkRefresh(); }, '', 'ячейки выбранных тайлов станут областью подмены: в них можно класть новые тайлы'),
      tpkBtn('Очистить области', () => { TPK.areas = new Set(); tpkDrawSet(); tpkRender1Info(); tpkRefresh(); }),
      tpkBtn('Снять выделение', () => { TPK.sel = new Set(); tpkDrawSet(); tpkRender1Info(); tpkRefresh(); }),
      h('label', { class: 'tp-chk' }, h('input', { type: 'checkbox', checked: TPK.showD, onchange: ev => { TPK.showD = ev.target.checked; tpkDrawSet(); } }), 'показать серые'),
      tpkField('Масштаб', zoom),
      TPK.el.applyDel = tpkBtn('Применить удаление (бэкап + сдвиг fgtile)', tpkApplyDelete, 'primary')),
    cvWrap);
  tpkRender1Info();
  tpkDrawSet();
}

function tpkCellTitle(cell) {
  const sc = TPK.scan, s = sc.status[cell];
  const what = (TPK.areas.has(cell) ? '[область подмены] ' : '') + { u: 'используется картой', p: 'нужен подмене тайлов', d: 'повтор/отражение используемого тайла', f: 'не используется' }[s];
  return '#' + cell + ' (x' + (cell % sc.tw) + ', y' + Math.floor(cell / sc.tw) + ') - ' + what;
}

function tpkRender1Info() {
  const sc = TPK.scan;
  const cells = [...TPK.sel].reduce((a, r) => a + sc.groups[r].length, 0);
  const pairs = sc.pairsInfo.length ? ' Подмена тайлов затронет пары: ' + sc.pairsInfo.map(x => x.idx).join(', ') + '.' : '';
  TPK.el.info1.textContent = 'Ячеек в bmp: ' + sc.tiles.raw + ' · уникальных тайлов после сжатия (как соберёт tmx2incl): ' + sc.tiles.opt +
    ' · нужно картам: ' + sc.tiles.displayed + ' · только для подмены: ' + sc.tiles.protectedOnly + ' · не нужно никому: ' + sc.tiles.unusedClasses +
    ' · можно снести (вместе с используемыми): ' + sc.tiles.freeable + ' тайлов. Выбрано: ' + TPK.sel.size + ' тайлов (' + cells + ' ячеек). Областей подмены: ' + TPK.areas.size + ' ячеек.' + pairs +
    ' Пары подмены пересчитываются по содержимому; новые пары создавайте вручную.';
  if (TPK.el.applyDel) TPK.el.applyDel.disabled = !TPK.sel.size;
}

function tpkRender2() {
  const sc = TPK.scan, b = TPK.el.b2; if (!sc) return;
  const t = (TPK.plan || sc).tiles, lim = TPK.limit;
  const free = t.free;
  b.replaceChildren(
    h('div', { class: 'tp-big' + (free < 0 ? ' bad' : '') }, tpkNum(free), h('small', null, ' тайлов свободно по выбранным картам')),
    h('div', { class: 'tp-info' },
      'По карте: лимит ' + lim + ' − тайлов, которые нужны картам и подмене (после удаления и областей) ' + t.keepAfter + ' = ' + free + '. ' +
      'Сейчас нужно: ' + t.keepBefore + ' (освободится ' + (t.keepBefore - t.keepAfter) + ').'),
    h('div', { class: 'tp-info' },
      'Физически в bmp ' + t.optAfterDelete + ' сжатых тайлов (tmx2incl не выкидывает неиспользуемые), из них не нужны никому: ' + t.leftover +
      (t.beyond ? '. Это на ' + t.beyond + ' больше лимита - лишнее уедет за VRAM, поэтому тайлы, нужные карте, должны идти раньше: удалите оставшиеся неиспользуемые (шаг 1) или разметьте области подмены.' : '. Всё помещается в VRAM.')),
    tpkBtn('Пересчитать', () => tpkRefresh()));
}

// ---- шаг 3: картинка

function tpkRender3() {
  const b = TPK.el.b3; if (!TPK.scan) return;
  const file = h('input', { type: 'file', accept: '.png,.bmp,image/png,image/bmp', onchange: tpkLoadFile });
  const pl = TPK.plan && TPK.plan.pic;
  const kids = [h('div', { class: 'tp-row' }, tpkField('Картинка (PNG или 24-бит BMP, тайлы 8×8, прозрачность - маджента #FF00FF)', file))];
  if (TPK.pic) {
    kids.push(h('div', { class: 'tp-info' }, TPK.pic.name + ': ' + TPK.pic.w + '×' + TPK.pic.h + ' тайлов' + (TPK.pic.padded ? ' (размер был не кратен 8 - добит маджентой)' : '') + '.'));
  }
  if (pl) {
    kids.push(h('div', { class: 'tp-stats' },
      tpkStat('Всего ячеек', pl.cells), tpkStat('Прозрачных', pl.blankCells),
      tpkStat('Уникальных (с отражениями)', pl.classes, 'без отражений: ' + pl.uniqueExact),
      tpkStat('Уже есть в тайлсете', pl.reused), tpkStat('Новых', pl.new),
      tpkStat('Неучтённых', pl.skipped, 'не попадут в тайлсет, клетка на карте останется пустой'),
      tpkStat('Нужно места', pl.needTiles, 'после текущих замен, неучтённых и повторов'), tpkStat('Свободно', TPK.plan.tiles.free),
      tpkStat('Цветов', pl.colors, '+' + pl.newColors + ' новых; в тайлсете максимум 256')));
    kids.push(h('div', { class: pl.fits ? 'tp-ok' : 'tp-warn' }, pl.fits ? 'Помещается.' : 'Не помещается: перебор ' + pl.overflow + ' тайлов - нужно сжатие (шаг 4) или больше удалений (шаг 1).'));
  }
  b.replaceChildren(...kids);
}

function tpkStat(label, v, hint) { return h('div', { class: 'tp-stat', title: hint || '' }, h('b', null, tpkNum(v)), h('span', null, label)); }

async function tpkLoadFile(ev) {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const r = await api('/api/tilepack/image', { name: f.name, data: btoa(bin) });
    TPK.pic = { id: r.id, w: r.w, h: r.h, name: f.name, padded: r.padded };
    TPK.picImg = await tpkLoadImg(r.png);
    TPK.repl = {}; TPK.replOk = '{}'; TPK.skip = new Set(); TPK.locked = new Set(); TPK.sugg = null; TPK.plan = null; TPK.log = [];
    tpkRenderAll();
    tpkRefresh();
  } catch (err) { toast(err.message, 'err'); }
}

// ---- шаг 4: сжатие

function tpkSetRepl(pid, to, o, d) { TPK.repl[pid] = { to, o, d }; tpkRefresh(); }
function tpkClearRepl(pid) { delete TPK.repl[pid]; tpkRefresh(); }

function tpkPickCell(cell) {
  const pid = TPK.pick, sc = TPK.scan;
  TPK.pick = null; TPK.el.c4.classList.remove('tp-picking');
  const root = sc.cls[cell];
  if (TPK.sel.has(root)) { toast('этот тайл вы собираетесь удалить', 'err'); return; }
  // замена = содержимое этой ячейки как есть: цель - корень её класса, ориентация - как у ячейки (цену посчитает сервер)
  TPK.repl[pid] = { to: 'e' + root, o: sc.orient[cell] };
  tpkRefresh();
}

function tpkRender4() {
  const b = TPK.el.b4;
  if (!TPK.pic || !TPK.plan || !TPK.plan.pic) { b.replaceChildren(h('div', { class: 'tl-hint' }, 'Сначала загрузите картинку (шаг 3).')); return; }
  const pl = TPK.plan, free = pl.tiles.free;
  const ctl = h('div', { class: 'tp-row' },
    h('label', { class: 'tp-chk' }, h('input', { type: 'checkbox', checked: TPK.auto.existing, onchange: ev => { TPK.auto.existing = ev.target.checked; TPK.sugg = null; } }), 'заменять тайлами тайлсета'),
    h('label', { class: 'tp-chk' }, h('input', { type: 'checkbox', checked: TPK.auto.new, onchange: ev => { TPK.auto.new = ev.target.checked; TPK.sugg = null; } }), 'и другими новыми тайлами картинки'),
    tpkBtn('Подобрать замены автоматически (до ' + free + ' тайлов)', () => tpkRefresh({ auto: true, suggest: true }), 'primary', 'жадно: сначала самые незаметные замены, считается ошибка × сколько раз тайл встречается'),
    tpkBtn('Показать варианты', () => tpkRefresh({ suggest: true })),
    tpkBtn('Сбросить все замены', () => { TPK.repl = {}; tpkRefresh(); }));
  const prev = h('div', { class: 'tp-prev' },
    h('div', null, h('div', { class: 'tp-cap' }, 'Исходная'), h('canvas', { class: 'tp-canvas', width: TPK.picImg.width * 2, height: TPK.picImg.height * 2 })),
    h('div', null, h('div', { class: 'tp-cap' }, 'После сжатия (' + pl.pic.changedCells + ' ячеек изменено из ' + pl.pic.cells + ', ошибка ' + pl.pic.errTotal + ')'),
      h('canvas', { class: 'tp-canvas', width: (TPK.finalImg ? TPK.finalImg.width : 1) * 2, height: (TPK.finalImg ? TPK.finalImg.height : 1) * 2 })));
  const [co, cf] = prev.querySelectorAll('canvas');
  co.title = 'клик по тайлу: пометить/снять «неучтённый» (в тайлсет не пойдёт)';
  co.onclick = ev => {
    const { cell } = tpkCellAt(ev, co, 2, TPK.pic.w);
    const id = 'p' + pl.pic.cellCls[cell];
    if (!pl.picCls.some(c => c.id === id && !c.blank)) return;
    TPK.skip.has(id) ? TPK.skip.delete(id) : TPK.skip.add(id);
    tpkRefresh();
  };
  for (const [cv, im] of [[co, TPK.picImg], [cf, TPK.finalImg]]) {
    if (!im) continue; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, cv.width, cv.height);
  }
  if (TPK.skip.size) {
    const g = co.getContext('2d'); g.fillStyle = 'rgba(230,60,50,.5)';
    pl.pic.cellCls.forEach((r, i) => { if (TPK.skip.has('p' + r)) g.fillRect((i % TPK.pic.w) * 16, Math.floor(i / TPK.pic.w) * 16, 16, 16); });
  }
  // таблица новых классов
  let list = pl.classes.slice();
  const isRep = c => !!TPK.repl[c.id];
  if (TPK.filter === 'open') list = list.filter(c => !isRep(c) && !c.skip); else if (TPK.filter === 'done') list = list.filter(isRep);
  else if (TPK.filter === 'skip') list = list.filter(c => c.skip);
  const cost = c => { const s = TPK.sugg && TPK.sugg[c.id] && TPK.sugg[c.id][0]; return s ? s.d * c.count : 1e12; };
  if (TPK.sugg) list.sort((a, b) => cost(a) - cost(b)); else list.sort((a, b) => a.count - b.count);
  const filter = h('select', { onchange: ev => { TPK.filter = ev.target.value; tpkRender4(); } },
    ...[['all', 'все новые тайлы'], ['open', 'ещё не заменённые'], ['done', 'заменённые'], ['skip', 'неучтённые']].map(([v, t]) => h('option', { value: v, selected: v === TPK.filter }, t)));
  const rows = h('div', { class: 'tp-rows' });
  for (const c of list.slice(0, TPK.rows)) rows.append(tpkClassRow(c));
  const more = list.length > TPK.rows ? tpkBtn('Показать ещё (' + (list.length - TPK.rows) + ')', () => { TPK.rows += 60; tpkRender4(); }) : null;
  b.replaceChildren(ctl, prev,
    h('div', { class: 'tp-row' }, h('b', null, 'Новые тайлы: ' + pl.classes.filter(c => !c.skip).length + ', заменено: ' + Object.keys(TPK.repl).length + ', нужно места ' + pl.pic.needTiles + ' из ' + free), filter,
      h('span', { class: 'tl-hint' }, TPK.sugg ? 'по возрастанию цены замены' : 'пока варианты не подобраны - нажмите «Показать варианты»')),
    rows, more);
}

function tpkClassRow(c) {
  const r = TPK.repl[c.id], z = 4;
  const row = h('div', { class: 'tp-crow' + (r ? ' done' : '') + (c.skip ? ' skip' : '') }, h('div', { class: 'tp-cell' }, tpkTile(TPK.picImg, c.cell, TPK.pic.w, 0, z), h('small', null, '×' + c.count)));
  const skipBox = h('label', { class: 'tp-chk', title: 'неучтённый: не включать в тайлсет и не сжимать, клетки на карте останутся пустыми' },
    h('input', { type: 'checkbox', checked: !!c.skip, onchange: ev => { ev.target.checked ? TPK.skip.add(c.id) : TPK.skip.delete(c.id); tpkRefresh(); } }), 'неучтённый');
  if (c.skip) { row.append(skipBox); return row; }
  if (r) {
    row.append(h('span', { class: 'tp-arrow' }, '→'), h('div', { class: 'tp-cell' }, tpkTargetTile(r.to, r.o, z), h('small', null, r.to[0] === 'e' ? 'из тайлсета' : 'другой новый')),
      h('span', { class: 'tl-hint' }, 'ошибка ' + tpkNum(r.d)), tpkBtn('✕ вернуть', () => tpkClearRepl(c.id)), skipBox);
  } else {
    const s = (TPK.sugg && TPK.sugg[c.id]) || [];
    for (const k of s) {
      const cell = h('button', { class: 'tp-cand', title: 'ошибка ' + k.d + (k.id[0] === 'e' ? ', из тайлсета' : ', другой новый тайл'), onclick: () => tpkSetRepl(c.id, k.id, k.o, k.d) },
        tpkTargetTile(k.id, k.o, 3), h('small', null, k.d));
      row.append(cell);
    }
    row.append(tpkBtn('🎯 из тайлсета…', () => { TPK.pick = c.id; TPK.el.c4.classList.add('tp-picking'); toast('кликните тайл в таблице шага 1'); TPK.el.c1.scrollIntoView({ behavior: 'smooth' }); }),
      h('label', { class: 'tp-chk', title: 'не заменять этот тайл при автоподборе' }, h('input', { type: 'checkbox', checked: TPK.locked.has(c.id), onchange: ev => { ev.target.checked ? TPK.locked.add(c.id) : TPK.locked.delete(c.id); } }), '🔒'), skipBox);
  }
  return row;
}

// ---- шаг 5: размещение

function tpkRender5() {
  const b = TPK.el.b5;
  if (!TPK.pic || !TPK.plan || !TPK.plan.layout) { b.replaceChildren(h('div', { class: 'tl-hint' }, 'Сначала загрузите картинку (шаг 3).')); return; }
  const pl = TPK.plan, L = pl.layout, R = pl.result;
  const upd = () => tpkLater();
  const lay = h('select', { onchange: ev => { TPK.layout.mode = ev.target.value; upd(); } },
    h('option', { value: 'packed', selected: TPK.layout.mode === 'packed' }, 'плотно: куски картинки целиком, пустоты добиваются короткими'),
    h('option', { value: 'scan', selected: TPK.layout.mode === 'scan' }, 'лентой в порядке картинки'));
  const pm = h('select', { onchange: ev => { TPK.place.mode = ev.target.value; tpkRender5(); upd(); } },
    h('option', { value: 'holes', selected: TPK.place.mode === 'holes' }, 'сначала в области подмены, затем в пустые ячейки, остаток - ниже всех тайлов'),
    h('option', { value: 'append', selected: TPK.place.mode === 'append' }, 'ниже всех тайлов (bmp продлевается вниз)'),
    h('option', { value: 'cell', selected: TPK.place.mode === 'cell' }, 'с выбранной ячейки (клик по картинке ниже)'));
  const wid = h('input', { type: 'number', min: 1, max: 32, value: TPK.layout.width, style: 'width:60px', onchange: ev => { TPK.layout.width = +ev.target.value || 32; upd(); } });
  const col = h('input', { type: 'number', min: 0, max: 31, value: TPK.place.col, style: 'width:60px', onchange: ev => { TPK.place.col = +ev.target.value || 0; upd(); } });
  const cvWrap = h('div', { class: 'tp-scroll' });
  const cv = TPK.el.afterCanvas = h('canvas', { class: 'tp-canvas' });
  cvWrap.append(cv);
  cv.onclick = ev => {
    if (TPK.place.mode !== 'cell') return;
    const { x, y } = tpkCellAt(ev, cv, 2, TPK.scan.tw);
    TPK.place.row = y; TPK.place.col = x; tpkRender5(); upd();
  };
  const errs = pl.errors.map(e => h('div', { class: 'tp-err' }, '⚠ ' + e));
  const warns = (pl.warnings || []).map(e => h('div', { class: 'tp-warn' }, e));
  const res = R ? h('div', { class: R.ok ? 'tp-ok' : 'tp-warn' },
    'После записи: сжатых тайлов ' + R.opt + ' · старший показываемый тайл №' + R.maxShown + ' (лимит ' + TPK.limit + ') ' + (R.ok ? '✓' : '✗') +
    ' · цветов ' + R.colors + '/256 · высота bmp ' + R.th + ' тайлов (+' + R.newRaw + ' ячеек) · пересчёт подмены: ' + (R.pairEdits || 0) + ' пар') : null;
  const T = TPK.target, copy = T.mode === 'copy';
  const tg = h('div', { class: 'tp-row' },
    tpkField('Куда сохранить', h('select', { onchange: ev => { T.mode = ev.target.value; tpkRender5(); tpkLater(); } },
      h('option', { value: 'copy', selected: copy }, 'отдельная копия тайлсета (основной не трогаем)'),
      h('option', { value: 'main', selected: !copy }, 'в основной ' + TPK.bmp + ' (с бэкапом)'))),
    copy ? tpkField('Имя копии', h('input', { type: 'text', value: T.name, style: 'width:160px', oninput: ev => { T.name = ev.target.value; } }), '.bmp и .tsx с этим именем') : null,
    copy ? tpkField('Папка', h('input', { type: 'text', value: T.dir, style: 'width:240px', oninput: ev => { T.dir = ev.target.value; } }), 'относительно проекта') : null);
  TPK.el.applyBtn = tpkBtn(copy ? 'Сохранить копию тайлсета' : 'Записать bmp (со старым сделаем бэкап)', tpkApply, 'primary');
  TPK.el.applyBtn.disabled = !R || pl.errors.length > 0;
  b.replaceChildren(
    tg,
    h('div', { class: 'tp-row' }, tpkField('Раскладка', lay), tpkField('Ширина ленты, тайлов', wid), tpkField('Куда', pm), tpkField('Стартовый столбец', col),
      TPK.place.mode === 'cell' ? h('span', { class: 'tl-hint' }, 'ячейка: строка ' + TPK.place.row + ', столбец ' + TPK.place.col) : null),
    h('div', { class: 'tp-info' }, 'Новых ячеек: ' + pl.pic.newCells + ' (зеркальные копии нужны как ячейки - tmx не умеет флипы - но тайлов VRAM не занимают). Зелёным - куда лягут, красным - занятые ячейки.'),
    cvWrap, res, ...errs, ...warns, h('div', { class: 'tp-row' }, TPK.el.applyBtn),
    TPK.log.length ? h('div', { class: 'tp-log' }, ...TPK.log.map(m => h('div', null, m))) : null);
  tpkDrawAfter();
}

// ---- шаг 6: tmx

function tpkRender6() {
  const b = TPK.el.b6; if (!TPK.scan) return;
  const X = TPK.export;
  const inp = (k, w) => h('input', { type: 'text', value: X[k], style: 'width:' + w + 'px', oninput: ev => { X[k] = ev.target.value; } });
  b.replaceChildren(
    h('div', { class: 'tp-row' }, tpkField('Имя файла', inp('name', 140)), tpkField('Слой', inp('layer', 140)), tpkField('Папка', inp('outDir', 260), 'относительно проекта'),
      tpkField('Тайлсет .tsx', inp('tsx', 160), 'пусто - .tsx последней записи'),
      tpkBtn('Сохранить tmx', tpkExport, 'primary')),
    h('div', { class: 'tl-hint' }, 'tmx берёт итоговую картинку с шага 5 и ссылается на последний сохранённый bmp (копию или основной) и его .tsx; по умолчанию кладётся рядом с копией. Его можно открыть в Tiled и скопировать слой на старую карту.'));
}

// ------------------------------------------------------------------ действия

async function tpkApplyDelete() {
  const sc = TPK.scan, t = (TPK.plan || sc).tiles;
  const msg = 'Закрасить ' + TPK.sel.size + ' неиспользуемых тайлов (' + [...TPK.sel].reduce((a, r) => a + sc.groups[r].length, 0) + ' ячеек) маджентой в ' + TPK.bmp +
    ' (в том числе используемых картой) и пересчитать supertiles.cpp?\nСтарые bmp и supertiles.cpp уйдут в backups/tilepack/.';
  if (!confirm(msg)) return;
  try {
    const r = await api('/api/tilepack/apply', Object.assign(tpkPayload(false), { areas: [], target: { mode: 'main' } }));
    TPK.log = r.messages; toast('Готово: ' + r.messages[0]);
    TPK.sel = new Set(); await tpkScan();
  } catch (err) { toast(err.message, 'err'); }
}

async function tpkApply() {
  const pl = TPK.plan, R = pl.result;
  const copy = TPK.target.mode === 'copy';
  const msg = copy ? 'Сохранить копию тайлсета «' + TPK.target.name + '» в ' + TPK.target.dir + '? Основной ' + TPK.bmp + ' и supertiles.cpp не изменятся.' : 'Записать ' + TPK.bmp + ': ' + (TPK.sel.size ? 'удалить ' + TPK.sel.size + ' тайлов и ' : '') + 'добавить ' + pl.pic.newCells + ' ячеек (' + pl.pic.needTiles + ' новых тайлов VRAM), ' +
    'сжатых тайлов станет ' + R.opt + '. supertiles.cpp пересчитается. Старые файлы уйдут в backups/tilepack/. Продолжить?';
  if (!confirm(msg)) return;
  try {
    const r = await api('/api/tilepack/apply', tpkPayload(true));
    TPK.log = r.messages; toast(copy ? 'копия сохранена' : 'bmp записан');
    if (copy) {
      TPK.export.outDir = r.target.dir;
      tpkRender5(); tpkRender6();
    } else {
      TPK.sel = new Set(); TPK.areas = new Set(); TPK.repl = {}; TPK.sugg = null;
      await tpkScan();
      TPK.log = r.messages; tpkRender5();
    }
  } catch (err) { toast(err.message, 'err'); }
}

async function tpkExport() {
  try {
    const r = await api('/api/tilepack/export', Object.assign({ bmp: TPK.bmp }, TPK.export, { tsx: TPK.export.tsx || undefined }));
    toast('tmx сохранён');
    TPK.el.b6.append(h('div', { class: 'tp-log' }, ...r.messages.map(m => h('div', null, m))));
  } catch (err) { toast(err.message, 'err'); }
}
