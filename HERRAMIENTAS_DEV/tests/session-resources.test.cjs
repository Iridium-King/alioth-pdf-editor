const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture() {
  const h = loadAppModules(['js/app.core.js', 'js/app.render.js'], {
    localStorage: { getItem: () => null }, TextDecoder,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    console: { log() {}, warn() {}, error() {} }
  });
  const tables = {};
  for (const name of ['documents', 'sources', 'appState']) {
    const rows = new Map();
    tables[name] = { rows, writes: 0,
      async put(record) { this.writes++; rows.set(record.id || record.key, structuredClone(record)); },
      async get(key) { return structuredClone(rows.get(key)); },
      async delete(key) { rows.delete(key); },
      where(field) { return { equals: value => ({ toArray: async () => [...rows.values()].filter(row => row[field] === value).map(row => structuredClone(row)) }) }; }
    };
  }
  h.app.db = { ...tables, async transaction(...args) {
    const snapshots = Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, structuredClone(table.rows)]));
    try { return await args.at(-1)(); }
    catch (error) { for (const [key, rows] of Object.entries(snapshots)) { tables[key].rows.clear(); for (const [id, row] of rows) tables[key].rows.set(id, row); } throw error; }
  } };
  h.app.splitView = { enabled: false, activePanel: 'primary', primary: { docId: h.first.id }, secondary: { docId: null } };
  return { ...h, tables };
}

test('a save snapshot waits for asynchronous edits started by blur', async () => {
  const h = fixture();
  let finish, settled = false;
  h.documentObject.activeElement = { blur() {
    h.documentObject.activeElement = null;
    h.app.trackDocumentEdit(h.first.id, new Promise(resolve => { finish = () => {
      h.first.sources['source-a'].buffer = new Uint8Array([9, 8, 7]).buffer;
      resolve();
    }; }));
  } };
  const pending = h.app.captureDocumentSnapshot(h.first.id).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  const snapshot = await pending;
  assert.deepEqual([...new Uint8Array(snapshot.payload.sources[0].buffer)], [9, 8, 7]);
  assert.equal(h.app._pendingDocumentEdits.size, 0);
});

test('session writes keep binary buffers separate and skip unchanged PDF writes', async () => {
  const h = fixture();
  await h.app.setDocumentBaseline(h.first.id);
  const baseline = h.first.documentState.baselineSnapshot;
  assert.equal(h.app.ensureDocumentState(h.first).baselineSnapshot, baseline);
  assert.equal(await h.app.saveSession(), true);
  const count = h.tables.sources.writes;
  assert.equal(count, 3);
  const record = await h.app.db.documents.get(h.first.id);
  assert.equal(record.documentState.baselineSnapshot.payload.sources[0].buffer, null);
  assert.equal([...h.tables.sources.rows.values()].every(row => row.buffer instanceof ArrayBuffer), true);
  h.first.pages[0].rotation = 180;
  assert.equal(await h.app.saveSessionLight(), true);
  assert.equal(h.tables.sources.writes, count);
  assert.equal((await h.app.db.documents.get(h.first.id)).pages[0].rotation, 180);
});

test('failed session writes roll back metadata, bytes and the manifest together', async () => {
  const h = fixture();
  assert.equal(await h.app.saveSession(), true);
  const before = structuredClone(h.tables.documents.rows);
  h.first.name = 'modified';
  h.first.sources['source-a'].buffer = new Uint8Array([5]).buffer;
  const put = h.tables.sources.put;
  h.tables.sources.put = async () => { throw new Error('quota'); };
  assert.equal(await h.app.saveSession(), false);
  assert.deepEqual(h.tables.documents.rows, before);
  h.tables.sources.put = put;
  assert.equal(await h.app.saveSession(), true);
  assert.equal((await h.tables.documents.get(h.first.id)).name, 'modified');
});

test('restoring hydrates only the active PDF, then hydrates another tab on demand', async () => {
  const h = fixture();
  await h.app.saveSession();
  h.app.docs = [];
  h.app.switchTab = () => {};
  assert.equal(await h.app.restoreSession(), true);
  assert.equal(h.app.docs.length, 2);
  const [first, second] = h.app.docs;
  assert.equal(first._sessionSourcesPending, undefined);
  assert.equal(second._sessionSourcesPending, true);
  assert.deepEqual(Object.keys(second.sources), []);
  await h.app.hydrateSessionDocument(second);
  assert.deepEqual([...new Uint8Array(second.sources['source-b'].buffer)], [1, 2, 3, 5]);
});

