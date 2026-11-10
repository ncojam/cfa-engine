// ============================================================ Вкладка «Свет»: свет в помещениях и транспорте (project/src/light_profiles.cpp)
// Профиль = опорные точки по времени суток (цвет света, сила, доля солнца, доля неба) + реакция на облачность.
// Уровни привязываются к профилю (или «без окон» — родная палитра). Улица сюда не входит.
// Превью перекрашивает настоящую карту той же целочисленной формулой, что и игра
// (time_weather_manager.cpp: indoorLight / indoorColor / skyColorNow) — держать одинаковыми.

const LI = dataTab({
  id: 'light', root: '#light', what: 'правки света', saved: 'light_profiles.cpp сохранён',
  render: () => liRender(),
  ingest: () => { if (LI.sub !== 'levels' && !LI.m.profiles.some(p => p.id === LI.sub)) LI.sub = (LI.m.profiles[0] || {}).id || 'levels'; },
  prepare: m => {
    m.profiles.forEach(p => p.keys.sort((a, b) => a.min - b.min));
    return m;
  },
  touched: () => liPaint(),
}, { sub: store.get('li.sub', 'room'), min: store.get('li.min', 1200), cloud: 0, map: {}, img: null, imgKey: '', loading: '' });

const LI_FIELDS = [['amt', 'сила', 'Насколько подтянуть цвета к цвету света, %'], ['sun', 'солнце', 'Доля солнечного света (0 — лампы, 100 — солнце из окна): только его гасят тучи, %'],
  ['sky', 'небо', 'Подмес текущего цвета неба (окна транспорта), %']];
const liDiv = (a, b) => Math.trunc(a / b);                 // как «/» в C
const liLerp = (a, b, t) => a + liDiv((b - a) * t, 100);
const liHHMM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const liParseHHMM = s => { const k = /^(\d{1,2}):?(\d{2})$/.exec(s.trim()); return k ? Math.min(1440, +k[1] * 60 + +k[2]) : null; };
const li5to8 = v => Math.round(v * 255 / 31);
const liHex = (r, g, b) => '#' + [r, g, b].map(v => li5to8(v).toString(16).padStart(2, '0')).join('');
const liProfile = () => LI.m.profiles.find(p => p.id === LI.sub);

// ---- формула игры
function liSky(min, cloud) {
  const sky = LI.st.sky || {};
  if (!sky.clear || !sky.cloudy) return [0, 0, 0];
  const hour = Math.floor(min / 60) % 24, t = liDiv((min % 60) * 100, 60);
  const ch = (tab, k) => { const c = tab[k][2]; return [c & 31, (c >> 5) & 31, (c >> 10) & 31]; };
  const a0 = ch(sky.clear, hour), a1 = ch(sky.clear, hour + 1), b0 = ch(sky.cloudy, hour), b1 = ch(sky.cloudy, hour + 1);
  return [0, 1, 2].map(i => liLerp(liLerp(a0[i], a1[i], t), liLerp(b0[i], b1[i], t), cloud));
}

function liLight(P, min, cloud) {
  const L = { r: 0, g: 0, b: 0, amt: 0, desat: 0, sr: 0, sg: 0, sb: 0, sky: 0 };
  const K = P.keys;
  if (K.length < 2) return L;
  const m = min % 1440;
  let k = 0;
  while (k + 2 < K.length && K[k + 1].min <= m) k++;
  const A = K[k], B = K[k + 1], span = B.min - A.min;
  const t = Math.min(100, span > 0 ? liDiv((m - A.min) * 100, span) : 0);
  L.r = liLerp(A.r, B.r, t); L.g = liLerp(A.g, B.g, t); L.b = liLerp(A.b, B.b, t);
  L.amt = liLerp(A.amt, B.amt, t); L.sky = liLerp(A.sky, B.sky, t);
  const sun = liLerp(A.sun, B.sun, t);
  const cloudSun = liDiv(cloud * sun, 100);
  L.amt -= liDiv(L.amt * cloudSun * P.cloudSunCut, 10000);
  L.desat = liDiv(cloudSun * P.cloudDesat, 100);
  if (L.amt < 0) L.amt = 0;
  if (L.sky) [L.sr, L.sg, L.sb] = liSky(m, cloud);
  return L;
}

