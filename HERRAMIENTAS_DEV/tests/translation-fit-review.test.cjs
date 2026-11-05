const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture() {
  const h = loadAppModules(['js/app.agentic.js']);
  const calls = { provider: 0, extraction: 0, preflight: 0 };
  h.windowObject.PythonManager.extractTranslatableText = async () => {
    calls.extraction++;
    return [{ pageIndex: 0, text: 'Título original', fontName: 'Helvetica', fontKey: 'helv', fontSize: 12,
      rect: { x: 20, y: 20, width: 100, height: 20 }, origin: [20, 32], pageHeight: 240 }];
  };
  h.windowObject.PythonManager.preflightTranslatedOccurrences = async (_pdf, { occurrences }) => {
    calls.preflight++;
    return occurrences.map(item => item.fitMode === 'adaptive'
      ? { id: item.id, status: 'READY', adjusted: true, originalFontSize: 12, fontSize: 10.5 }
      : { id: item.id, status: 'OVERFLOW' });
  };
  const options = { docId: h.first.id, scope: { pages: [0] }, targetLanguage: 'English', request: async ({ units }) => {
    calls.provider++;
    return JSON.stringify(units.map(unit => ({ unitId: unit.unitId, translatedText: 'Longer translated title' })));
  } };
  return { ...h, options, calls };
}

test('native geometry fits in the first review without changing the cached review or original document', async () => {
  const { app, options, calls, first } = fixture();
  app.ensureDocumentState(first);
  const original = JSON.stringify(first);
  const initial = await app.prepareTextTranslationReview(options);
  assert.equal(initial.readyCount, 1);
  assert.equal(app._translationReviews.get(initial.reviewId).replacements[0].fitMode, 'adaptive');
  const adjusted = await app.fitTextTranslationReview(initial.reviewId);
  assert.equal(adjusted.readyCount, 1);
  assert.equal(adjusted.items[0].adjusted, true);
  assert.equal(adjusted.items[0].fontSize, 10.5);
  assert.equal(app._translationReviews.has(initial.reviewId), false);
  assert.equal(JSON.stringify(first), original);
  const cached = await app.prepareTextTranslationReview(options);
  assert.equal(cached.readyCount, 1);
  assert.deepEqual(calls, { provider: 1, extraction: 1, preflight: 2 });
  let parameters, preparedSnapshot;
  app.runDocumentAction = async args => { parameters = args.parameters; preparedSnapshot = args.preparedSnapshot; return { status: 'review', draftId: 'copy' }; };
  await app.applyTextTranslationReview(adjusted.reviewId, [adjusted.items[0].unitId]);
  assert.equal(parameters.replacements[0].fitMode, 'adaptive');
  assert.equal(parameters.units[0].fontSize, 12);
  assert.equal(preparedSnapshot.schemaVersion, 1);
  assert.equal(preparedSnapshot.docId, first.id);
});

test('late native overflow is skipped and other ready text is applied in the same click', async () => {
  const { app, options, calls, first, windowObject } = fixture();
  const extract = windowObject.PythonManager.extractTranslatableText;
  windowObject.PythonManager.extractTranslatableText = async (...args) => {
    const firstUnit = (await extract(...args))[0];
    return [firstUnit, { ...firstUnit, text: 'Otro título', rect: { x: 20, y: 80, width: 100, height: 20 }, origin: [20, 92] }];
  };
  app.ensureDocumentState(first);
  const original = JSON.stringify(first);
  const review = await app.prepareTextTranslationReview(options);
  const failedId = review.items[0].unitId;
  let attempts = 0;
  app.runDocumentAction = async args => {
    attempts++;
    if (attempts === 1) return { status: 'failed', errorCode: 'TRANSLATION_OVERFLOW', failedOccurrenceId: failedId };
    assert.equal(args.parameters.replacements[0].selected, false);
    assert.equal(args.parameters.replacements[1].selected, true);
    return { status: 'review', draftId: 'copy' };
  };
  const result = await app.applyTextTranslationReview(review.reviewId, review.items.map(item => item.unitId));
  assert.equal(result.status, 'review');
  assert.equal(result.lateRejectedCount, 1);
  assert.equal(attempts, 2);
  assert.equal(JSON.stringify(first), original);
  assert.deepEqual(calls, { provider: 1, extraction: 1, preflight: 1 });
});

