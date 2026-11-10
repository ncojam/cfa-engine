// ============================================================ Стандарт вкладки «данные -> сгенерированный файл»
// Вкладки groups / people / npc / light / missions устроены одинаково:
//   GET  /api/<tab>/state -> { model, hash, files, ...справочники }   (server.py: DATA_TABS)
//   POST /api/<tab>/save  { model, hash, force } -> state (409 — файл поменяли на диске)
// Всё общее — загрузка, «грязность», ⟳ С диска, Сохранить, Ctrl+S, 409, beforeunload — здесь.
// Вкладка описывает только своё:
//
//   const XX = dataTab({ id: 'xx', root: '#xx', what: 'правки xx', saved: 'xx.cpp сохранён',
//     render: () => {...},              // рисует #xx целиком; кнопки — XX.buttons()
//     ingest: st => {...},              // необязательно: доп. разбор после загрузки
//     prepare: m => m | 'текст ошибки', // необязательно: чистка/проверка копии модели перед save
//   }, { ...свои поля состояния });
//
// В разметке поля правки зовут XX.touch() (без перерисовки, чтобы не терять фокус)
// или XX.render(). Новые вкладки: кнопка в index.html (data-tab=id), <section id=...>,
// <script> до tabs.js — TAB_DEFS подхватит сам.

const DATA_TABS = {};

function dataTab(cfg, extra = {}) {
  const T = Object.assign({ st: null, m: null, orig: '', busy: false }, extra);
  const root = () => $(cfg.root);

  T.dirty = () => !!T.m && JSON.stringify(T.m) !== T.orig;
  T.render = () => { if (T.m) cfg.render(); };
  T.touch = () => {
    const b = root() && root().querySelector('.dt-save');
    if (b) { b.disabled = !T.dirty() || T.busy; b.classList.toggle('dirty', T.dirty()); }
    if (cfg.touched) cfg.touched();
  };
  T.ingest = st => {
    T.st = st; T.m = st.model; T.orig = JSON.stringify(st.model);
    if (cfg.ingest) cfg.ingest(st);
    T.render();
  };
  T.load = async () => {
    try {
      const st = await api(`/api/${cfg.id}/state`);
      if (st.error) throw new Error(st.error);
      T.ingest(st);
    } catch (e) {
      const r = root(); r.innerHTML = '';
      r.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Не удалось загрузить: ' + cfg.id), h('div', { class: 'empty-sub' }, e.message)));
    }
  };
  T.open = async () => { root().hidden = false; if (!T.st) await T.load(); else T.render(); };
  T.close = () => { root().hidden = true; };
  T.reload = async () => {
    if (T.dirty() && !confirm(`Есть несохранённые ${cfg.what}. Перечитать с диска и потерять их?`)) return;
    T.st = null; await T.load(); toast('Перечитано с диска');
  };
  T.save = async force => {
    if (!T.dirty() || T.busy) return;
    let m = JSON.parse(JSON.stringify(T.m));
    if (cfg.prepare) {
      const r = cfg.prepare(m);
      if (typeof r === 'string') { toast(r, 'err'); return; }
      if (r) m = r;
    }
    T.busy = true;
    try {
      const st = await api(`/api/${cfg.id}/save`, { hash: T.st.hash, model: m, force: !!force });
      T.ingest(st);
      toast(st.changed ? cfg.saved : 'Без изменений', 'ok');
      if (cfg.afterSave) cfg.afterSave(st);
    } catch (e) {
      if (e.status === 409 && confirm(e.message + '\n\nПерезаписать своими правками?')) { T.busy = false; return T.save(true); }
      toast('Не сохранено: ' + e.message, 'err');
    } finally { T.busy = false; T.render(); }
  };
  // «⟳ С диска» + «Сохранить» для полосы вкладки
  T.buttons = () => [
    h('button', { class: 'btn', onclick: () => T.reload() }, '⟳ С диска'),
    h('button', { class: 'btn primary dt-save' + (T.dirty() ? ' dirty' : ''), disabled: !T.dirty() || T.busy,
      onclick: () => T.save(), title: `Записать ${(T.st && T.st.files || []).map(f => f.replace(/.*[\\/]/, '')).join(' / ')} (Ctrl+S)` }, 'Сохранить'),
  ];
  // путь файла коротко: «src/xx.cpp»
  T.fileHint = () => (T.st && T.st.files || []).map(f => f.replace(/.*[\\/]src[\\/]/, 'src/')).join(', ');

  addEventListener('keydown', e => {
    if (typeof TABS === 'undefined' || TABS.cur !== cfg.id) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); T.save(); }
    else if (cfg.onKey) cfg.onKey(e);
  });
  addEventListener('beforeunload', e => { if (T.dirty()) { e.preventDefault(); e.returnValue = ''; } });

  DATA_TABS[cfg.id] = { open: () => T.open(), close: () => T.close() };
  return T;
}
