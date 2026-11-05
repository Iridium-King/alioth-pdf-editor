const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');

function createFixtureDocument(id, sourceId, value) {
  return {
    id,
    name: `${id}.pdf`,
    currentIndex: 0,
    scale: 1,
    indexEntries: [{ id: `${id}-index`, title: 'Índice' }],
    metadata: { title: id },
    pages: [{
      id: `${id}-page-1`,
      sourceId,
      pageIndex: 0,
      rotation: 0,
      nativeFormValues: {
        nombre: { kind: 'text', value },
        acepta: { kind: 'checkbox', value: true },
        opcion: { kind: 'radio', value: 'B' },
        lista: { kind: 'choice', value: '2' }
      },
      objects: [{ id: `${id}-widget`, fromFormField: true, nativeFieldName: 'nombre' }],
      deletedObjectIds: [`${id}-removed-widget`]
    }, {
      id: `${id}-page-2`,
      sourceId,
      pageIndex: 1,
      rotation: 90,
      nativeFormValues: {},
      objects: [],
      deletedObjectIds: []
    }],
    sources: {
      [sourceId]: { buffer: new Uint8Array([1, 2, 3, id.length]).buffer, doc: { transient: true } }
    },
    history: [],
    historyIndex: -1
  };
}

function loadAppModules(extraModules = [], runtime = {}) {
  const timers = new Map();
  let nextTimer = 1;
  const windowObject = {
    app: {},
    addEventListener() {},
    PythonManager: {
      async reconstructTranslatedOccurrences(pdfBuffer, { occurrences }) {
        return {
          bytes: pdfBuffer.slice(0),
          manifest: { treated: occurrences.map(({ id, pageIndex }) => ({ id, pageIndex })), rejected: [] }
        };
      }
    }
  };
  const documentObject = { addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, activeElement: null };
  const context = {
    window: windowObject,
    document: documentObject,
    console,
    ArrayBuffer,
    Uint8Array,
    ArrayBufferView: Object,
    JSON,
    Math,
    Date,
    Map,
    Set,
    Promise,
    Object,
    performance: { now: () => 0 },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...runtime
  };
  context.globalThis = context;
  const run = relativePath => vm.runInNewContext(`(function () {\n${fs.readFileSync(path.join(root, relativePath), 'utf8')}\n})();`, context, { filename: relativePath });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'libs/pdf-lib.min.js'), 'utf8'), context, { filename: 'libs/pdf-lib.min.js' });
  run('js/app.tools.js');
  if (fs.existsSync(path.join(root, 'js/app.document_state.js'))) run('js/app.document_state.js');
  extraModules.forEach(run);
  const app = windowObject.app;
  const first = createFixtureDocument('doc-a', 'source-a', 'CAMBIO');
  const second = createFixtureDocument('doc-b', 'source-b', 'OTRO');
  app.docs = [first, second];
  app.activeDocId = first.id;
  app.getDoc = () => app.docs.find(doc => doc.id === app.activeDocId) || null;
  app.renderSidebar = () => {};
  app.updateUndoRedoUI = () => {};
  app.multiSelection = new Set();
  app.multiObjectSelection = new Set();
  return { app, first, second, timers, documentObject, windowObject, context };
}

async function flushTimers(timers) {
  while (timers.size) {
    const pending = [...timers.values()];
    timers.clear();
    for (const callback of pending) await callback();
  }
}

module.exports = { createFixtureDocument, loadAppModules, flushTimers };