test('late source mismatch is excluded without losing other ready translations', async () => {
  const { app, options, calls, windowObject } = fixture();
  const extract = windowObject.PythonManager.extractTranslatableText;
  windowObject.PythonManager.extractTranslatableText = async (...args) => {
    const firstUnit = (await extract(...args))[0];
    return [firstUnit, { ...firstUnit, text: 'Otro título', rect: { x: 20, y: 80, width: 100, height: 20 }, origin: [20, 92] }];
  };
  const review = await app.prepareTextTranslationReview(options);
  const [failedId, readyId] = review.items.map(item => item.unitId);
  let attempts = 0;
  app.runDocumentAction = async args => {
    attempts++;
    if (attempts === 1) return { status: 'failed', errorCode: 'TRANSLATION_SOURCE_TEXT_MISMATCH', failedOccurrenceId: failedId, failedStage: 'plan' };
    assert.equal(args.parameters.replacements[0].selected, false);
    assert.equal(args.parameters.replacements[1].selected, true);
    return { status: 'review', draftId: 'copy' };
  };
  const result = await app.applyTextTranslationReview(review.reviewId, [failedId, readyId]);
  assert.equal(result.status, 'review');
  assert.equal(result.lateRejectedCount, 1);
  assert.equal(attempts, 2);
  assert.equal(calls.provider, 1);
});

test('several late item failures are excluded before publishing one verified draft', async () => {
  const { app, options, first, windowObject } = fixture();
  const extract = windowObject.PythonManager.extractTranslatableText;
  windowObject.PythonManager.extractTranslatableText = async (...args) => {
    const unit = (await extract(...args))[0];
    return [unit, { ...unit, text: 'Segundo', rect: { x: 20, y: 80, width: 100, height: 20 }, origin: [20, 92] },
      { ...unit, text: 'Tercero', rect: { x: 20, y: 140, width: 100, height: 20 }, origin: [20, 152] }];
  };
  app.ensureDocumentState(first);
  const original = JSON.stringify(first);
  const review = await app.prepareTextTranslationReview(options);
  const ids = review.items.map(item => item.unitId);
  let attempts = 0;
  app.runDocumentAction = async args => {
    attempts++;
    if (attempts === 1) return { status: 'failed', errorCode: 'TRANSLATION_OVERFLOW', failedOccurrenceId: ids[0] };
    if (attempts === 2) return { status: 'failed', errorCode: 'TRANSLATION_SOURCE_TEXT_MISMATCH', failedOccurrenceId: ids[1] };
    assert.deepEqual(Array.from(args.parameters.replacements, item => item.selected), [false, false, true]);
    return { status: 'review', draftId: 'verified-copy' };
  };
  const result = await app.applyTextTranslationReview(review.reviewId, ids);
  assert.equal(result.status, 'review');
  assert.equal(result.lateRejectedCount, 2);
  assert.equal(attempts, 3);
  assert.equal(JSON.stringify(first), original);
});

test('a global verification failure is not skipped or published', async () => {
  const { app, options } = fixture();
  const review = await app.prepareTextTranslationReview(options);
  let attempts = 0;
  app.runDocumentAction = async () => {
    attempts++;
    return { status: 'failed', errorCode: 'TRANSLATION_OUTPUT_UNVERIFIED', failedPageIndex: 0 };
  };
  const result = await app.applyTextTranslationReview(review.reviewId, [review.items[0].unitId]);
  assert.equal(result.errorCode, 'TRANSLATION_OUTPUT_UNVERIFIED');
  assert.equal(attempts, 1);
  assert.equal(app._translationReviews.has(review.reviewId), true);
});

test('cancelling after a rejected item prevents further reconstruction', async () => {
  const { app, options, windowObject } = fixture();
  const extract = windowObject.PythonManager.extractTranslatableText;
  windowObject.PythonManager.extractTranslatableText = async (...args) => {
    const unit = (await extract(...args))[0];
    return [unit, { ...unit, text: 'Segundo', rect: { x: 20, y: 80, width: 100, height: 20 }, origin: [20, 92] }];
  };
  const review = await app.prepareTextTranslationReview(options);
  const controller = new AbortController();
  let attempts = 0;
  app.runDocumentAction = async () => {
    attempts++;
    controller.abort();
    return { status: 'failed', errorCode: 'TRANSLATION_OVERFLOW', failedOccurrenceId: review.items[0].unitId };
  };
  const result = await app.applyTextTranslationReview(review.reviewId, review.items.map(item => item.unitId), null, controller.signal);
  assert.equal(result.status, 'cancelled');
  assert.equal(attempts, 1);
});