function liColor(r, g, b, L) {   // 5-битные компоненты
  if (L.desat) {
    const l = (r * 5 + g * 9 + b * 2) >> 4;
    r += liDiv((l - r) * L.desat, 100); g += liDiv((l - g) * L.desat, 100); b += liDiv((l - b) * L.desat, 100);
  }
  r += liDiv((L.r - r) * L.amt, 100); g += liDiv((L.g - g) * L.amt, 100); b += liDiv((L.b - b) * L.amt, 100);
  if (L.sky) { r += liDiv((L.sr - r) * L.sky, 100); g += liDiv((L.sg - g) * L.sky, 100); b += liDiv((L.sb - b) * L.sky, 100); }
  const c = v => Math.max(0, Math.min(31, v));
  return [c(r), c(g), c(b)];
}

// ---- карта для превью: индексы палитры один раз, перекраска — подменой палитры
function liMapFor(P) {
  const lv = LI.m.levels.find(l => l.profile === P.id && LI.st.levelMaps[l.level]);
  const def = lv ? 'map-' + LI.st.levelMaps[lv.level] + '.tmx' : (P.id === 'vehicle' ? 'menu-bus.tmx' : 'map-home.tmx');
  return LI.map[P.id] || store.get('li.map.' + P.id, def);
}

async function liLoadImg(tmx) {
  const info = LI.st.maps.find(m => m.tmx === tmx);
  if (!info || !info.tileset) { LI.img = null; LI.imgKey = tmx; return; }
  if (LI.imgKey === tmx && LI.img) return;
  LI.loading = tmx;
  try {
    const ts = LI.st.tilesets.find(t => t.bmp === info.tileset) || {};
    const [j, map] = await Promise.all([
      api(`/api/tiles/tileset?bmp=${encodeURIComponent(info.tileset)}&unless=${ts.unless ? 1 : 0}`),
      api(`/api/tiles/map?tmx=${encodeURIComponent(tmx)}`)]);
    const raw = Uint8Array.from(atob(j.tiles), c => c.charCodeAt(0));
    const layers = map.layers.filter(l => !l.walls);
    const W = Math.max(...layers.map(l => l.w)) * 8, H = Math.max(...layers.map(l => l.h)) * 8;
    const idx = new Uint8Array(W * H);
    layers.forEach((Ly, li) => {
      for (let y = 0; y < Ly.h; y++) for (let x = 0; x < Ly.w; x++) {
        const r = Ly.data[y * Ly.w + x];
        if (li > 0 && r === 0) continue;
        const e = j.opt[r];
        if (e === undefined) continue;
        const oi = e & 1023, orient = e >> 10;
        if (oi >= j.optCount) continue;
        for (let yy = 0; yy < 8; yy++) {
          const sy = (orient & 2) ? 7 - yy : yy;
          for (let xx = 0; xx < 8; xx++) {
            const sx = (orient & 1) ? 7 - xx : xx;
            const c = raw[oi * 64 + sy * 8 + sx];
            if (li > 0 && c === 0) continue;
            idx[(y * 8 + yy) * W + x * 8 + xx] = c;
          }
        }
      }
    });
    LI.img = { W, H, idx, pal: j.pal.map(([r, g, b]) => [r >> 3, g >> 3, b >> 3]) };
    LI.ox = (W - 480) / 2; LI.oy = (H - 320) / 2;   // начинаем с середины карты
    LI.imgKey = tmx;
  } catch (e) {
    LI.img = null; LI.imgKey = tmx; toast('Превью: ' + e.message, 'err');
  } finally { LI.loading = ''; }
}

function liPaint() {
  const P = LI.m && liProfile();
  const cv = $('#liCv');
  if (!P || !cv) return;
  const L = liLight(P, LI.min, LI.cloud);
  const sw = $('#liNow');
  if (sw) {
    sw.innerHTML = '';
    sw.append(
      h('span', { class: 'li-sw', style: `background:${liHex(L.r, L.g, L.b)}`, title: 'цвет света' }), ` свет ${L.amt}%`,
      L.desat ? ` · −насыщ. ${L.desat}%` : '',
      L.sky ? h('span', null, ' · ', h('span', { class: 'li-sw', style: `background:${liHex(L.sr, L.sg, L.sb)}`, title: 'цвет неба' }), ` небо ${L.sky}%`) : '');
  }
  const I = LI.img;
  if (!I) { cv.width = 1; cv.height = 1; return; }
  const pal = new Uint32Array(256);
  I.pal.forEach(([r, g, b], k) => { const [R, G, B] = liColor(r, g, b, L); pal[k] = 0xFF000000 | (li5to8(B) << 16) | (li5to8(G) << 8) | li5to8(R); });
  const vw = Math.min(I.W, 480), vh = Math.min(I.H, 320);
  const ox = Math.max(0, Math.min(I.W - vw, LI.ox | 0)), oy = Math.max(0, Math.min(I.H - vh, LI.oy | 0));
  cv.width = vw; cv.height = vh; cv.style.width = (vw * 2) + 'px'; cv.style.height = (vh * 2) + 'px';
  const g = cv.getContext('2d'), img = g.createImageData(vw, vh), px = new Uint32Array(img.data.buffer);
  for (let y = 0; y < vh; y++) { const row = (y + oy) * I.W + ox; for (let x = 0; x < vw; x++) px[y * vw + x] = pal[I.idx[row + x]]; }
  g.putImageData(img, 0, 0);
}

