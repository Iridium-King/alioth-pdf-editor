const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadAppModules } = require('./helpers/document-harness.cjs');
const root = path.resolve(__dirname, '../..');

test('bookmark identities use the complete document name and migrate only owned legacy entries', () => {
  const storage = new Map();
  const context = { window: {}, document: { addEventListener() {} }, console,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    btoa: value => Buffer.from(value, 'binary').toString('base64'), unescape, encodeURIComponent };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/bookmark_manager.js'), 'utf8'), context);
  const manager = context.window.BookmarkManager;
  const a = { id: 'a', name: 'CERTIFICADO MEDICO JUAN.pdf', pages: [{}] };
  const b = { id: 'b', name: 'CERTIFICADO MEDICO PEDRO.pdf', pages: [{}] };
  assert.notEqual(manager._key(a), manager._key(b));
  const legacyKey = 'alioth_bookmarks_' + context.btoa(a.name + '_1').slice(0, 20);
  const legacy = JSON.stringify({ bookmarks: [{ id: 'one', docId: 'a' }, { id: 'two', docId: 'b' }] });
  storage.set(legacyKey, legacy);
  assert.deepEqual(Array.from(manager.getAll(a), item => item.id), ['one']);
  assert.deepEqual(Array.from(manager.getAll(b), item => item.id), ['two']);
  assert.equal(storage.get(legacyKey), legacy);
  manager._save(a, []);
  assert.equal(manager.getAll(b).length, 1);
  const reopened = { ...b, id: 'new-session' };
  assert.equal(manager.getAll(reopened).length, 1);
});

test('sidebar field changes save deletion and independent duplicates in reopened PDFs', async () => {
  const elements = { 'loader-msg': { innerText: '' } };
  const h = loadAppModules(['js/app.annotations.js', 'js/app.pdf.js'], {
    TextEncoder, TextDecoder,
    document: { addEventListener() {}, getElementById: id => elements[id] || null, querySelectorAll: () => [] },
    PythonManager: { isLoaded: false }
  });
  const { app, context } = h;
  context.Object = vm.runInNewContext('({}).constructor', context);
  const pdf = await context.PDFLib.PDFDocument.create();
  const pg = pdf.addPage(); pg.setSize(300, 220);
  const native = pdf.getForm().createTextField('original');
  native.setText('VALOR'); native.addToPage(pg, { x: 20, y: 140, width: 170, height: 24 });
  const bytes = await pdf.save();
  const field = { id: 'widget', type: 'form-field', fieldType: 'text', fieldName: 'original', nativeFieldName: 'original', nativeAnnotationId: '10R', fromFormField: true, x: 20, y: 56, width: 170, height: 24, textValue: 'VALOR', value: 'VALOR', font: 'Helvetica', fontSize: 12 };
  const page = { id: 'p', sourceId: 'src', pageIndex: 0, rotation: 0, objects: [field], nativeFormValues: {} };
  const doc = { id: 'field-test', name: 'fields.pdf', pages: [page], sources: { src: { buffer: bytes.buffer } }, currentIndex: 0, history: [], historyIndex: -1 };
  Object.assign(app, { docs: [doc], activeDocId: doc.id, getDoc: () => doc, toggleLoader() {}, showToast() {}, refreshFieldsPanel() {}, loadPage: async () => {}, saveState() {} });
  await app._changeSidebarFields('duplicate', [{ pageIdx: 0, field }]);
  const clone = page.objects[1];
  assert.equal(clone.fromFormField, false);
  assert.notEqual(clone.fieldName, field.fieldName);
  assert.equal(clone.nativeAnnotationId, undefined);
  let output = await app.savePDFInternal(false, null, false, true);
  let reopened = await context.PDFLib.PDFDocument.load(output);
  assert.equal(reopened.getForm().getFields().length, 2);
  assert.equal(reopened.getForm().getTextField(clone.fieldName).getText(), 'VALOR');
  doc.pages.push({ ...page, id: 'second-copy', objects: [], nativeFormValues: {} });
  await app._changeSidebarFields('delete', [{ pageIdx: 0, field }]);
  assert.deepEqual(Array.from(page.deletedNativeFields), ['original']);
  output = await app.savePDFInternal(false, null, false, true);
  reopened = await context.PDFLib.PDFDocument.load(output);
  assert.equal(reopened.getPageCount(), 2);
  assert.deepEqual(Array.from(reopened.getForm().getFields(), field => field.getName()), [clone.fieldName]);
});

