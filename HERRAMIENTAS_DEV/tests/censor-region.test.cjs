const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture(effect = 'solid', fail = false) {
  const calls = [];
  const canvas = { _renderedSessionToken: Symbol(), _pendingSessionToken: Symbol(), closest: () => ({ id: 'page-wrapper-secondary-0', dataset: { index: '0' } }) };
  const viewport = { width: 100, height: 200, convertToPdfPoint: (x, y) => [x, 200 - y] };
  const pdf = { getPage: async () => ({ rotate: 0, getViewport: () => viewport }) };
  const document = { addEventListener() {}, getElementById() {}, querySelectorAll: () => [canvas] };
  const engine = async (...args) => {
    calls.push(args);
    if (fail) throw new Error('ENGINE_FAILED');
    return new Uint8Array([9, 8, 7]).buffer;
  };
  const f = loadAppModules([], {
    document,
    pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(pdf) }) },
    PythonManager: { applyRedactions: engine, applyCensorEffect: engine }
  });
  Object.assign(f.app, {
    splitView: { activePanel: 'secondary', secondary: { docId: f.first.id, scale: 2 } },
    saveState: id => calls.push(['save', id]),
    loadPage: async (...args) => calls.push(['load', ...args]),
    showToast: message => calls.push(['toast', message]),
    toggleLoader: value => calls.push(['loader', value]),
    refreshThumbnail() {}, releasePageThumbnail() {}
  });
  const source = f.first.sources['source-a'];
  source.doc = pdf;
  source.originalBuffer = source.buffer.slice(0);
  f.first.pages[0].objects = [
    { id: 'inside', x: 12, y: 12, width: 5, height: 5 },
    { id: 'outside', x: 70, y: 100, width: 5, height: 5 }
  ];
  const run = () => f.app.applyCensorRegion(20, 20, 40, 40, effect, 10, {
    doc: f.first, page: f.first.pages[0], pageIndex: 0, panelId: 'secondary', viewWidth: 200, viewHeight: 400
  });
  return { ...f, calls, canvas, source, run };
}

for (const effect of ['solid', 'blur', 'pixelate']) {
  test(`${effect}: updates bytes, save source and continuous canvas on the selected panel`, async () => {
    const f = fixture(effect);
    await f.run();
    const rectangles = effect === 'solid' ? f.calls[1][2] : [f.calls[1][2]];
    assert.deepEqual(JSON.parse(JSON.stringify(rectangles)), [{ x0: 10, y0: 170, x1: 30, y1: 190 }]);
    assert.deepEqual(new Uint8Array(f.source.buffer), new Uint8Array([9, 8, 7]));
    assert.deepEqual(new Uint8Array(f.source.originalBuffer), new Uint8Array([9, 8, 7]));
    assert.deepEqual(f.first.pages[0].objects.map(o => o.id), ['outside']);
    assert.equal(f.canvas._renderedSessionToken, null);
    assert.ok(f.calls.some(c => c[0] === 'load' && c[1] === 0 && c[2] === 'secondary'));
    assert.equal(f.calls.at(-1)[1], false);
  });
}

test('failed censorship preserves source and overlays and does not report success', async () => {
  const f = fixture('solid', true);
  const buffer = f.source.buffer;
  await f.run();
  assert.equal(f.source.buffer, buffer);
  assert.equal(f.first.pages[0].objects.length, 2);
  assert.equal(f.calls.some(c => c[0] === 'save' || c[0] === 'load'), false);
  assert.equal(f.calls.some(c => c[0] === 'toast' && c[1].includes('permanentemente')), false);
  assert.equal(f.calls.at(-1)[1], false);
});

test('Python errors and unsupported results propagate instead of returning the input PDF', async () => {
  const context = { window: {}, console, Uint8Array, ArrayBuffer };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/python_manager.js'), 'utf8'), context);
  const manager = context.window.PythonManager;
  manager.isLoaded = true;
  for (const run of [async () => { throw new Error('ENGINE_FAILED'); }, async () => null]) {
    manager.run = run;
    await assert.rejects(manager.applyRedactions(new ArrayBuffer(1), 0, []));
    await assert.rejects(manager.applyCensorEffect(new ArrayBuffer(1), 0, {}, 'blur', 10));
  }
});

test('Escape during a region drag removes mouse listeners and cannot apply censorship', async () => {
  const f = fixture();
  const events = new Map();
  Object.assign(f.windowObject, {
    addEventListener: (type, fn) => events.set(type, fn),
    removeEventListener: type => events.delete(type)
  });
  const bounds = { left: 0, top: 0, right: 200, bottom: 400, width: 200, height: 400 };
  f.context.document.body = { style: {}, appendChild() {} };
  f.context.document.createElement = () => ({ style: {}, remove() {} });
  f.app.getPanelElements = () => ({ mainView: { contains: () => true }, canvas: { getBoundingClientRect: () => bounds } });
  let applied = false;
  f.app.applyCensorRegion = async () => { applied = true; };
  f.app._startCensorSelection(null, 'solid', 10);
  events.get('mousedown')({ target: { closest: () => null }, button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
  const up = events.get('mouseup');
  events.get('keydown')({ key: 'Escape' });
  await up({ clientX: 100, clientY: 100 });
  assert.equal(applied, false);
  assert.equal(events.has('mousemove'), false);
  assert.equal(events.has('mouseup'), false);
});
