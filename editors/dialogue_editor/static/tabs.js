// ============================================================ Вкладки верхней панели
// Каждая вкладка: свой корневой элемент в #main и хуки open/close.
// body получает класс tab-<имя>: по нему CSS прячет панель диалогов и кнопки .dlg-only.

const TABS = { cur: null };

const TAB_DEFS = {
  dialogs: {
    open() { renderEditor(); updateTop(); },
    close() { $('#empty').hidden = true; $('#editor').hidden = true; },
  },
  portraits: {
    open() { openPortraits(); },
    close() { closePortraits(); },
  },
  tiles: {
    open() { openTiles(); },
    close() { $('#tiles').hidden = true; },
  },
  ...DATA_TABS,   // groups, people, npc, missions, light — datatab.js
};

function setTab(name) {
  if (!TAB_DEFS[name]) name = 'dialogs';
  if (TABS.cur === name) return;
  const prev = TABS.cur;
  TABS.cur = name;   // до close/open: renderEditor() смотрит на TABS.cur
  if (prev) TAB_DEFS[prev].close();
  for (const t of Object.keys(TAB_DEFS)) document.body.classList.toggle('tab-' + t, t === name);
  $$('#tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  store.set('tab', name);
  TAB_DEFS[name].open();
}

$$('#tabs .tab').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

{
  // выбор диалога (дерево, ссылка из портретов, #hash) всегда открывает вкладку диалогов
  const _select = select;
  // eslint-disable-next-line no-global-assign
  select = function (name, scrollTo) { if (TABS.cur !== 'dialogs') setTab('dialogs'); return _select(name, scrollTo); };
}

setTab(store.get('tab', 'dialogs'));
