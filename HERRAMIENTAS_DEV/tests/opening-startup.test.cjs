const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppModules } = require('./helpers/document-harness.cjs');

const splashScript = fs.readFileSync(path.resolve(__dirname, '../../BASE.html'), 'utf8')
  .match(/<script id="alioth-startup-session">([\s\S]*?)<\/script>/)[1];

function visitSplash(session, saved = new Map(), search = '', tab = new Map()) {
  const storage = values => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  const window = { __aliothLogonSession: session };
  const classes = new Set();
  vm.runInNewContext(splashScript, {
    window, URLSearchParams, location: { search },
    localStorage: storage(saved), sessionStorage: storage(tab),
    document: { documentElement: { classList: { add: value => classes.add(value) } } }
  });
  return { skipped: window.__aliothSkipSplash, hidden: classes.has('skip-splash') };
}

test('splash appears once across new windows and process restarts in one Windows logon', () => {
  const saved = new Map();
  assert.deepEqual(visitSplash('logon-1', saved), { skipped: false, hidden: false });
  assert.deepEqual(visitSplash('logon-1', saved), { skipped: true, hidden: true });
  assert.deepEqual(visitSplash('logon-1', saved, '?openfile=otro.pdf'), { skipped: true, hidden: true });
});

test('a new Windows logon allows the splash again', () => {
  const saved = new Map();
  visitSplash('logon-1', saved);
  assert.equal(visitSplash('logon-2', saved).skipped, false);
  assert.equal(visitSplash('logon-2', saved).skipped, true);
});

test('detached and transferred windows skip the splash without consuming the first normal opening', () => {
  for (const query of ['?detach=1', '?transferToken=1', '?token=1']) {
    const saved = new Map();
    assert.equal(visitSplash('logon-1', saved, query).skipped, true);
    assert.equal(saved.size, 0);
    assert.equal(visitSplash('logon-1', saved).skipped, false);
  }
});

test('browser fallback remembers the splash within the browser tab session', () => {
  const tab = new Map();
  assert.equal(visitSplash(null, new Map(), '', tab).skipped, false);
  assert.equal(visitSplash(null, new Map(), '', tab).skipped, true);
});

test('unavailable storage does not interrupt startup or detached windows', () => {
  for (const search of ['', '?detach=1']) {
    const window = {};
    vm.runInNewContext(splashScript, {
      window, URLSearchParams, location: { search },
      sessionStorage: { getItem() { throw new Error('Storage unavailable'); } },
      document: { documentElement: { classList: { add() {} } } }
    });
    assert.equal(window.__aliothSkipSplash, Boolean(search));
  }
});

function openingApp() {
  let finishDatabase;
  const databaseGate = new Promise(resolve => { finishDatabase = resolve; });
  class Dexie {
    constructor() { this.appState = { where: () => ({ between: () => ({ delete: async () => {} }) }) }; }
    version() { return { stores() {} }; }
    open() { return databaseGate; }
  }
  const { app, context, documentObject, windowObject } = loadAppModules(
    ['js/app.core.js', 'js/app.pdf.js'],
    {
      Dexie, URLSearchParams, location: { search: '' },
      localStorage: { getItem: () => 'tab' },
      pdfjsLib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }) }) }
    }
  );
  app.docs = [];
  app.activeDocId = null;
  let sequence = 0;
  app.createNewTab = name => {
    const doc = { id: 'doc-' + ++sequence, name, pages: [], sources: {} };
    app.docs.push(doc);
    app.activeDocId = doc.id;
    return doc.id;
  };
  for (const name of ['migrateOldFavoritesAndRecents', 'clearOldRecents', 'setDocumentBaseline', 'addToRecentDocs']) {
    app[name] = async () => {};
  }
  for (const name of ['renderTabs', 'toggleLoader', 'saveState', 'showToast', 'loadSystemFonts', 'startAutoSave', 'renderHomeDocuments', 'updateWindowTitle']) {
    app[name] = () => {};
  }
  app.switchTab = id => { app.activeDocId = id; };
  windowObject.removeEventListener = () => {};
  documentObject.body = { classList: { add() {} } };
  const bytes = Buffer.from('%PDF-1.7\n');
  const file = name => ({
    name, type: 'application/pdf',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  return { app, context, file, finishDatabase };
}

test('a PDF opened during database startup leaves exactly one populated tab', async () => {
  const { app, file, finishDatabase } = openingApp();
  const startup = app.initDatabaseAndApp();
  await app.openFile(file('primero.pdf'));
  finishDatabase();
  await startup;
  assert.equal(app.docs.length, 1);
  assert.equal(app.getDoc().name, 'primero.pdf');
  assert.equal(app.getDoc().pages.length, 1);
});

test('opening into the existing empty tab preserves its identity', async () => {
  const { app, file, finishDatabase } = openingApp();
  const id = app.createNewTab('Nuevo Doc');
  const startup = app.initDatabaseAndApp();
  await app.openFile(file('original.pdf'));
  finishDatabase();
  await startup;
  assert.equal(app.docs.length, 1);
  assert.equal(app.activeDocId, id);
  assert.equal(app.getDoc().pages.length, 1);
});

test('a later startup failure does not append an empty tab after opening a PDF', async () => {
  const { app, file, finishDatabase } = openingApp();
  app.migrateOldFavoritesAndRecents = async () => { throw new Error('Database unavailable'); };
  const startup = app.initDatabaseAndApp();
  await app.openFile(file('original.pdf'));
  finishDatabase();
  await startup;
  assert.equal(app.docs.length, 1);
  assert.equal(app.getDoc().name, 'original.pdf');
});

test('normal startup creates one empty tab and a second PDF keeps the first document', async () => {
  const { app, file, finishDatabase } = openingApp();
  finishDatabase();
  await app.initDatabaseAndApp();
  assert.equal(app.docs.length, 1);
  assert.equal(app.getDoc().pages.length, 0);
  await app.openFile(file('primero.pdf'));
  await app.openFile(file('segundo.pdf'));
  assert.deepEqual(app.docs.map(doc => doc.name), ['primero.pdf', 'segundo.pdf']);
  assert.equal(app.docs[0].pages.length, 1);
  assert.equal(app.docs[1].pages.length, 1);
});

test('smart opening waits for PDF loading and returns the Office conversion promise', async () => {
  const { app, context, file } = openingApp();
  context.app = app;
  context.window.location = { protocol: 'http:', origin: 'http://127.0.0.1:8765' };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/office_conversion.js'), 'utf8'), context);
  const id = app.createNewTab('Nuevo Doc');
  let finishRead;
  const pdf = file('original.pdf');
  const bytes = await pdf.arrayBuffer();
  pdf.arrayBuffer = () => new Promise(resolve => { finishRead = resolve; });
  const opening = app.smartOpenFile(pdf);
  assert.equal(typeof opening.then, 'function');
  assert.equal(app.getDoc().pages.length, 0);
  finishRead(bytes);
  await opening;
  assert.equal(app.docs.length, 1);
  assert.equal(app.activeDocId, id);
  assert.equal(app.getDoc().pages.length, 1);
  const conversion = Promise.resolve('converted');
  app.importOfficeFile = () => conversion;
  assert.equal(app.smartOpenFile({ name: 'documento.docx' }), conversion);
});