test('document action forwards the native failed occurrence without publishing a copy', async () => {
  const { app, options, windowObject } = fixture();
  const review = await app.prepareTextTranslationReview(options);
  const stored = app._translationReviews.get(review.reviewId);
  const failedId = review.items[0].unitId;
  app._documentActions.get('translate-text').hasUserKey = () => true;
  windowObject.PythonManager.reconstructTranslatedOccurrences = async () => {
    const error = new Error('TRANSLATION_OVERFLOW');
    error.failedOccurrenceId = failedId;
    error.failedPageIndex = 0;
    throw error;
  };
  const result = await app.applyTextTranslationReview(review.reviewId, [failedId]);
  assert.equal(result.status, 'late-exception', JSON.stringify(result));
  assert.equal(stored.checks[0].status, 'OVERFLOW');
  assert.equal(app._documentActionDrafts?.size || 0, 0);
});

test('pending edits and changes during fitting invalidate the review', async () => {
  const { app, options, first, calls, windowObject } = fixture();
  const initial = await app.prepareTextTranslationReview(options);
  const flush = app.flushDocumentEdits.bind(app);
  app.flushDocumentEdits = async id => { await flush(id); app.markDocumentChanged(id); };
  assert.equal((await app.fitTextTranslationReview(initial.reviewId)).errorCode, 'STALE_TRANSLATION_REVIEW');
  assert.equal(calls.preflight, 1);
  app.flushDocumentEdits = flush;
  const current = await app.prepareTextTranslationReview(options);
  const preflight = windowObject.PythonManager.preflightTranslatedOccurrences;
  windowObject.PythonManager.preflightTranslatedOccurrences = async (...args) => {
    const result = await preflight(...args);
    app.markDocumentChanged(first.id);
    return result;
  };
  assert.equal((await app.fitTextTranslationReview(current.reviewId)).errorCode, 'STALE_TRANSLATION_REVIEW');
});

test('discarding a review while fitting cannot resurrect it', async () => {
  const { app, options, windowObject } = fixture();
  const initial = await app.prepareTextTranslationReview(options);
  const preflight = windowObject.PythonManager.preflightTranslatedOccurrences;
  windowObject.PythonManager.preflightTranslatedOccurrences = async (...args) => {
    app.discardTextTranslationReview(initial.reviewId);
    return preflight(...args);
  };
  assert.equal((await app.fitTextTranslationReview(initial.reviewId)).errorCode, 'STALE_TRANSLATION_REVIEW');
  assert.equal(app._translationReviews.size, 0);
});

test('an old fit cannot re-enable controls belonging to a new review', async () => {
  const { app, documentObject } = fixture();
  const controls = Object.fromEntries(['prepare', 'apply', 'fit'].map(name => [`translation-review-${name}`, { disabled: false }]));
  documentObject.getElementById = id => controls[id] || null;
  app._activeTranslationReviewId = 'old-review';
  let release;
  app.fitTextTranslationReview = () => new Promise(resolve => { release = resolve; });
  const pending = app.fitTextTranslationModal();
  app._activeTranslationReviewId = 'new-review';
  release({ status: 'review', reviewId: 'old-fitted-review' });
  await pending;
  for (const control of Object.values(controls)) assert.equal(control.disabled, true);
  assert.equal(app._activeTranslationReviewId, 'new-review');
});

test('fitting keeps ready translations selected when the review only shows exceptions', async () => {
  const { app, documentObject } = fixture();
  const controls = Object.fromEntries(['prepare', 'apply', 'fit'].map(name => [`translation-review-${name}`, { disabled: false }]));
  documentObject.getElementById = id => controls[id] || null;
  documentObject.querySelectorAll = selector => selector.includes(':not(:disabled)')
    ? ['selected', 'deselected'].map(unitId => ({ dataset: { unitId } })) : [{ dataset: { unitId: 'selected' } }];
  app._activeTranslationReviewId = 'review';
  app.fitTextTranslationReview = async () => ({ status: 'review', reviewId: 'fitted', items: ['selected', 'deselected', 'adjusted'].map(unitId => ({ unitId, selected: true })) });
  let rendered;
  app.renderTextTranslationReview = result => { rendered = result; };
  await app.fitTextTranslationModal();
  assert.deepEqual(rendered.items.map(item => item.selected), [true, true, true]);
});
