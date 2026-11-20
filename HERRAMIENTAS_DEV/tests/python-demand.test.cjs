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
  const { app, first, engine, context, windowObject, loaders } = h;
  const page = first.pages[0];
  page.pageIndex = 4;
  page.objects = [];
  app.splitView = { activePanel: 'primary' };
  windowObject.i18n = { t: key => key };
  context.crypto = { randomUUID: () => 'test-image' };
  context.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({}) }) };
  app.loadSourcePdf = async () => ({
    getPage: async number => {
      assert.equal(number, 5);
      return { getViewport: () => ({ width: 200, height: 100, transform: [1, 0, 0, -1, 0, 100] }) };
    }
  });
  let ready;
  engine.init = () => new Promise(resolve => { ready = () => { engine.isLoaded = true; resolve(); }; });
  let called = false;
  engine.liftPdfImage = async (buffer, pageIndex, selection) => {
    assert.equal(engine.isLoaded, true); assert.equal(pageIndex, 4);
    assert.deepEqual(Array.from(selection.rect), [20, 30, 60, 80]);
    called = true;
    return { buffer: buffer.slice(0), bounds: [20, 30, 60, 80], base64: 'data:image/png;base64,AA==' };
  };
  app.loadPage = async () => {};
  app.releasePdfSource = () => {};
  app.getPanelElements = () => ({});
  app.saveState = () => {};
  app.renderOverlays = () => {};
  const pending = app.captureImageForEdit({ doc: first, panelId: 'primary', index: 0, page, rect: [0.1, 0.3, 0.3, 0.8] });
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