test('an absent session never opens the newest cached document', async () => {
  const h = fixture();
  await h.app.saveSession();
  await h.app.db.appState.delete('session');
  const cached = [...h.tables.documents.rows.values()].at(-1);
  h.app.db.documents.orderBy = () => ({ reverse: () => ({ limit: () => ({ toArray: async () => [cached] }) }) });
  h.app.docs = [];
  h.app.switchTab = () => {};
  assert.equal(await h.app.restoreSession(), false);
  assert.equal(h.app.docs.length, 0);
  assert.equal(h.tables.documents.rows.size, 2);
});

test('legacy panel references cannot reopen documents when there was no active tab', async () => {
  const h = fixture();
  await h.app.saveSession();
  await h.app.db.appState.put({ key: 'session', activeDocId: null,
    splitView: { mode: 'single', primary: { docId: h.first.id }, secondary: { docId: h.second.id } } });
  h.app.docs = [];
  h.app.switchTab = () => {};
  assert.equal(await h.app.restoreSession(), false);
  assert.equal(h.app.docs.length, 0);
});

test('a saved empty session preserves cached records without opening them', async () => {
  const h = fixture();
  await h.app.saveSession();
  h.app.docs = [];
  assert.equal(await h.app.saveSession(), true);
  h.app.switchTab = () => {};
  assert.equal(await h.app.restoreSession(), false);
  assert.equal(h.app.docs.length, 0);
  assert.equal(h.tables.documents.rows.size, 2);
});

test('a legacy session restores its active document without a stale hidden panel', async () => {
  const h = fixture();
  await h.app.saveSession();
  await h.app.db.appState.put({ key: 'session', activeDocId: h.first.id,
    splitView: { mode: 'single', primary: { docId: h.first.id }, secondary: { docId: h.second.id } } });
  h.app.docs = [];
  h.app.switchTab = () => {};
  assert.equal(await h.app.restoreSession(), true);
  assert.deepEqual(h.app.docs.map(doc => doc.id), [h.first.id]);
});

test('a missing legacy active document cannot revive stale split panels', async () => {
  const h = fixture();
  await h.app.saveSession();
  await h.app.db.appState.put({ key: 'session', activeDocId: 'removed',
    splitView: { mode: 'vertical', primary: { docId: h.first.id }, secondary: { docId: h.second.id } } });
  h.app.docs = [];
  h.app.switchTab = () => {};
  assert.equal(await h.app.restoreSession(), false);
  assert.equal(h.app.docs.length, 0);
});

test('a legacy visible split session still restores both explicitly open documents', async () => {
  const h = fixture();
  await h.app.saveSession();
  await h.app.db.appState.put({ key: 'session', activeDocId: h.first.id,
    splitView: { mode: 'vertical', primary: { docId: h.first.id }, secondary: { docId: h.second.id } } });
  h.app.docs = [];
  h.app.switchTab = () => {};
  assert.equal(await h.app.restoreSession(), true);
  assert.deepEqual(h.app.docs.map(doc => doc.id), [h.first.id, h.second.id]);
});

test('startup opens empty despite a saved PDF session and preserves transfer startup', async () => {
  for (const search of ['', '?openfile=explicit.pdf', '?detach=fixture', '?transferToken=fixture', '?token=fixture']) {
    const h = fixture(), db = h.app.db;
    await h.app.saveSession();
    db.version = () => ({ stores() {} });
    db.open = async () => {};
    db.appState.where = () => ({ between: () => ({ delete: async () => {} }) });
    h.context.Dexie = function () { return db; };
    h.context.location = { search };
    h.context.URLSearchParams = URLSearchParams;
    h.documentObject.body = { classList: { add() {} } };
    for (const method of ['migrateOldFavoritesAndRecents', 'clearOldRecents', 'loadSystemFonts', 'startAutoSave', 'renderHomeDocuments', 'updateWindowTitle']) h.app[method] = () => {};
    let restores = 0;
    h.app.restoreSession = async () => { restores++; return false; };
    h.app.createNewTab = () => { h.app.docs.push({ id: 'new', pages: [], sources: {} }); };
    h.app.docs = [];
    await h.app.initDatabaseAndApp();
    assert.equal(restores, 0, 'Startup must never restore documents');
    assert.equal(h.app.docs.length, search.includes('file') || !search ? 1 : 0, search);
    assert.equal(h.app.docs.some(doc => doc.pages.length), false, search);
    assert.equal(h.tables.documents.rows.size, 2, 'cached data remains available');
  }
});

test('legacy encrypted-base64 source rows still restore without rewriting their bytes', async () => {
  const h = fixture();
  await h.app.db.sources.put({ id: 'legacy', docId: h.first.id, sourceId: 'source-a', buffer: new TextEncoder().encode('AQIDBA==').buffer });
  h.first._sessionSourcesPending = true;
  await h.app.hydrateSessionDocument(h.first);
  assert.deepEqual([...new Uint8Array(h.first.sources['source-a'].buffer)], [1, 2, 3, 4]);
});