test('sidebar selection uses widget identity when names repeat', async () => {
  const rows = [{ dataset: { pageIdx: '0', fieldId: 'second' } }];
  const { app, first, documentObject } = loadAppModules(['js/app.annotations.js']);
  const a = { id: 'first', type: 'form-field', fieldName: 'same', x: 0, y: 0 };
  const b = { ...a, id: 'second' };
  first.pages[0].objects = [a, b];
  app.loadPage = async () => {};
  app.saveState = app.refreshFieldsPanel = () => {};
  const list = { querySelectorAll: () => rows };
  documentObject.getElementById = () => list;
  await app.deleteSelectedFields();
  assert.deepEqual(first.pages[0].objects.map(item => item.id), ['first']);
});

test('layer controls invalidate cached canvases and refresh each owned panel', async () => {
  const { app, first } = loadAppModules(['js/app.panels.js']);
  let visibilityChanges = 0, cancelled = 0;
  const config = { setVisibility() { visibilityChanges++; }, getGroups: () => ({ a: {}, b: {} }) };
  const src = first.sources['source-a'];
  src.optionalContentConfigPromise = Promise.resolve(config);
  app.splitView = { activePanel: 'primary', primary: { docId: first.id, pageIndex: 0 }, secondary: { docId: first.id, pageIndex: 1 } };
  const canvas = { _renderedSessionToken: Symbol(), _activeRenderTask: { cancel() { cancelled++; } } };
  app.getPanelElements = () => ({ mainView: { querySelectorAll: () => [canvas] } });
  const calls = [];
  app.loadPage = async (index, panel) => calls.push([index, panel]);
  await app.toggleLayerVisibility('a', false);
  assert.equal(visibilityChanges, 1);
  assert.equal(canvas._renderedSessionToken, null);
  assert.equal(calls.length, 2);
  assert.equal(calls.at(-1)[1], 'primary');
  assert.equal(cancelled, 2);
});

test('form-script generation uses the configured backend and never executes generated code', async () => {
  const elements = { 'fc-ai-prompt': { value: 'Sumar campos' }, 'fc-ai-btn': {}, 'fc-code-input': { value: '' } };
  let requested;
  const { app } = loadAppModules(['js/app.core.js'], {
    localStorage: { getItem: () => null }, AbortSignal,
    document: { addEventListener() {}, getElementById: id => elements[id] || null, querySelectorAll: () => [] },
    fetch: async (url, options) => { requested = { url, ...JSON.parse(options.body) }; return { ok: true, json: async () => ({ ok: true, text: JSON.stringify({ code: 'throw new Error("must remain editable");' }) }) }; }
  });
  app._fcGetPageFields = () => [{ fieldName: 'a', fieldType: 'text' }];
  app.showToast = () => {};
  await app.generateFormScriptAI();
  assert.equal(requested.url, '/api/ai/generate-json');
  assert.ok(requested.prompt.includes('Sumar campos'));
  assert.equal(elements['fc-code-input'].value, 'throw new Error("must remain editable");');
  assert.equal(elements['fc-ai-btn'].disabled, false);
});

