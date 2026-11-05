const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture(horizontal = false) {
  const h = loadAppModules(['js/app.ui.js', 'js/app.render.js', 'js/app.pdf.js'], {
    PythonManager: { isLoaded: false },
    pdfjsLib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 2 }) }) }
  });
  const classes = (...initial) => {
    const values = new Set(initial);
    return { add: (...names) => names.forEach(x => values.add(x)), remove: (...names) => names.forEach(x => values.delete(x)), contains: x => values.has(x) };
  };
  const thumbs = [0, 1, 2].map(index => ({
    dataset: { index: String(index) }, classList: classes('drop-target-bottom'),
    getBoundingClientRect: () => ({ top: 20 + index * 120, height: 100, left: 20 + index * 120, width: 100 })
  }));
  h.first.pages = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const overlay = { style: { display: 'flex' } };
  const panels = [0, 1].map(() => ({ classList: classes('drag-over'), addEventListener() {}, contains: () => false }));
  h.documentObject.body = { classList: classes(...(horizontal ? ['h-layout'] : [])) };
  h.documentObject.querySelectorAll = selector => selector.includes('thumb-wrap') ? thumbs : selector.includes('view-panel') ? panels : [];
  h.documentObject.getElementById = id => id === 'drop-overlay' ? overlay : id === 'loader' ? { style: { display: 'none' } } :
    id === 'panelPrimary' ? panels[0] : id === 'panelSecondary' ? panels[1] : null;
  h.app.splitView = { mode: 'single', activePanel: 'primary' };
  h.app.closeAllModals = () => {};
  h.app.toggleLoader = () => {};
  h.app.loadPage = () => {};
  h.app.saveState = () => {};
  h.app.renderSidebar = () => {};
  return { ...h, thumbs, overlay, panels };
}

for (const horizontal of [false, true]) {
  test(`drop positions include the first page, both thumbnail halves, gaps and the end (${horizontal ? 'horizontal' : 'vertical'})`, () => {
    const h = fixture(horizontal);
    for (const [position, target, expected] of [[5, null, 0], [30, h.thumbs[0], 0], [110, h.thumbs[0], 1],
      [130, null, 1], [150, h.thumbs[1], 1], [230, h.thumbs[1], 2], [500, null, 3]]) {
      assert.equal(h.app._sidebarDropIndex({ clientX: position, clientY: position, target: { closest: () => target } }, h.first), expected);
    }
  });
}

test('file drops insert all pages at the selected boundary without a one-page displacement', async () => {
  for (const index of [0, 1, 2, 3]) {
    const h = fixture();
    const files = ['uno.pdf', 'dos.pdf'].map(name => ({ name, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(4) }));
    h.documentObject.querySelectorAll = selector => selector.includes('sort-name') ? files.map(file => ({ innerText: file.name })) : [];
    h.app.pendingDropFiles = files;
    h.app.dropTargetIndex = index;
    await h.app.resolveSidebarDrop('insert');
    assert.equal(h.first.pages.length, 7);
    assert.deepEqual(h.first.pages.filter(p => p.id === 'A' || p.id === 'B' || p.id === 'C').map(p => p.id), ['A', 'B', 'C']);
    assert.equal(h.first.pages.slice(0, index).filter(p => ['A', 'B', 'C'].includes(p.id)).length, index);
    assert.equal(h.first.pages.slice(index, index + 4).filter(p => p.sourceId).length, 4);
    assert.equal(h.app.dropTargetIndex, null);
  }
});

test('a capture-phase drop cleans panel feedback even when a child stops propagation', () => {
  const h = fixture(), listeners = {};
  h.documentObject.addEventListener = (name, fn, capture) => { listeners[name] = { fn, capture }; };
  h.app.setupPanelEvents();
  assert.equal(listeners.drop.capture, true);
  listeners.drop.fn();
  assert.equal(h.overlay.style.display, 'none');
  assert.ok(h.panels.every(p => !p.classList.contains('drag-over')));
  assert.ok(h.thumbs.every(p => !p.classList.contains('drop-target-bottom')));
});

test('cancelled drops reset both the insertion point and the visible feedback', () => {
  const h = fixture();
  h.app.pendingDropFiles = ['file']; h.app.dropTargetIndex = 0;
  h.app.cancelDrop();
  assert.equal(h.app.dropTargetIndex, null);
  assert.equal(h.app.pendingDropFiles.length, 0);
  assert.equal(h.overlay.style.display, 'none');
});

test('an external file dropped over the active modal appends without opening behind it', () => {
  const h = fixture(), listeners = {}, modal = { style: { display: 'block' } };
  const getElement = h.documentObject.getElementById;
  h.documentObject.getElementById = id => id === 'drop-modal-content' ? modal : getElement(id);
  h.documentObject.addEventListener = (name, fn) => { listeners[name] = fn; };
  const original = { name: 'original.pdf', type: 'application/pdf' }, added = { name: 'segundo.pdf', type: 'application/pdf' };
  h.app.pendingDropFiles = [original]; h.app.dropTargetIndex = 1;
  const calls = [];
  h.app.populateDropContainers = (...args) => calls.push(args);
  h.app.openFile = () => { throw Error('Must remain inside the modal'); };
  h.app.setupPanelEvents();
  let stopped = false, prevented = false;
  listeners.drop({ dataTransfer: { files: [added] }, target: { closest: () => null },
    preventDefault: () => prevented = true, stopImmediatePropagation: () => stopped = true });
  assert.ok(stopped && prevented);
  assert.deepEqual(h.app.pendingDropFiles, [original, added]);
  assert.equal(h.app.dropTargetIndex, 1);
  assert.equal(calls[0][1], true);
});

test('new files in the split modal retain the original insertion boundary and selected panel', () => {
  const h = fixture();
  h.documentObject.getElementById = () => ({ style: { display: 'block' } });
  h.app.pendingDropFiles = [{ name: 'base.pdf' }]; h.app.dropTargetIndex = 0;
  let zone;
  h.app.populateDropContainers = (files, append, target) => { assert.equal(append, true); zone = target; };
  h.app.handleSidebarDrop([{ name: 'nuevo.pdf', type: 'application/pdf' }], null, 'secondary');
  assert.equal(zone, 'secondary');
  assert.equal(h.app.dropTargetIndex, 0);
});

test('same-name files are identified independently after ordering in the modal', () => {
  const h = fixture();
  const files = [{ name: 'mismo.pdf', _aliothDropId: 'a' }, { name: 'mismo.pdf', _aliothDropId: 'b' }];
  h.app.pendingDropFiles = files;
  h.documentObject.getElementById = () => ({ querySelectorAll: () => [files[1], files[0]].map(file => ({ dataset: { fileId: file._aliothDropId, filename: file.name } })) });
  const ordered = h.app.getFilesFromContainer('drop-sort-container');
  assert.equal(ordered[0], files[1]);
  assert.equal(ordered[1], files[0]);
});
