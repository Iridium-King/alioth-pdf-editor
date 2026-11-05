const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function span(text, pageIndex = 0, x = 40, y = 40) {
  return { pageIndex, text, fontName: 'Helvetica', fontKey: 'helv', fontSize: 12,
    rect: { x, y, width: 200, height: 16 }, origin: [x, y + 12], pageWidth: 600, pageHeight: 10000 };
}

function textObject(text, extra = {}) {
  return { id: 'edited', type: 'text', text, x: 40, y: 200, width: 200, height: 16,
    fontSize: 12, fontName: 'Helvetica', ...extra };
}

function fixture(spans = []) {
  const h = loadAppModules(['js/app.agentic.js', 'js/app.pdf.js'], {
    AbortController, AbortSignal, TextEncoder, TextDecoder,
    console: { log() {}, info() {}, warn() {}, error() {} }
  });
  h.first.pages.forEach(page => Object.assign(page, {
    objects: [], nativeFormValues: {}, deletedObjectIds: [], rotation: 0, _pdfW: 600, _pdfH: 10000
  }));
  const nodes = new Map();
  h.node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, hidden: false, disabled: false,
      replaceChildren() {}, textContent: '', querySelector() { return null; } });
    return nodes.get(id);
  };
  h.documentObject.getElementById = h.node;
  h.node('translation-review-scope').value = 'document';
  h.node('translation-review-language').value = 'Español';
  Object.assign(h, { extractions: [], reconstructions: 0, sent: [], batches: [], active: 0, peak: 0, closed: 0 });
  h.windowObject.PythonManager.extractTranslatableText = async (_, { pageIndices, forNotes }) => {
    assert.equal(forNotes, true);
    h.extractions.push(Array.from(pageIndices));
    return spans.filter(item => pageIndices.includes(item.pageIndex));
  };
  h.windowObject.PythonManager.reconstructTranslatedOccurrences = async () => {
    h.reconstructions++;
    throw new Error('Unexpected reconstruction');
  };
  h.context.PythonManager = h.windowObject.PythonManager;
  h.context.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/generate-json');
    const prompt = JSON.parse(options.body).prompt;
    const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
    h.sent.push(...items.map(item => item.text));
    h.batches.push(items.length);
    h.peak = Math.max(h.peak, ++h.active);
    await new Promise(resolve => setImmediate(resolve));
    await h.beforeResponse?.();
    h.active--;
    return { ok: true, status: 200, json: async () => ({ ok: true,
      text: JSON.stringify(items.map(item => ({ unitId: item.unitId, translatedText: 'Traducción ' + item.text }))) }) };
  };
  h.app.geminiApiKey = 'mock-key';
  h.app.closeAllModals = () => {
    h.closed++;
    for (const id of ['modal-overlay', 'translation-review-modal', 'other-modal']) h.node(id).style.display = 'none';
  };
  h.app.switchTab = async id => { h.app.activeDocId = id; };
  h.app.toggleLoader = () => {};
  h.app.showToast = () => {};
  h.app.showTextTranslationModal();
  h.node('translation-review-scope').value = 'document';
  h.closed = 0;
  h.notes = () => h.app.docs.slice(2).flatMap(doc => doc.pages.flatMap(page => page.objects.filter(object => object.translationNote)));
  return h;
}

test('notes preserve the original, align both columns and bypass reconstruction', async () => {
  const h = fixture([span('Left paragraph', 0, 40, 50), span('Right paragraph', 0, 340, 70)]);
  const before = JSON.stringify(h.first.pages);
  const bytes = Buffer.from(h.first.sources['source-a'].buffer);
  await h.app.applyTextTranslationModal();
  assert.equal(h.app.docs.length, 3, h.node('translation-review-status').textContent);
  assert.equal(JSON.stringify(h.first.pages), before);
  assert.equal(h.reconstructions, 0);
  assert.deepEqual(h.notes().map(note => [note.translationSide, note.y, note.sourceText]),
    [['left', 50, 'Left paragraph'], ['right', 70, 'Right paragraph']]);
  assert.deepEqual(Buffer.from(h.app.docs[2].sources['source-a'].buffer), bytes);
  assert.equal(h.app.activeDocId, h.app.docs[2].id);
  assert.equal(h.closed, 1);
});