// полоса суток: цвет «средне-серого» в каждую минуту
function liStrip(P) {
  const cv = h('canvas', { class: 'li-strip', width: 288, height: 14, title: 'Сутки: как перекрашивается средне-серый. Клик — выбрать время.' });
  const g = cv.getContext('2d');
  for (let x = 0; x < 288; x++) {
    const [r, gg, b] = liColor(16, 16, 16, liLight(P, x * 5, LI.cloud));
    g.fillStyle = liHex(r, gg, b); g.fillRect(x, 0, 1, 14);
  }
  g.fillStyle = '#fff'; g.fillRect(Math.floor(LI.min / 5), 0, 1, 14);
  cv.onclick = e => { const r = cv.getBoundingClientRect(); liSetMin(Math.round((e.clientX - r.left) / r.width * 288) * 5); };
  return cv;
}

function liSetMin(m) { LI.min = Math.max(0, Math.min(1439, m)); store.set('li.min', LI.min); LI.render(); }

function liNum(obj, key, lo, hi, after) {
  return h('input', { class: 'gr-in num', type: 'number', min: lo, max: hi, value: obj[key],
    oninput: e => { const v = parseInt(e.target.value, 10); e.target.classList.toggle('bad', !(v >= lo && v <= hi)); if (v >= lo && v <= hi) { obj[key] = v; (after || LI.touch)(); } } });
}