test('TSV copy preserves mapped columns, quotes and empty values', async () => {
  let copied;
  const { app } = loadAppModules(['js/app.ui.js'], { navigator: { clipboard: { writeText: async value => { copied = value; } } } });
  app._dexRenderedFields = [{ key: 'Nombre', value: 'A\tB' }, { key: 'Valor', value: null }];
  app.showToast = () => {};
  await app.dexCopyToClipboard();
  assert.equal(copied, 'Nombre\tValor\n"A\tB"\t');
});

test('split output preserves interactive forms and page counts without changing the source', async () => {
  const downloads = [];
  const h = loadAppModules(['js/app.pdf.js', 'js/app.ui.js'], {
    TextEncoder, TextDecoder, Blob,
    document: { addEventListener() {}, getElementById: () => ({ style: {}, innerText: '' }), querySelectorAll: () => [] },
    PythonManager: { isLoaded: false }, saveAs: (blob, name) => downloads.push({ blob, name })
  });
  const { app, context } = h;
  context.Object = vm.runInNewContext('({}).constructor', context);
  const pdf = await context.PDFLib.PDFDocument.create();
  const p = pdf.addPage(); p.setSize(300, 220); pdf.addPage().setSize(300, 220);
  const field = pdf.getForm().createTextField('nombre'); field.setText('PRUEBA'); field.addToPage(p, { x: 20, y: 100, width: 100, height: 20 });
  const bytes = await pdf.save();
  const doc = { id: 'split-test', name: 'split.pdf', currentIndex: 0, pages: [0, 1].map(pageIndex => ({ id: `p${pageIndex}`, sourceId: 'src', pageIndex, rotation: 0, objects: [] })), sources: { src: { buffer: bytes.buffer } }, history: [], historyIndex: -1 };
  Object.assign(app, { docs: [doc], activeDocId: doc.id, toggleLoader() {}, showToast() {} });
  await app.splitPDF(doc.id, 1);
  assert.equal(downloads.length, 2);
  for (const download of downloads) {
    const reopened = await context.PDFLib.PDFDocument.load(await download.blob.arrayBuffer());
    assert.equal(reopened.getPageCount(), 1);
  }
  const first = await context.PDFLib.PDFDocument.load(await downloads[0].blob.arrayBuffer());
  assert.equal(first.getForm().getTextField('nombre').getText(), 'PRUEBA');
  assert.equal(doc.pages.length, 2);
});

test('fit page uses rotated viewport dimensions and the active panel scale', async () => {
  const { app, first } = loadAppModules(['js/app.ui.js']);
  first.pages[0].rotation = 90;
  app.splitView = { activePanel: 'secondary', secondary: { scale: 2 } };
  app.getPanelElements = () => ({ mainView: { clientWidth: 632, clientHeight: 848 } });
  app.loadSourcePdf = async () => ({ getPage: async () => ({ rotate: 0, getViewport: ({ rotation }) => {
    assert.equal(rotation, 90); return { width: 600, height: 400 };
  } }) });
  let request;
  app.zoomPanel = (delta, panel) => { request = { delta, panel }; };
  await app.fitToPage();
  assert.deepEqual(request, { delta: -1, panel: 'secondary' });
});

test('merge command passes chosen PDFs to the existing ordering workflow', () => {
  const input = { click() { this.clicked = true; } };
  const { app } = loadAppModules(['js/app.ui.js']);
  let files;
  app.handleSidebarDrop = selected => { files = selected; };
  // The picker is isolated from any user document or native file dialog.
  const create = vm.runInNewContext('(input) => ({ addEventListener(){}, createElement(){ return input; } })')(input);
  const context = { window: { app }, document: create, console };
  vm.runInNewContext(`(function(){${fs.readFileSync(path.join(root, 'js/app.ui.js'), 'utf8')}\n})();`, context);
  app.openMergeModal();
  assert.equal(input.clicked, true);
  assert.equal(input.multiple, true);
  input.files = [{ name: 'a.pdf' }, { name: 'b.pdf' }];
  input.onchange();
  assert.deepEqual(Array.from(files, file => file.name), ['a.pdf', 'b.pdf']);
});