test('notes include native and editable text on the same page and other pages', async () => {
  const h = fixture([span('Native first page'), span('Native second page', 1)]);
  h.first.pages[0].objects.push(textObject('Edited first page'));
  await h.app.applyTextTranslationModal();
  assert.deepEqual(new Set(h.sent), new Set(['Native first page', 'Native second page', 'Edited first page']));
  assert.deepEqual(h.extractions, [[0, 1]]);
});

test('notes exclude comments, prior translations and form values from native fallback', async () => {
  const h = fixture([span('Native paragraph')]);
  h.first.pages[0].objects.push(
    textObject('Internal comment', { type: 'comment' }),
    textObject('Previous translation', { type: 'comment', translationNote: true }),
    textObject('Form value', { fromFormField: true })
  );
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.sent, ['Native paragraph']);
});

test('a page containing only comments produces no new translation copy', async () => {
  const h = fixture();
  h.first.pages[0].objects.push(textObject('Internal comment', { type: 'comment' }));
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.sent, []);
  assert.equal(h.app.docs.length, 2);
  assert.match(h.node('translation-review-status').textContent, /No se encontró texto/);
});

test('editable-only generated pages translate without loading the PDF extractor', async () => {
  const h = fixture();
  h.first.pages = [{ id: 'generated', objects: [textObject('Generated text')], _pdfW: 600, _pdfH: 10000 }];
  h.windowObject.PythonManager = undefined;
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.sent, ['Generated text']);
  assert.equal(h.extractions.length, 0);
  assert.equal(h.app.docs.length, 3);
});

test('page scope excludes native and editable text on other pages', async () => {
  const h = fixture([span('First page'), span('Second page', 1)]);
  h.node('translation-review-scope').value = 'page';
  h.first.pages[1].objects.push(textObject('Other page edit'));
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.sent, ['First page']);
  assert.deepEqual(h.extractions, [[0]]);
});

test('notes deduplicate matching native and editor text at the same position', async () => {
  const h = fixture([span('Same paragraph')]);
  h.first.pages[0].objects.push(textObject('Same paragraph', { y: 40 }));
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.sent, ['Same paragraph']);
  assert.equal(h.notes().length, 1);
});

test('1968 short blocks use 33 batches and at most two concurrent requests', async () => {
  const h = fixture(Array.from({ length: 1968 }, (_, i) => span('Paragraph ' + i, 0, 40, 40 + i * 80)));
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.batches, [...new Array(32).fill(60), 48]);
  assert.equal(h.peak, 2);
  assert.equal(h.notes().length, 1968);
});

function checkpoints(h, saved) {
  const provider = h.context.fetch;
  h.windowObject.location = { protocol: 'http:' };
  h.windowObject.crypto = webcrypto;
  h.metrics = [];
  h.context.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url === '/api/translation/metrics') {
      assert.match(body.jobId, /^translation-job_[a-z0-9_-]+$/);
      h.metrics.push(body);
      return { ok: true };
    }
    if (url === '/api/translation/checkpoint') {
      const key = body.key + ':' + body.batchIndex;
      assert.ok(body.expectedIds.length <= 64);
      if (body.operation === 'store') {
        saved.set(key, body.translations);
        h.afterCheckpoint?.();
      }
      return { ok: true, json: async () => ({ ok: true, translations: saved.get(key) || {} }) };
    }
    return provider(url, options);
  };
}