function liRenderProfile(P) {
  const lim = LI.st.limits;
  const keyRow = (k, i) => h('tr', { class: Math.abs(k.min - LI.min) < 1 ? 'on' : '' },
    h('td', null, h('input', { class: 'gr-in li-time', value: liHHMM(k.min), disabled: i === 0 || i === P.keys.length - 1,
      title: i === 0 || i === P.keys.length - 1 ? 'Первая точка — 00:00, последняя — 24:00' : 'ЧЧ:ММ',
      onchange: e => { const v = liParseHHMM(e.target.value); if (v == null) { e.target.classList.add('bad'); return; } k.min = v; P.keys.sort((a, b) => a.min - b.min); LI.render(); } })),
    h('td', null, h('button', { class: 'chip', title: 'Показать это время в превью', onclick: () => liSetMin(Math.min(1439, k.min)) }, '👁')),
    h('td', null, h('input', { type: 'color', class: 'li-color', 'data-i': i, value: liHex(k.r, k.g, k.b), title: 'Цвет света (округляется до 5 бит GBA)',
      oninput: e => { const v = e.target.value; [k.r, k.g, k.b] = [1, 3, 5].map(o => Math.round(parseInt(v.substr(o, 2), 16) * 31 / 255)); LI.touch(); $$(`.li-rgb[data-i="${i}"]`).forEach((el, n) => { el.value = [k.r, k.g, k.b][n]; }); } })),
    ['r', 'g', 'b'].map(c => { const el = liNum(k, c, 0, 31, () => { LI.touch(); $$(`.li-color[data-i="${i}"]`).forEach(x => { x.value = liHex(k.r, k.g, k.b); }); }); el.classList.add('li-rgb'); el.dataset.i = i; return h('td', null, el); }),
    LI_FIELDS.map(([f]) => h('td', null, liNum(k, f, lim[f][0], lim[f][1]))),
    h('td', null, h('input', { class: 'gr-in li-note', value: k.note || '', oninput: e => { k.note = e.target.value; LI.touch(); } })),
    h('td', null, i > 0 && i < P.keys.length - 1 ? h('button', { class: 'chip', title: 'Удалить точку', onclick: () => { P.keys.splice(i, 1); LI.render(); } }, '✕') : null));
  const addKey = () => {
    const L = liLight(P, LI.min, 0);
    const k = { min: LI.min, r: L.r, g: L.g, b: L.b, amt: L.amt, sun: 100, sky: L.sky, note: '' };
    if (P.keys.some(x => x.min === k.min)) { toast('В это время уже есть точка', 'err'); return; }
    if (P.keys.length >= LI.st.maxKeys) { toast(`Не больше ${LI.st.maxKeys} точек`, 'err'); return; }
    P.keys.push(k); P.keys.sort((a, b) => a.min - b.min); LI.render();
  };
  const tmx = liMapFor(P);
  const used = LI.m.levels.filter(l => l.profile === P.id).map(l => l.level + (l.note ? ` ${l.note}` : ''));
  return h('div', { class: 'li' },
    h('div', { class: 'li-head' },
      h('label', null, 'Название ', h('input', { class: 'gr-in', style: 'width:260px', value: P.title, oninput: e => { P.title = e.target.value; LI.touch(); } })),
      h('label', { title: 'Сколько процентов солнечного света (sun) съедает полная облачность' }, 'тучи гасят солнце, % ', liNum(P, 'cloudSunCut', 0, 100)),
      h('label', { title: 'Насколько полная облачность снимает насыщенность (на солнечной доле); тумана нет' }, 'тучи снимают насыщенность, % ', liNum(P, 'cloudDesat', 0, 100)),
      h('span', { class: 'tl-hint' }, used.length ? 'уровни: ' + used.join(', ') : 'ни один уровень не использует (вкладка «Уровни»)')),
    h('div', { class: 'li-cols' },
      h('div', null,
        h('table', { class: 'gr-phr li-keys' },
          h('tr', null, h('th', null, 'время'), h('th'), h('th', null, 'цвет'), h('th', null, 'R'), h('th', null, 'G'), h('th', null, 'B'),
            LI_FIELDS.map(([, t, tip]) => h('th', { title: tip }, t + ' %')), h('th', null, 'заметка'), h('th')),
          P.keys.map(keyRow)),
        h('div', { style: 'margin-top:6px;display:flex;gap:6px;align-items:center' },
          h('button', { class: 'btn', onclick: addKey }, `+ точка в ${liHHMM(LI.min)}`),
          h('span', { class: 'tl-hint' }, 'Между точками — линейно по минутам. Ячейка: −насыщенность → к цвету света (сила) → к цвету неба (небо).'))),
      h('div', { class: 'li-prev' },
        h('div', { class: 'li-ctl' },
          h('label', null, 'время ', h('b', null, liHHMM(LI.min)), ' ',
            h('input', { type: 'range', min: 0, max: 1435, step: 5, value: LI.min, oninput: e => { LI.min = +e.target.value; store.set('li.min', LI.min); e.target.previousElementSibling.textContent = liHHMM(LI.min); liPaint(); }, onchange: () => LI.render() })),
          h('label', null, 'облачность ', h('b', null, LI.cloud + '%'), ' ',
            h('input', { type: 'range', min: 0, max: 100, step: 5, value: LI.cloud, oninput: e => { LI.cloud = +e.target.value; e.target.previousElementSibling.textContent = LI.cloud + '%'; liPaint(); }, onchange: () => LI.render() }))),
        liStrip(P),
        h('div', { class: 'li-ctl' },
          h('select', { class: 'gr-in', onchange: async e => { LI.map[P.id] = e.target.value; store.set('li.map.' + P.id, e.target.value); await liLoadImg(e.target.value); LI.render(); } },
            LI.st.maps.filter(m => m.tileset).map(m => h('option', { value: m.tmx, selected: m.tmx === tmx }, m.tmx))),
          h('span', { id: 'liNow', class: 'tl-hint' })),
        LI.loading ? h('div', { class: 'tl-hint' }, 'загружаю ' + LI.loading + '…') : null,
        h('canvas', { id: 'liCv', class: 'li-cv', title: 'Тянуть мышью — двигать карту',
          onmousedown: e => {
            const sx = e.clientX, sy = e.clientY, ox = LI.ox | 0, oy = LI.oy | 0, k = 1 / 2;   // canvas 2×
            const mv = ev => { LI.ox = ox - (ev.clientX - sx) * k; LI.oy = oy - (ev.clientY - sy) * k; liPaint(); };
            const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
            addEventListener('mousemove', mv); addEventListener('mouseup', up);
          } }),
        h('div', { class: 'tl-hint' }, 'Превью — палитра тайлсета карты через формулу игры; спрайты красятся так же.'))));
}

