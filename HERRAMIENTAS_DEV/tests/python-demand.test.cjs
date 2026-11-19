const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadAppModules } = require('./helpers/document-harness.cjs');
const root = path.resolve(__dirname, '../..');

function fixture(modules = []) {
  const h = loadAppModules(modules, { localStorage: { getItem: () => null } });
  const messages = [], loaders = [];
  h.app.showToast = message => messages.push(message);
  h.app.toggleLoader = value => loaders.push(value);
  h.context.PythonManager = h.windowObject.PythonManager = { isLoaded: false };
  return { ...h, engine: h.context.PythonManager, messages, loaders };
}

test('image editing waits for cold engine and uses source page index after reordering', async () => {
  const h = fixture();
  const { app, first, engine, documentObject, windowObject, loaders } = h;
  first.pages[0].pageIndex = 4;
  first.pages[0].objects = [];
  app.currentScale = 2;
  documentObject.body = { classList: { remove() {} } };
  const canvas = { style: {}, getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  documentObject.getElementById = id => id === 'the-canvas' ? canvas : null;
  windowObject.removeEventListener = () => {};
  let ready;
  engine.init = () => new Promise(resolve => { ready = () => { engine.isLoaded = true; resolve(); }; });
  let called = false;
  engine.extractAndEraseImageAtPoint = async (buffer, page, x, y) => {
    assert.equal(engine.isLoaded, true); assert.equal(page, 4);
    assert.equal(x, 20); assert.equal(y, 30); called = true;
    return { buffer: buffer.slice(0), bbox: { x: 1, y: 2, w: 3, h: 4 }, base64: 'data:image/png;base64,AA==' };
  };
  app.loadPage = async () => {};
  app.saveState = () => {};
  app.renderOverlays = () => {};
  const pending = app.captureImageForEdit({ clientX: 50, clientY: 80 });
  assert.equal(called, false); assert.deepEqual(loaders, [true]);
  ready(); await pending;
  assert.equal(called, true); assert.equal(first.pages[0].objects.length, 1);
  assert.equal(loaders.at(-1), false);
});

test('all formerly blocking tools handle an initialization error and can retry', async () => {
  const h = fixture(['js/app.pdf_ops.js', 'js/app.ai.js']);
  // Verify actual tool names from the modules (rather than silently skipping one).
  const source = fs.readFileSync(path.join(root, 'js/app.pdf_ops.js'), 'utf8');
  const methods = ['showRemoveImagesModal', 'detectAndShowTables', 'tableToFormAI', 'enableCensorMode'];
  // Other two entry points are located by the gate in their function body.
  for (const match of source.matchAll(/(\w+): async function/g)) {
    const body = source.slice(match.index, source.indexOf('\n            },', match.index));
    if (body.includes('if (!await this._ensurePythonEngine()) return;') && !methods.includes(match[1])) methods.push(match[1]);
  }
  assert.equal(methods.length, 6);
  h.engine.init = async () => { throw new Error('simulated loading failure'); };
  h.context.console = { ...console, error() {} };
  for (const name of methods) {
    assert.equal(typeof h.app[name], 'function', name);
    await h.app[name]();
  }
  assert.equal(h.messages.filter(m => m.includes('No se pudo iniciar')).length, 6);
  h.engine.init = async () => { h.engine.isLoaded = true; };
  assert.equal(await h.app._ensurePythonEngine(), true);
});

test('failed lazy script is removed so retry waits for a new script', async () => {
  const scripts = [];
  const document = {
    querySelector: () => scripts[0] || null,
    createElement: () => ({ remove() { scripts.splice(scripts.indexOf(this), 1); } }),
    head: { appendChild(script) { scripts.push(script); } }
  };
  const context = { window: { app: {} }, document, console: { error() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/app.lazy.js'), 'utf8'), context);
  const first = context.window.app.lazyLoad('pyodide');
  scripts[0].onerror(new Error('simulated failure'));
  await assert.rejects(first); assert.equal(scripts.length, 0);
  let done = false;
  const retry = context.window.app.lazyLoad('pyodide').then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  scripts[0].onload(); await retry; assert.equal(done, true);
});
