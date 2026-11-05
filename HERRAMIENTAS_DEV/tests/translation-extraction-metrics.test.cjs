const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadAppModules } = require('./helpers/document-harness.cjs');

const context = { jobId: 'translation-job_measurement123', sourceIndex: 0 };
function fixture(extraModules = []) {
  let clock = 0;
  const records = [], consoleRecords = [];
  const h = loadAppModules(['js/app.agentic.js', ...extraModules], {
    AbortController, AbortSignal, TextEncoder, performance: { now: () => clock += 7 },
    console: { info: (...args) => consoleRecords.push(args), log() {}, warn() {}, error() {} }
  });
  h.windowObject.location = { protocol: 'http:' };
  h.context.fetch = async (url, options) => {
    assert.equal(url, '/api/translation/metrics');
    records.push(JSON.parse(options.body));
    return { ok: true };
  };
  return Object.assign(h, { records, consoleRecords });
}

test('measurements preserve results, correlate stages and omit arbitrary document fields', async () => {
  const h = fixture(), expected = { text: 'Private document words' };
  const result = await h.app.measureTranslationExtraction(context, 'example_stage', () => expected,
    { pageIndex: 4, text: expected.text });
  assert.equal(result, expected);
  assert.deepEqual(h.records.map(x => x.event), ['extraction_stage_started', 'extraction_stage_completed']);
  assert.equal(h.records[1].durationMs, 7);
  assert.equal(h.records[1].pageIndex, 4);
  assert.equal(h.records[1].jobId, context.jobId);
  assert.equal(h.records[1].sourceIndex, 0);
  assert.equal(h.records[1].status, 'ok');
  assert.equal(JSON.stringify(h.records).includes('Private'), false);
  assert.equal(JSON.stringify(h.consoleRecords).includes('Private'), false);
});

test('disabled diagnostics run the operation without emitting records', async () => {
  const h = fixture();
  h.app._translationExtractionDebug = false;
  assert.equal(await h.app.measureTranslationExtraction(context, 'example_stage', () => 42), 42);
  assert.equal(h.records.length, 0);
  assert.equal(h.consoleRecords.length, 0);
});

test('logging failures preserve extraction success and the original error', async () => {
  const h = fixture(), failure = new TypeError('Private document error');
  h.context.fetch = async () => { throw new Error('Logger offline'); };
  h.context.console.info = () => { throw new Error('Console unavailable'); };
  assert.equal(await h.app.measureTranslationExtraction(context, 'example_stage', () => 42), 42);
  await assert.rejects(h.app.measureTranslationExtraction(context, 'example_stage', () => { throw failure; }),
    error => error === failure);
});

test('failed stages log error types without recording error messages', async () => {
  const h = fixture();
  await assert.rejects(h.app.measureTranslationExtraction(context, 'example_stage', () => {
    throw new TypeError('Private document error');
  }), TypeError);
  assert.equal(h.records[1].status, 'failed');
  assert.equal(h.records[1].errorType, 'TypeError');
  assert.equal(JSON.stringify(h.records).includes('Private'), false);
});

function browserOcr(h) {
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  h.documentObject.createElement = () => canvas;
  h.context.Tesseract = { createWorker: async () => ({ terminate: async () => {},
    recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines: [
      { text: 'Private image words', bbox: { x0: 20, y0: 10, x1: 120, y1: 40 } }
    ] }] }] } }) }) };
  h.context.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({
    getPage: async () => ({ getViewport: x => x, render: () => ({ promise: Promise.resolve() }) }),
    destroy: async () => {}
  }) }) };
  return [{ needsOcr: true, pageIndex: 2, imageIndex: 3,
    rect: { x: 30, y: 100, width: 200, height: 100 }, pageWidth: 600, pageHeight: 800 }];
}

test('browser OCR keeps identical text and geometry while reporting page, image and pixels', async () => {
  const baseline = fixture(), measured = fixture();
  const original = await baseline.app.extractTranslationNoteImages(new ArrayBuffer(1), browserOcr(baseline));
  const result = await measured.app.extractTranslationNoteImages(new ArrayBuffer(1), browserOcr(measured), context);
  assert.equal(JSON.stringify(result), JSON.stringify(original));
  const stages = measured.records.filter(x => x.event === 'extraction_stage_completed');
  for (const name of ['browser_ocr_init', 'browser_pdf_open', 'browser_page_load', 'browser_region_render',
    'browser_region_ocr', 'browser_region_filter', 'browser_ocr_cleanup', 'browser_pdf_cleanup']) {
    assert.ok(stages.some(x => x.stage === name), name);
  }
  const ocr = stages.find(x => x.stage === 'browser_region_ocr');
  assert.equal(ocr.pageIndex, 2);
  assert.equal(ocr.imageIndex, 3);
  assert.equal(ocr.pixelCount, 80000);
  assert.equal(stages.find(x => x.stage === 'browser_region_filter').unitCount, 1);
  assert.equal(JSON.stringify(measured.records).includes('Private'), false);
});

function manager(h) {
  h.context.btoa = value => Buffer.from(value, 'binary').toString('base64');
  vm.runInNewContext(fs.readFileSync('js/python_manager.js', 'utf8'), h.context);
  return h.windowObject.PythonManager;
}