function liRenderLevels() {
  const ids = LI.m.profiles.map(p => p.id);
  const rows = [...LI.m.levels].sort((a, b) => a.level - b.level).map(lv => h('tr', null,
    h('td', null, h('span', { class: 'gr-cid' }, lv.level)),
    h('td', { class: 'tl-hint' }, LI.st.levelMaps[lv.level] ? 'map-' + LI.st.levelMaps[lv.level] : ''),
    h('td', null, h('select', { class: 'gr-in', onchange: e => { lv.profile = e.target.value || null; LI.touch(); } },
      h('option', { value: '', selected: !lv.profile }, '— без окон (родная палитра)'),
      LI.m.profiles.map(p => h('option', { value: p.id, selected: lv.profile === p.id }, `${p.id}: ${p.title}`)))),
    h('td', null, h('input', { class: 'gr-in li-note', value: lv.note || '', oninput: e => { lv.note = e.target.value; LI.touch(); } })),
    h('td', null, h('button', { class: 'chip', title: 'Убрать: уровень станет улицей (погодные фильтры)', onclick: () => { LI.m.levels.splice(LI.m.levels.indexOf(lv), 1); LI.render(); } }, '✕'))));
  const add = h('input', { class: 'gr-in num', type: 'number', min: 0, max: 127, placeholder: '№' });
  return h('div', null,
    h('div', { class: 'tl-hint', style: 'margin-bottom:8px' }, 'Уровня нет в списке — это улица (погода, небо). «Без окон» — родная палитра без фильтров (клуб 101 и т.п.).'),
    h('table', { class: 'gr-phr' }, h('tr', null, ['уровень', 'карта', 'профиль', 'заметка', ''].map(t => h('th', null, t))), rows),
    h('div', { style: 'margin-top:8px;display:flex;gap:6px' }, add,
      h('button', { class: 'btn', onclick: () => {
        const n = parseInt(add.value, 10);
        if (!(n >= 0 && n <= 127)) { toast('Номер уровня 0..127', 'err'); return; }
        if (LI.m.levels.some(l => l.level === n)) { toast('Уровень уже в списке', 'err'); return; }
        LI.m.levels.push({ level: n, profile: ids[0] || null, note: '' }); LI.render();
      } }, '+ уровень')));
}

function liAddProfile() {
  const src = liProfile() || LI.m.profiles[0];
  let id = prompt('id нового профиля (латиница, цифры, _):', src ? src.id + '_2' : 'room');
  if (!id) return;
  id = id.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(id) || LI.m.profiles.some(p => p.id === id)) { toast('Плохой или занятый id', 'err'); return; }
  const p = src ? JSON.parse(JSON.stringify(src)) : { title: '', cloudSunCut: 70, cloudDesat: 35, keys: [
    { min: 0, r: 16, g: 16, b: 16, amt: 0, sun: 0, sky: 0, note: '' }, { min: 1440, r: 16, g: 16, b: 16, amt: 0, sun: 0, sky: 0, note: '' }] };
  p.id = id; p.title = (p.title || '') + ' (копия)';
  LI.m.profiles.push(p); LI.sub = id; store.set('li.sub', id); LI.render();
}

function liDelProfile(P) {
  const n = LI.m.levels.filter(l => l.profile === P.id).length;
  if (!confirm(`Удалить профиль «${P.id}»?` + (n ? ` ${n} уровн(я/ей) станут «без окон».` : ''))) return;
  LI.m.levels.forEach(l => { if (l.profile === P.id) l.profile = null; });
  LI.m.profiles.splice(LI.m.profiles.indexOf(P), 1);
  LI.sub = (LI.m.profiles[0] || {}).id || 'levels'; LI.render();
}

function liRender() {
  const root = $('#light'); root.innerHTML = '';
  const sub = (k, label) => h('button', { class: 'tab' + (LI.sub === k ? ' on' : ''), onclick: () => { LI.sub = k; store.set('li.sub', k); LI.render(); } }, label);
  const P = liProfile();
  root.append(h('div', { class: 'gr' },
    h('div', { class: 'gr-bar' },
      LI.m.profiles.map(p => sub(p.id, '💡 ' + (p.title || p.id))),
      h('button', { class: 'chip', title: 'Новый профиль — копия текущего', onclick: liAddProfile }, '+'),
      P ? h('button', { class: 'chip', title: 'Удалить этот профиль', onclick: () => liDelProfile(P) }, '🗑') : null,
      h('span', { class: 'pe-sep' }), sub('levels', '🏠 Уровни'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'tl-hint' }, LI.fileHint()),
      ...LI.buttons()),
    h('div', { class: 'gr-body' }, P ? liRenderProfile(P) : liRenderLevels())));
  if (P) {
    const tmx = liMapFor(P);
    if (LI.imgKey !== tmx) liLoadImg(tmx).then(() => liPaint()); else liPaint();
  }
}