test('cancelled notes resume completed encrypted batches after reopening, with stable IDs', async () => {
  const spans = Array.from({ length: 130 }, (_, i) => span('Paragraph ' + i, 0, 40, 40 + i * 80));
  const saved = new Map();
  const first = fixture(spans);
  checkpoints(first, saved);
  first.afterCheckpoint = () => first.app.closeTextTranslationModal();
  await first.app.applyTextTranslationModal();
  assert.equal(first.app.docs.length, 2);
  assert.ok(saved.size > 0);
  const second = fixture(spans);
  checkpoints(second, saved);
  await second.app.applyTextTranslationModal();
  assert.equal(second.notes().length, 130);
  assert.ok(second.sent.length < 130);
  assert.ok(second.metrics.some(metric => metric.event === 'batch_restored'));
  const third = fixture(spans);
  checkpoints(third, saved);
  await third.app.applyTextTranslationModal();
  assert.equal(third.sent.length, 0);
  assert.equal(third.notes().length, 130);
  const changed = fixture(spans);
  changed.node('translation-review-language').value = 'Francés';
  checkpoints(changed, saved);
  await changed.app.applyTextTranslationModal();
  assert.equal(changed.sent.length, 130);
});

test('OCR lines in the same block are grouped while titles and other blocks stay separate', async () => {
  const h = fixture([
    { ...span('Title', 0, 40, 10), noteBlock: '0:0' },
    { ...span('First OCR line', 0, 40, 40), noteBlock: '0:1', isScan: true },
    { ...span('Second OCR line', 0, 40, 57), noteBlock: '0:1', isScan: true },
    { ...span('Next paragraph', 0, 40, 80), noteBlock: '0:2' }
  ]);
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.sent, ['Title', 'First OCR line Second OCR line', 'Next paragraph']);
});

test('notes finished in the background preserve the active tab and another modal', async () => {
  const h = fixture([span('Source paragraph')]);
  h.beforeResponse = () => {
    h.app.minimizeTextTranslationModal();
    h.app.activeDocId = h.second.id;
    h.node('modal-overlay').style.display = 'flex';
    h.node('other-modal').style.display = 'flex';
  };
  await h.app.applyTextTranslationModal();
  assert.equal(h.app.docs.length, 3);
  assert.equal(h.app.activeDocId, h.second.id);
  assert.equal(h.node('modal-overlay').style.display, 'flex');
  assert.equal(h.node('other-modal').style.display, 'flex');
  assert.equal(h.closed, 0);
  assert.equal(h.app._translationReviewDocId, null);
});

test('cancelling notes during the provider request publishes no copy', async () => {
  const h = fixture([span('Source paragraph')]);
  h.beforeResponse = () => h.app.closeTextTranslationModal();
  await h.app.applyTextTranslationModal();
  assert.equal(h.app.docs.length, 2);
});

test('browser OCR reads only the image crop and converts its geometry back to the page', async () => {
  const h = fixture();
  let terminated = 0, destroyed = 0, renderOptions;
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  h.documentObject.createElement = type => { assert.equal(type, 'canvas'); return canvas; };
  h.context.Tesseract = { createWorker: async (language, _, options) => {
    assert.equal(language, 'eng+spa');
    assert.equal(options.workerPath, 'libs/tesseract.worker.min.js');
    return { terminate: async () => terminated++, recognize: async input => {
      assert.equal(input, canvas);
      assert.equal(canvas.width, 400);
      assert.equal(canvas.height, 200);
      return { data: { blocks: [{ paragraphs: [{ lines: [{ text: 'Image words', bbox: { x0: 20, y0: 10, x1: 120, y1: 40 } }] }] }] } };
    } };
  } };
  h.context.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({
    getPage: async () => ({ getViewport: settings => settings,
      render: options => { renderOptions = options; return { promise: Promise.resolve() }; } }),
    destroy: async () => destroyed++
  }) }) };
  const native = span('Native text');
  const spans = await h.app.extractTranslationNoteImages(new ArrayBuffer(1), [native,
    { needsOcr: true, pageIndex: 0, imageIndex: 0, rect: { x: 30, y: 100, width: 200, height: 100 }, pageWidth: 600, pageHeight: 800 }]);
  assert.equal(spans[0], native);
  assert.equal(spans[1].text, 'Image words');
  assert.deepEqual({ ...spans[1].rect }, { x: 40, y: 105, width: 50, height: 15 });
  assert.equal(renderOptions.annotationMode, 0);
  assert.deepEqual(Array.from(renderOptions.transform), [1, 0, 0, 1, -60, -200]);
  assert.equal(terminated, 1);
  assert.equal(destroyed, 1);
  assert.equal(canvas.width, 0);
});