test('reapplying preferences binds session listeners only once', () => {
  const h = fixture(), listeners = [];
  h.windowObject.addEventListener = name => listeners.push(name);
  h.documentObject.addEventListener = name => listeners.push(name);
  h.app.startAutoSave(); h.app.startAutoSave(); h.app.startAutoSave();
  assert.deepEqual(listeners, ['beforeunload', 'visibilitychange']);
});

test('closed tabs spill bytes to storage and cleanup removes only their cache', async () => {
  const h = fixture(), item = { buffer: h.first.sources['source-a'].buffer };
  await h.app.db.appState.put({ key: 'unrelated', value: 1 });
  await h.app.persistClosedTab(item);
  assert.equal(item.buffer, null);
  assert.ok((await h.app.db.appState.get(item.storageKey)).buffer.byteLength);
  await h.app.releaseClosedTab(item);
  assert.equal(await h.app.db.appState.get(item.storageKey), undefined);
  assert.equal((await h.app.db.appState.get('unrelated')).value, 1);
});

test('thumbnail cache evicts and closes bitmaps at 16 MiB, including late closed-page results', () => {
  const h = fixture(), bitmaps = [];
  h.first.pages = Array.from({ length: 12 }, () => ({}));
  for (const page of h.first.pages) {
    const bitmap = { width: 1024, height: 1024, closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap); h.app.cacheThumbnail(page, bitmap, [], h.first);
  }
  assert.equal(h.app._thumbnailBytes, 16 * 1024 * 1024);
  assert.equal(bitmaps.filter(bitmap => bitmap.closed).length, 8);
  h.app.releaseDocumentThumbnails(h.first);
  assert.equal(h.app._thumbnailBytes, 0);
  assert.equal(h.app._thumbnailCache.size, 0);
  const bitmap = { width: 20, height: 20, close() { this.closed = true; } };
  h.app.docs = [];
  h.app.cacheThumbnail(h.first.pages[0], bitmap, [], h.first);
  assert.equal(bitmap.closed, true);
});

test('history includes binary snapshots in its budget and keeps indices aligned', () => {
  const h = fixture();
  h.first.history = ['0', '1', '2', '3']; h.first.historyIndex = 3;
  h.first._historyBuffers = { 1: { beforeBuffer: new ArrayBuffer(24 * 1024 * 1024) },
    2: { beforeBuffer: new ArrayBuffer(24 * 1024 * 1024) }, 3: { beforeBuffer: new ArrayBuffer(24 * 1024 * 1024) } };
  const latest = h.first._historyBuffers[3];
  h.app.trimDocumentHistory(h.first);
  assert.deepEqual(h.first.history, ['2', '3']);
  assert.equal(h.first.historyIndex, 1);
  assert.equal(h.first._historyBuffers[1], latest);
});

test('simultaneous renderer loads share one PDF task and failed loads can retry', async () => {
  let finish, starts = 0;
  const api = { getDocument() { starts++; return { promise: new Promise(resolve => { finish = resolve; }) }; } };
  const h = loadAppModules(['js/app.render.js'], { pdfjsLib: api });
  const source = { buffer: new ArrayBuffer(4) };
  const first = h.app.loadSourcePdf(source), second = h.app.loadSourcePdf(source);
  assert.equal(first, second);
  assert.equal(starts, 1);
  const pdf = { destroy() {} };
  finish(pdf);
  assert.equal(await first, pdf);
  assert.equal(await h.app.loadSourcePdf(source), pdf);
  assert.equal(starts, 1);
  h.app.releasePdfSource(source);
  api.getDocument = () => ({ promise: Promise.reject(new Error('invalid')) });
  await assert.rejects(h.app.loadSourcePdf(source), /invalid/);
  assert.equal(source._pdfLoadingPromise, undefined);
  api.getDocument = () => ({ promise: Promise.resolve(pdf) });
  assert.equal(await h.app.loadSourcePdf(source), pdf);
});

test('a PDF that finishes loading after its source changed is destroyed', async () => {
  let finish, destroyed = 0;
  const h = loadAppModules(['js/app.render.js'], { pdfjsLib: { getDocument: () => ({ promise: new Promise(resolve => { finish = resolve; }) }) } });
  const source = { buffer: new ArrayBuffer(4) }, pending = h.app.loadSourcePdf(source);
  source.buffer = null;
  finish({ destroy() { destroyed++; } });
  await assert.rejects(pending, /PDF_SOURCE_CHANGED/);
  assert.equal(destroyed, 1);
  assert.equal(source.doc, undefined);
});
