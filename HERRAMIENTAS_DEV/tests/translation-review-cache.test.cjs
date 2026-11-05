const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture({ delay = 0, provider, fastRetries = false } = {}) {
  const runtime = fastRetries ? { setTimeout(callback) { queueMicrotask(callback); return 1; }, clearTimeout() {} } : {};
  const { app, first, windowObject } = loadAppModules(['js/app.agentic.js'], runtime);
  const calls = { snapshot: 0, extraction: 0, provider: 0, validation: 0 };
  const pause = () => delay ? new Promise(resolve => setTimeout(resolve, delay)) : Promise.resolve();
  const capture = app.captureDocumentSnapshot.bind(app);
  app.captureDocumentSnapshot = async (...args) => { calls.snapshot++; return capture(...args); };
  windowObject.PythonManager.extractTranslatableText = async (_buffer, { pageIndices }) => {
    calls.extraction++;
    await pause();
    return pageIndices.map(pageIndex => ({
      pageIndex, text: 'Texto original', fontName: 'Helvetica', fontKey: 'helv', fontSize: 12,
      rect: { x: 20, y: 20, width: 150, height: 20 }, origin: [20, 32], pageHeight: 240
    }));
  };
  windowObject.PythonManager.preflightTranslatedOccurrences = async (_buffer, { occurrences }) => {
    calls.validation++;
    await pause();
    return occurrences.map(item => ({ id: item.id, status: 'READY' }));
  };
  const request = async args => {
    calls.provider++;
    await pause();
    if (provider) return provider(args, calls.provider);
    return JSON.stringify(args.units.map(unit => ({ unitId: unit.unitId, translatedText: 'Translated text' })));
  };
  const options = { docId: first.id, scope: { pages: [0] }, targetLanguage: 'English', request };
  return { app, first, windowObject, calls, options };
}

test('unchanged review reuses all expensive work and registers an independent usable review ID', async t => {
  const { app, calls, options } = fixture({ delay: 30 });
  const started = performance.now();
  const first = await app.prepareTextTranslationReview(options);
  const initialMs = performance.now() - started;
  assert.equal(first.status, 'review');
  first.items[0].translatedText = 'Client mutation';
  app.discardTextTranslationReview(first.reviewId);
  const repeatedAt = performance.now();
  const second = await app.prepareTextTranslationReview(options);
  const repeatedMs = performance.now() - repeatedAt;
  assert.notEqual(second.reviewId, first.reviewId);
  assert.equal(second.items[0].translatedText, 'Translated text');
  assert.equal(app._translationReviews.has(second.reviewId), true);
  assert.deepEqual(calls, { snapshot: 1, extraction: 1, provider: 1, validation: 1 });
  app.runDocumentAction = async () => ({ status: 'review', draftId: 'verified-copy' });
  const applied = await app.applyTextTranslationReview(second.reviewId, [second.items[0].unitId]);
  assert.equal(applied.status, 'review');
  t.diagnostic(`Mock provider/engine, 30 ms per phase: initial ${initialMs.toFixed(1)} ms; repeat ${repeatedMs.toFixed(1)} ms; no repeated provider or PDF calls.`);
});

test('apply skips a batch of unsafe fragments and still creates the copy with the rest', async () => {
  const { app, options } = fixture();
  const prepared = await app.prepareTextTranslationReview(options);
  assert.equal(prepared.status, 'review');
  const review = app._translationReviews.get(prepared.reviewId);
  const original = review.units[0];
  const ids = [original.id, 'native:source:0:1', 'native:source:0:2'];
  for (const id of ids.slice(1)) {
    review.units.push({ ...original, id });
    review.checks.push({ id, status: 'READY' });
    review.replacements.push({ ...review.replacements[0], unitId: id });
  }
  let calls = 0;
  app.runDocumentAction = async ({ parameters }) => {
    calls++;
    const selected = parameters.replacements.filter(item => item.selected).map(item => item.unitId);
    if (calls === 1) {
      assert.equal(selected.join('|'), ids.join('|'));
      return { status: 'failed', errorCode: 'TRANSLATION_NEIGHBOR_INTERSECTION', failedOccurrenceIds: ids.slice(0, 2) };
    }
    assert.equal(selected.join('|'), ids[2]);
    return { status: 'review', draftId: 'verified-copy' };
  };
  const result = await app.applyTextTranslationReview(prepared.reviewId, ids);
  assert.equal(result.status, 'review');
  assert.equal(result.lateRejectedCount, 2);
  assert.equal(calls, 2);
});

test('a page verification failure retains only that source page and applies the others', async () => {
  const { app, options } = fixture();
  const prepared = await app.prepareTextTranslationReview(options);
  const review = app._translationReviews.get(prepared.reviewId);
  const first = review.units[0];
  const secondId = 'native:source:1:1';
  review.units.push({ ...first, id: secondId, pageIndex: 1, sourcePageIndex: 1 });
  review.checks.push({ id: secondId, status: 'READY' });
  review.replacements.push({ ...review.replacements[0], unitId: secondId });
  let calls = 0;
  app.runDocumentAction = async ({ parameters }) => {
    calls++;
    const selected = parameters.replacements.filter(item => item.selected).map(item => item.unitId);
    if (calls === 1) return { status: 'failed', errorCode: 'TRANSLATION_OUTPUT_UNVERIFIED',
      failedPageIndex: 0, failedStage: 'reopen_verify', failedOccurrenceIds: [first.id] };
    assert.equal(selected.join('|'), secondId);
    return { status: 'review', draftId: 'verified-copy' };
  };
  const result = await app.applyTextTranslationReview(prepared.reviewId, [first.id, secondId]);
  assert.equal(result.status, 'review');
  assert.equal(result.lateRejectedCount, 1);
  assert.equal(calls, 2);
});