test('browser OCR keeps image text but ignores a table row already present as native cells', async () => {
  const h = fixture();
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  h.documentObject.createElement = () => canvas;
  h.context.Tesseract = { createWorker: async () => ({ terminate: async () => {},
    recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines: [
      { text: 'NUEVOS INGRESOS SEGUIMIENTO BAU HSEQ', bbox: { x0: 60, y0: 40, x1: 1150, y1: 80 } },
      { text: 'Texto solo en imagen', bbox: { x0: 60, y0: 150, x1: 500, y1: 190 } }
    ] }] }] } }) }) };
  h.context.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({
    getPage: async () => ({ getViewport: settings => settings, render: () => ({ promise: Promise.resolve() }) }),
    destroy: async () => {}
  }) }) };
  const native = [
    { ...span('NUEVOS INGRESOS', 0, 40, 20), rect: { x: 40, y: 20, width: 130, height: 16 } },
    { ...span('SEGUIMIENTO BAU', 0, 260, 20), rect: { x: 260, y: 20, width: 120, height: 16 } },
    { ...span('HSEQ', 0, 490, 20), rect: { x: 490, y: 20, width: 60, height: 16 } }
  ];
  const extracted = await h.app.extractTranslationNoteImages(new ArrayBuffer(1), [...native,
    { needsOcr: true, pageIndex: 0, imageIndex: 0, rect: { x: 0, y: 0, width: 600, height: 120 },
      pageWidth: 600, pageHeight: 800 }]);
  assert.deepEqual(extracted.map(unit => unit.text), [...native.map(unit => unit.text), 'Texto solo en imagen']);
});

test('browser OCR ignores unreadable text over native letters and low-confidence fragments', async () => {
  const h = fixture();
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  h.documentObject.createElement = () => canvas;
  h.context.Tesseract = { createWorker: async () => ({ terminate: async () => {},
    recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines: [
      { text: 'IVIGAIVY', bbox: { x0: 300, y0: 350, x1: 470, y1: 400 }, confidence: 90 },
      { text: 'garbled logo', bbox: { x0: 40, y0: 550, x1: 260, y1: 600 }, confidence: 25 },
      { text: 'Texto en imagen', bbox: { x0: 650, y0: 550, x1: 980, y1: 600 }, confidence: 90 }
    ] }] }] } }) }) };
  h.context.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({
    getPage: async () => ({ getViewport: settings => settings, render: () => ({ promise: Promise.resolve() }) }),
    destroy: async () => {}
  }) }) };
  const native = { ...span('México', 0, 151, 168), rect: { x: 151, y: 168, width: 90, height: 36 } };
  const extracted = await h.app.extractTranslationNoteImages(new ArrayBuffer(1), [native,
    { needsOcr: true, pageIndex: 0, imageIndex: 0, rect: { x: 0, y: 0, width: 600, height: 400 },
      pageWidth: 600, pageHeight: 800 }]);
  assert.deepEqual(extracted.map(unit => unit.text), ['México', 'Texto en imagen']);
});

