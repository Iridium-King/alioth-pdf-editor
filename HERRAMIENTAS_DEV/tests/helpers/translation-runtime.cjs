const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { loadAppModules } = require('./document-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const { app, first, windowObject, documentObject, context: appContext } = loadAppModules(['js/app.agentic.js', 'js/app.pdf.js'], {
  setTimeout(callback, delay) { const timer = setTimeout(callback, delay); if (delay >= 30000) timer.unref(); return timer; }, clearTimeout
});
documentObject.getElementById = id => id === 'loader-msg' ? {} : null;
const context = { window: windowObject, ArrayBuffer, Uint8Array, Map, Set, console, performance,
  btoa: value => Buffer.from(value, 'binary').toString('base64') };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/python_manager.js'), 'utf8'), context);
const manager = windowObject.PythonManager;
appContext.PythonManager = manager;
appContext.alert = message => { throw new Error(message); };
manager.isLoaded = true;
const invoked = [];
const timings = [];
const extractedPages = [];
let wasmReady;
manager.run = async (code, globals) => {
  const phase = globals.js_translation_operation || (code.includes('def extract_translatable_text') ? 'extract' : globals.js_check_only ? 'preflight' : 'reconstruct');
  invoked.push(phase);
  const start = performance.now();
  if (input.wasm) {
    wasmReady ||= (async () => {
      const { loadPyodide } = require(path.join(root, 'libs/python_engine/pyodide.js'));
      manager.pyodide = await loadPyodide({ indexURL: path.join(root, 'libs/python_engine/') });
      await manager.pyodide.loadPackage([
        path.join(root, 'libs/python_engine/pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl').replaceAll('\\', '/'),
        path.join(root, 'libs/python_engine/pillow-11.3.0-cp313-cp313-pyodide_2025_0_wasm32.whl').replaceAll('\\', '/')
      ]);
    })();
    await wasmReady;
    for (const [key, value] of Object.entries(globals)) manager.pyodide.globals.set(key, value);
    const proxy = await manager.pyodide.runPythonAsync(code);
    const result = proxy?.toJs ? proxy.toJs() : proxy;
    proxy?.destroy?.();
    timings.push({ phase, milliseconds: Math.round(performance.now() - start) });
    if (phase === 'extract') extractedPages.push([...new Set(JSON.parse(result).map(span => span.pageIndex))]);
    return result;
  }
  const serialized = Object.fromEntries(Object.entries(globals).map(([key, value]) => [key, value instanceof Uint8Array ? { base64: Buffer.from(value).toString('base64') } : value]));
  const result = spawnSync(path.join(root, '_python/python.exe'), [path.join(root, 'tests/test_translation_runtime.py'), '--bridge'], {
    input: JSON.stringify({ code, globals: serialized }), encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
  const value = JSON.parse(result.stdout);
  timings.push({ phase, milliseconds: Math.round(performance.now() - start) });
  if (phase === 'extract') extractedPages.push([...new Set(JSON.parse(value.value).map(span => span.pageIndex))]);
  return value.base64 ? new Uint8Array(Buffer.from(value.base64, 'base64')) : value.value;
};
app._systemFontBytes = Object.fromEntries(Object.entries(input.fonts || {}).map(([key, value]) => [key, new Uint8Array(Buffer.from(value, 'base64'))]));
app.fontRegistry = { fonts: input.registry || {}, loadedFonts: {} };
if (input.nativeServerUrl) windowObject.location = { protocol: 'http:' };
context.fetch = async (relativePath, options) => {
  if (relativePath === '/api/pdf/translation/v2' && input.nativeServerUrl) {
    const server = new URL(input.nativeServerUrl);
    if (server.hostname !== '127.0.0.1') throw new Error('Expected local test server');
    const phase = JSON.parse(options.body).operation;
    invoked.push(`native:${phase}`);
    const start = performance.now();
    const response = await fetch(new URL(relativePath, server), { ...options, headers: { ...options.headers, Origin: server.origin } });
    timings.push({ phase: `native:${phase}`, milliseconds: Math.round(performance.now() - start) });
    return response;
  }
  if (relativePath !== 'js/pdf_translation.py') invoked.push('font-fetch');
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { ok: true, text: async () => bytes.toString('utf8'), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
if (input.unloadedEngine) {
  windowObject.PythonManager = undefined;
  windowObject.AppLazy = { async loadScript(url) {
    if (!url.startsWith('js/python_manager.js?translation-recovery=')) throw new Error('Unexpected script');
    invoked.push('load-engine');
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/python_manager.js'), 'utf8'), context);
    windowObject.PythonManager.run = manager.run;
    appContext.PythonManager = windowObject.PythonManager;
  } };
}
const buffer = Buffer.from(input.pdf, 'base64');
first.sources = { 'source-a': { buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) } };
first.pages = Array.from({ length: input.pages || 1 }, (_, pageIndex) => ({ id: `page-${pageIndex}`, sourceId: 'source-a', pageIndex, rotation: 0, objects: [], nativeFormValues: {} }));
app.geminiApiKey = 'test-key-not-sent';
app.toggleLoader = () => {};
app.showToast = () => {};
(async () => {
  let providerCalls = 0;
  let review = await app.prepareTextTranslationReview({ docId: first.id, scope: { pages: input.scopePages || first.pages.map((_, index) => index) }, targetLanguage: 'Inglés',
    request: async ({ units }) => {
      providerCalls += 1;
      return JSON.stringify(units.map(unit => ({ unitId: unit.unitId, translatedText: input.translations[unit.text.replace(/\s+/g, ' ')] || unit.text })));
    } });
  if (review.status !== 'review') throw new Error(JSON.stringify(review));
  const initialItems = review.items.map(item => ({ ...item }));
  if (input.fitOverflow) {
    review = await app.fitTextTranslationReview(review.reviewId);
    if (review.status !== 'review') throw new Error(JSON.stringify(review));
  }
  const selected = review.items.filter(item => item.status === 'READY'
    && (!Array.isArray(input.selectedTexts) || input.selectedTexts.includes(item.originalText))).map(item => item.unitId);
  let output = null;
  if (selected.length && !input.reviewOnly) {
    const result = await app.applyTextTranslationReview(review.reviewId, selected);
    if (result.status !== 'review') throw new Error(JSON.stringify(result));
    const draft = await app.getDocumentActionDraft(result.draftId);
    // Exercise the real save compiler after the real translation action.
    const prepared = await app.prepareDocumentPdf(draft.snapshot, { purpose: 'save', protection: 'preserve' });
    output = Buffer.from(prepared.bytes).toString('base64');
  }
  process.stdout.write(JSON.stringify({ items: review.items, output, invoked, timings, extractedPages, initialItems, providerCalls }));
})().catch(error => { process.stderr.write(error.stack); process.exitCode = 1; });