test('concurrent identical preparations share work and both receive progress and separate review IDs', async () => {
  const { app, calls, options } = fixture({ delay: 10 });
  const progressA = [], progressB = [];
  const [a, b] = await Promise.all([
    app.prepareTextTranslationReview({ ...options, onProgress: value => progressA.push(value.value) }),
    app.prepareTextTranslationReview({ ...options, onProgress: value => progressB.push(value.value) })
  ]);
  assert.equal(a.status, 'review');
  assert.equal(b.status, 'review');
  assert.notEqual(a.reviewId, b.reviewId);
  assert.equal(progressA.at(-1), 100);
  assert.equal(progressB.at(-1), 100);
  assert.deepEqual(calls, { snapshot: 1, extraction: 1, provider: 1, validation: 1 });
});

test('revision, lifecycle, language, scope and provider/font changes invalidate the cached review', async () => {
  const { app, first, calls, options } = fixture();
  const prepare = async () => assert.equal((await app.prepareTextTranslationReview(options)).status, 'review');
  await prepare();
  app.markDocumentChanged(first.id);
  await prepare();
  app.ensureDocumentState(first).lifecycleEpoch++;
  await prepare();
  options.targetLanguage = 'French';
  await prepare();
  options.scope = { pages: [0], selectedText: 'Texto original' };
  await prepare();
  app.geminiApiKey = 'configured-key-changed';
  await prepare();
  app._systemFontBytes = { 'New font': new ArrayBuffer(4) };
  await prepare();
  app.fontRegistry = { fonts: { 'New font': { family: 'New font', weight: 700 } } };
  await prepare();
  assert.equal(calls.provider, 8);
  assert.equal(calls.snapshot, 8);
});

test('pending editor changes are flushed before reuse and stale in-flight work cannot be applied', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { app, first, calls, options } = fixture({ provider: async ({ units }, count) => {
    if (count === 1) await gate;
    return JSON.stringify(units.map(unit => ({ unitId: unit.unitId, translatedText: 'Translated text' })));
  } });
  const pending = app.prepareTextTranslationReview(options);
  while (!calls.provider) await new Promise(resolve => setImmediate(resolve));
  app.markDocumentChanged(first.id);
  release();
  assert.equal((await pending).errorCode, 'STALE_TRANSLATION_REVIEW');
  assert.equal(app._translationReviews.size, 0);
  assert.equal((await app.prepareTextTranslationReview(options)).status, 'review');
  let needsFlush = true;
  app.flushDocumentEdits = async () => {
    if (needsFlush) { needsFlush = false; app.markDocumentChanged(first.id); }
  };
  assert.equal((await app.prepareTextTranslationReview(options)).status, 'review');
  assert.equal(calls.provider, 3);
});

test('provider failures and incomplete batches recover within the same review before caching', async () => {
  const { app, calls, options } = fixture({ fastRetries: true, provider: ({ units }, count) => {
    if (count === 1) throw new Error('PROVIDER_REQUEST_FAILED');
    if (count === 2) return '[]';
    return JSON.stringify(units.map(unit => ({ unitId: unit.unitId, translatedText: 'Translated text' })));
  } });
  assert.equal((await app.prepareTextTranslationReview(options)).readyCount, 1);
  assert.equal((await app.prepareTextTranslationReview(options)).readyCount, 1);
  assert.equal(calls.provider, 3);
});

test('closing and replacing a document never reuses a previous document cache', async () => {
  const { app, first, calls, options } = fixture();
  assert.equal((await app.prepareTextTranslationReview(options)).status, 'review');
  app.docs[0] = { ...first, pages: [...first.pages], documentState: { ...first.documentState } };
  assert.equal((await app.prepareTextTranslationReview(options)).status, 'review');
  assert.equal(calls.provider, 2);
});

test('a missing extractor is loaded before classifying a PDF as having no text', async () => {
  const { app, windowObject, calls, options } = fixture();
  const manager = windowObject.PythonManager;
  windowObject.PythonManager = undefined;
  let loads = 0;
  windowObject.AppLazy = { async loadScript(url) {
    assert.match(url, /^js\/python_manager\.js\?/);
    loads++;
    windowObject.PythonManager = manager;
  } };
  const review = await app.prepareTextTranslationReview(options);
  assert.equal(review.status, 'review');
  assert.equal(review.readyCount, 1);
  assert.equal((await app.prepareTextTranslationReview(options)).readyCount, 1);
  assert.equal(loads, 1);
  assert.equal(calls.extraction, 1);
});

test('a missing engine or source is not reported as a textless PDF', async () => {
  const { app, first, windowObject, calls, options } = fixture();
  const manager = windowObject.PythonManager;
  windowObject.PythonManager = undefined;
  assert.equal((await app.prepareTextTranslationReview(options)).errorCode, 'TRANSLATION_ENGINE_UNAVAILABLE');
  windowObject.PythonManager = manager;
  first.sources = {};
  assert.equal((await app.prepareTextTranslationReview(options)).errorCode, 'TRANSLATION_SOURCE_UNAVAILABLE');
  assert.equal(calls.provider, 0);
});