test('browser OCR omits repeated margin artifacts but retains unique image text', async () => {
  const h = fixture();
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  h.documentObject.createElement = () => canvas;
  let calls = 0;
  h.context.Tesseract = { createWorker: async () => ({ terminate: async () => {},
    recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines: [
      { text: 'ZER ©)', bbox: { x0: 1000, y0: 80, x1: 1150, y1: 120 } },
      ...(calls++ === 0 ? [{ text: 'Texto único', bbox: { x0: 100, y0: 300, x1: 400, y1: 340 } }] : [])
    ] }] }] } }) }) };
  h.context.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({
    getPage: async () => ({ getViewport: settings => settings, render: () => ({ promise: Promise.resolve() }) }),
    destroy: async () => {}
  }) }) };
  const native = span('Título original');
  const images = [0, 1, 2].map(pageIndex => ({ needsOcr: true, pageIndex, imageIndex: 0,
    rect: { x: 0, y: 0, width: 600, height: 400 }, pageWidth: 600, pageHeight: 800 }));
  const extracted = await h.app.extractTranslationNoteImages(new ArrayBuffer(1), [native, ...images]);
  assert.deepEqual(extracted.map(unit => unit.text), ['Título original', 'Texto único']);
});

test('scan notes reject unchanged OCR and gibberish-shaped translations', async () => {
  const h = fixture([
    { ...span('IVIGAIVY', 0, 40, 40), isScan: true, noteBlock: 'ocr:0:0' },
    { ...span('México', 0, 40, 100), isScan: true, noteBlock: 'ocr:0:1' },
    span('Criterios de aptitud', 0, 40, 160)
  ]);
  h.context.fetch = async (_, options) => {
    const items = JSON.parse(JSON.parse(options.body).prompt.split('\n').at(-1));
    return { ok: true, status: 200, json: async () => ({ ok: true, text: JSON.stringify(items.map(item => ({
      unitId: item.unitId, translatedText: item.text === 'México' ? 'IVIGAIVY' :
        item.text === 'IVIGAIVY' ? 'IVIGAIVY' : 'Fitness criteria'
    }))) }) };
  };
  await h.app.applyTextTranslationModal();
  assert.deepEqual(h.notes().map(note => note.text), ['Fitness criteria']);
});

test('cancelled browser OCR releases its worker without loading the PDF', async () => {
  const h = fixture();
  const controller = new AbortController();
  h.app._translationNotesAbortController = controller;
  let terminated = 0;
  h.context.Tesseract = { createWorker: async () => {
    controller.abort();
    return { terminate: async () => terminated++ };
  } };
  h.context.pdfjsLib = { getDocument() { assert.fail('Cancelled before PDF loading'); } };
  await assert.rejects(h.app.extractTranslationNoteImages(new ArrayBuffer(1), []), /TRANSLATION_CANCELLED/);
  assert.equal(terminated, 1);
});

test('saving and reopening notes retains their source references and highlight positions', async () => {
  const h = fixture([span('Left paragraph', 0, 40, 50), span('Right paragraph', 0, 340, 70)]);
  const lib = vm.runInNewContext('PDFLib', h.context);
  const bytes = await vm.runInNewContext(`(async () => {
    const pdf = await PDFLib.PDFDocument.create();
    pdf.addPage([600, 10000]).drawText('ORIGINAL_CONTENT', { x: 40, y: 9800 });
    pdf.addPage([600, 10000]);
    return pdf.save();
  })()`, h.context);
  h.first.sources['source-a'].buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await h.app.applyTextTranslationModal();
  const snapshot = await h.app.captureDocumentSnapshot(h.app.docs[2].id);
  const prepared = await h.app.prepareDocumentPdf(snapshot, { purpose: 'save', compression: 'none', protection: 'preserve' });
  const reopened = await lib.PDFDocument.load(prepared.bytes);
  assert.equal(reopened.getPageCount(), 2);
  const annots = reopened.getPage(0).node.Annots();
  assert.equal(annots.size(), 2);
  const notes = [0, 1].map(i => reopened.context.lookup(annots.get(i)));
  for (const note of notes) assert.match(note.get(lib.PDFName.of('Contents')).decodeText(), /Original:[\s\S]*Traducción:/);
  assert.equal(notes[0].get(lib.PDFName.of('Rect')).asArray()[0].asNumber(), 40);
  assert.equal(notes[1].get(lib.PDFName.of('Rect')).asArray()[0].asNumber(), 340);
  assert.ok(reopened.getPage(0).node.Contents());
});
