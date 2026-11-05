const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { loadAppModules } = require('./helpers/document-harness.cjs');

test('concurrent path resolution uses one content hash and one native request', async () => {
  const calls = [];
  const h = loadAppModules(['js/app.core.js'], {
    location: { href: 'http://127.0.0.1:8765/' },
    fetch: async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, path: 'C:\\origen\\base.pdf' }) }; }
  });
  h.windowObject.crypto = webcrypto;
  let reads = 0;
  const file = { name: 'base.pdf', size: 4, arrayBuffer: async () => { reads++; return new Uint8Array([1, 2, 3, 4]).buffer; } };
  const paths = await Promise.all([h.app.resolveFileOriginPath(file), h.app.resolveFileOriginPath(file)]);
  assert.equal(paths[0], 'C:\\origen\\base.pdf');
  assert.equal(paths[1], paths[0]);
  assert.equal(reads, 1);
  assert.match(calls[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 1);
});

test('Save As retains the base directory after inserting another PDF and changing the output name', async () => {
  let payload;
  const h = loadAppModules(['js/app.pdf.js'], {
    pdfjsLib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 2 }) }) },
    fetch: async (url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true, cancelled: true }) }; }
  });
  h.first.originalPath = 'C:\\origen\\base.pdf';
  h.documentObject.getElementById = id => id === 'loader' ? { style: { display: 'none' } } : null;
  h.app.loadPage = h.app.saveState = h.app.toggleLoader = h.app.showToast = () => {};
  await h.app.insertPDF({ name: 'otro.pdf', type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(4) }, 0);
  h.first.name = 'editado.pdf';
  h.first.filePath = 'D:\\otro-destino\\editado.pdf';
  await h.app.pickSaveTarget();
  assert.equal(payload.source_path, 'C:\\origen\\base.pdf');
  assert.equal(payload.suggested_name, 'editado.pdf');
  assert.equal(h.first.pages.length, 4);
});

test('the original path survives document snapshots and restores into a new document', async () => {
  const h = loadAppModules();
  h.first.originalPath = 'C:\\origen\\base.pdf';
  const snapshot = await h.app.captureDocumentSnapshot(h.first.id);
  await h.app.restoreDocumentSnapshot(h.second.id, snapshot);
  assert.equal(h.second.originalPath, h.first.originalPath);
});

test('a converted Office document remembers its folder without binding Save to the Office file', async () => {
  const h = loadAppModules(['js/app.pdf.js'], {
    localStorage: { getItem: () => 'tab' },
    pdfjsLib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }) }) }
  });
  h.first.pages = [];
  for (const method of ['renderTabs', 'toggleLoader', 'saveState', 'switchTab', 'updateWindowTitle']) h.app[method] = () => {};
  h.app.setDocumentBaseline = h.app.addToRecentDocs = async () => {};
  h.app.bindOpenedFilePath = () => { throw Error('Do not bind Save to a .docx'); };
  await h.app.openFile({ name: 'convertido.pdf', type: 'application/pdf', _aliothOriginalPath: 'C:\\origen\\base.docx',
    arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7').buffer });
  assert.equal(h.first.originalPath, 'C:\\origen\\base.docx');
  assert.equal(h.first.filePath, null);
});
