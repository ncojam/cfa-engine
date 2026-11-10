// ============================================================ Вкладка «Миссии»: порядок прохождения (project/src/mission_order.cpp)
// ID миссии = индекс в dPointers, он не меняется; здесь двигаем только место в сюжете (missionOrder[]).
// Описание — комментарий у строки массива. Перетаскивание мышью или ↑ ↓.

const MO = dataTab({
  id: 'missions', root: '#missions', what: 'правки порядка миссий', saved: 'mission_order.cpp сохранён',
  render: () => moRender(),
  afterSave: st => {   // дерево диалогов показывает миссии в этом порядке
    S.order = st.model.order.map(o => o.id);
    if (typeof renderTree === 'function') renderTree();
  },
}, { drag: -1 });

const moInfo = id => (MO.st.missions || []).find(m => m.id === id);

function moMove(from, to) {
  const L = MO.m.order;
  if (to < 0 || to >= L.length || from === to) return;
  L.splice(to, 0, L.splice(from, 1)[0]);
  MO.render();
}

function moRow(o, i) {
  const info = moInfo(o.id);
  const row = h('div', { class: 'mo-row' + (MO.drag === i ? ' drag' : ''), draggable: 'true',
    ondragstart: e => { MO.drag = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); },
    ondragend: () => { MO.drag = -1; $$('.mo-row.over').forEach(x => x.classList.remove('over')); },
    ondragover: e => { e.preventDefault(); row.classList.add('over'); },
    ondragleave: () => row.classList.remove('over'),
    ondrop: e => { e.preventDefault(); const from = MO.drag; MO.drag = -1; moMove(from, i); } },
    h('span', { class: 'mo-grip', title: 'Перетащить' }, '⋮⋮'),
    h('span', { class: 'mo-pos' }, (i + 1) + '.'),
    h('span', { class: 'gr-cid', title: 'ID миссии (индекс dPointers)' }, o.id),
    h('input', { class: 'gr-in mo-note', value: o.note, placeholder: 'описание (комментарий в mission_order.cpp)', oninput: e => { o.note = e.target.value; MO.touch(); } }),
    h('span', { class: 'mo-dlg', title: info ? `${info.name}: ${info.dialogues} диалог(ов)` : 'нет в dPointers' },
      info ? `${info.title || info.name} · ${info.dialogues} дл.` : '⚠ нет в dPointers'),
    h('button', { class: 'chip', title: 'Выше', onclick: () => moMove(i, i - 1), disabled: i === 0 }, '↑'),
    h('button', { class: 'chip', title: 'Ниже', onclick: () => moMove(i, i + 1), disabled: i === MO.m.order.length - 1 }, '↓'),
    h('button', { class: 'chip', title: 'Убрать из порядка (в игре туда будет не попасть)', onclick: () => { MO.m.order.splice(i, 1); MO.render(); } }, '✕'));
  return row;
}

function moRender() {
  const root = $('#missions'); root.innerHTML = '';
  const inOrder = new Set(MO.m.order.map(o => o.id));
  const rest = (MO.st.missions || []).filter(m => !inOrder.has(m.id));
  root.append(h('div', { class: 'gr' },
    h('div', { class: 'gr-bar' },
      h('b', null, 'Порядок миссий'),
      h('span', { class: 'tl-hint' }, `${MO.m.order.length} в сюжете · ${MO.fileHint()}`),
      h('div', { class: 'spacer' }),
      ...MO.buttons()),
    h('div', { class: 'gr-body' },
      h('div', { class: 'tl-hint', style: 'margin-bottom:8px' }, 'ID не меняется (на него ссылаются dPointers, misObj, сохранения) — меняется только место в сюжете. Правее — заголовок миссии из dialogues.cpp.'),
      h('div', { class: 'mo-list' }, MO.m.order.map(moRow)),
      rest.length ? h('div', { class: 'mo-rest' },
        h('div', { class: 'tl-hint' }, 'Не в порядке прохождения — в игре сюда не попасть:'),
        rest.map(m => h('div', { class: 'mo-row' },
          h('span', { class: 'gr-cid' }, m.id),
          h('span', { class: 'mo-dlg' }, `${m.title || m.name} · ${m.dialogues} дл.`),
          h('button', { class: 'chip', onclick: () => { MO.m.order.push({ id: m.id, note: m.title || '' }); MO.render(); } }, '+ в конец')))) : null)));
}