test('native extraction forwards diagnostics separately from PDF bytes and preserves returned spans', async () => {
  const h = fixture(), m = manager(h), metrics = h.context.fetch;
  const spans = [{ text: 'Private native words', pageIndex: 0 }];
  h.context.fetch = async (url, options) => {
    if (url === '/api/translation/metrics') return metrics(url, options);
    assert.equal(url, '/api/pdf/translation/v2');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.diagnostics, context);
    assert.equal(body.pdfBase64, 'AQID');
    return { ok: true, json: async () => ({ ok: true, result: spans }) };
  };
  const result = await m.extractTranslatableText(new Uint8Array([1, 2, 3]).buffer,
    { forNotes: true, pageIndices: [0], diagnostics: context });
  assert.deepEqual(result, spans);
  assert.ok(h.records.some(x => x.stage === 'native_transport' && x.status === 'ok'));
  assert.ok(h.records.some(x => x.stage === 'extracted_regions' && x.ocrRegionCount === 0));
  assert.equal(JSON.stringify(h.records).includes('Private'), false);
});

test('native unavailability reports WASM initialization and converts kernel callback dictionaries', async () => {
  const h = fixture(), m = manager(h), metrics = h.context.fetch;
  const spans = [{ text: 'Private fallback words', pageIndex: 0 }];
  h.context.fetch = async (url, options) => {
    if (url === '/api/translation/metrics') return metrics(url, options);
    if (url === '/api/pdf/translation/v2') return { ok: false, status: 503 };
    assert.equal(url, 'js/pdf_translation.py');
    return { ok: true, text: async () => '# local kernel' };
  };
  let initialized = 0;
  m.init = async () => { initialized++; m.isLoaded = true; };
  m.run = async (code, globals) => {
    assert.match(code, /extract_translation_notes\(js_pdf_data, js_pages, js_translation_diagnostic\)/);
    globals.js_translation_diagnostic({ toJs: () => new Map([
      ['event', 'extraction_stage_completed'], ['stage', 'native_page_text'], ['pageIndex', 0], ['durationMs', 3],
      ['text', 'Private kernel words']
    ]) });
    return JSON.stringify(spans);
  };
  const result = await m.extractTranslatableText(new ArrayBuffer(1), { forNotes: true, diagnostics: context });
  assert.deepEqual(result, spans);
  assert.equal(initialized, 1);
  assert.ok(h.records.some(x => x.stage === 'native_response' && x.httpStatus === 503));
  assert.ok(h.records.some(x => x.stage === 'wasm_init'));
  assert.ok(h.records.some(x => x.stage === 'wasm_extract'));
  assert.ok(h.records.some(x => x.stage === 'native_page_text' && x.engine === 'wasm' && x.sourceIndex === 0));
  assert.equal(JSON.stringify(h.records).includes('Private'), false);
});

test('the note-copy workflow uses its job ID through snapshot, sources, grouping and hashing', async () => {
  const h = fixture(['js/app.pdf.js']), metrics = h.context.fetch, nodes = new Map();
  h.documentObject.getElementById = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, hidden: false, disabled: false, textContent: '',
      querySelector() { return null; }, replaceChildren() {} });
    return nodes.get(id);
  };
  h.first.pages = [Object.assign(h.first.pages[0], { objects: [], nativeFormValues: {}, _pdfW: 600, _pdfH: 800 })];
  h.documentObject.getElementById('translation-review-scope').value = 'document';
  h.documentObject.getElementById('translation-review-language').value = 'Español';
  let extractionContext;
  h.windowObject.PythonManager.extractTranslatableText = async (_, options) => {
    extractionContext = options.diagnostics;
    return [{ pageIndex: 0, text: 'Private paragraph', fontName: 'Helvetica', fontSize: 12,
      origin: [40, 52], rect: { x: 40, y: 40, width: 200, height: 16 }, pageWidth: 600, pageHeight: 800 }];
  };
  h.context.fetch = async (url, options) => {
    if (url === '/api/translation/metrics') return metrics(url, options);
    assert.equal(url, '/api/ai/generate-json');
    const prompt = JSON.parse(options.body).prompt;
    const units = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
    return { ok: true, status: 200, json: async () => ({ ok: true,
      text: JSON.stringify(units.map(x => ({ unitId: x.unitId, translatedText: 'Párrafo traducido' }))) }) };
  };
  h.app.closeAllModals = () => {};
  h.app.switchTab = async id => { h.app.activeDocId = id; };
  h.app.showToast = () => {};
  await h.app.createTranslationNotesCopyFromModal();
  assert.equal(h.app.docs.length, 3, nodes.get('translation-review-status').textContent);
  const job = h.records.find(x => x.event === 'job_started').jobId;
  assert.equal(extractionContext.jobId, job);
  assert.equal(extractionContext.sourceIndex, 0);
  const stages = h.records.filter(x => x.event === 'extraction_stage_completed');
  for (const stage of ['document_snapshot', 'editable_extract', 'source_extract', 'extraction_deduplicate',
    'note_grouping', 'checkpoint_hash']) assert.ok(stages.some(x => x.stage === stage), stage);
  assert.ok(stages.every(x => x.jobId === job));
  assert.equal(JSON.stringify(stages).includes('Private'), false);
});
