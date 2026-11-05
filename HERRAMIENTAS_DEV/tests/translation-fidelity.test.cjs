const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./helpers/document-harness.cjs');

test('translation preflight blocks overflow, unavailable fonts, complex layouts and scans', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.translationUnits = [
    { id: 'ready', fontAvailable: true, maxCharacters: 20, layout: 'simple' },
    { id: 'long', fontAvailable: true, maxCharacters: 3, layout: 'simple' },
    { id: 'missing', fontAvailable: false, maxCharacters: 20, layout: 'simple' },
    { id: 'rotated', fontAvailable: true, maxCharacters: 20, layout: 'rotated' },
    { id: 'scan', isScan: true, fontAvailable: true, maxCharacters: 20, layout: 'simple' }
  ];
  const result = await app.preflightTextReplacement(snapshot, [
    { unitId: 'ready', translatedText: 'Hola' }, { unitId: 'long', translatedText: 'Texto largo' },
    { unitId: 'missing', translatedText: 'Hola' }, { unitId: 'rotated', translatedText: 'Hola' }, { unitId: 'scan', translatedText: 'Hola' }
  ]);
  assert.deepEqual(result.units.map(unit => unit.status), ['READY', 'OVERFLOW', 'FONT_UNAVAILABLE', 'UNSUPPORTED_LAYOUT', 'SCAN_REQUIRES_RECONSTRUCTION']);
  assert.equal(result.canApplyAll, false);
});

test('translation blocks glyphs outside the local standard PDF font coverage', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.translationUnits = [{ id: 'latin', fontAvailable: true, fontKey: 'helv', maxCharacters: 30, layout: 'simple' }];
  const result = await app.preflightTextReplacement(snapshot, [{ unitId: 'latin', translatedText: '日本語' }]);
  assert.equal(result.units[0].status, 'FONT_UNAVAILABLE');
});

test('translation permits rotated vector pages while retaining RTL and ligature safeguards', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.translationUnits = [
    { id: 'rotated', fontAvailable: true, fontKey: 'helv', maxCharacters: 30, layout: 'simple', rotation: 90 },
    { id: 'rtl', fontAvailable: true, fontKey: 'helv', maxCharacters: 30, layout: 'simple', isRtl: true },
    { id: 'ligature', fontAvailable: true, fontKey: 'helv', maxCharacters: 30, layout: 'simple', hasLigatures: true }
  ];
  const result = await app.preflightTextReplacement(snapshot, [
    { unitId: 'rotated', translatedText: 'Hello' }, { unitId: 'rtl', translatedText: 'Hello' }, { unitId: 'ligature', translatedText: 'Hello' }
  ]);
  assert.deepEqual(result.units.map(unit => unit.status), ['READY', 'UNSUPPORTED_LAYOUT', 'UNSUPPORTED_LAYOUT']);
});

test('translation preserves AcroForm values while leaving page labels eligible', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.translationUnits = [
    { id: 'label', fontAvailable: true, fontKey: 'helv', maxCharacters: 30, layout: 'simple' },
    { id: 'field-value', fontAvailable: true, fontKey: 'helv', maxCharacters: 30, layout: 'simple', isFormValue: true }
  ];
  const result = await app.preflightTextReplacement(snapshot, [
    { unitId: 'label', translatedText: 'Name' }, { unitId: 'field-value', translatedText: 'John' }
  ]);
  assert.deepEqual(result.units.map(unit => unit.status), ['READY', 'UNSUPPORTED_LAYOUT']);
  assert.match(result.units[1].reason, /formulario/);
});

test('translation unit extraction preserves page geometry and rejects subset fonts', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [
    { id: 'simple', text: 'Hello', x: 10, y: 20, width: 120, height: 16, fontName: 'Helvetica', fontSize: 12, color: '#000000' },
    { id: 'subset', text: 'Texto', x: 10, y: 50, width: 120, height: 16, fontName: 'ABCDE+Custom', fontSubset: true, fontSize: 12 }
  ];
  const units = await app.extractTextReplacementUnits(snapshot);
  assert.deepEqual({ ...units[0].rect }, { x: 10, y: 20, width: 120, height: 16 });
  assert.equal(units[0].layout, 'simple');
  assert.equal(units[0].runs[0].font, 'Helvetica');
  assert.equal(units[1].fontAvailable, false);
});

test('translation reads vector text from the source PDF before falling back to editor overlays', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0]._pdfH = 842;
  snapshot.payload.pages[0].objects = [{ id: 'overlay', text: 'No usar', x: 1, y: 2, width: 20, height: 10, font: 'Helvetica', size: 8 }];
  const units = await app.extractTextReplacementUnits(snapshot, {
    async extractTranslatableText() {
      return [{ pageIndex: 0, text: 'Texto fuente', fontName: 'ArialMT', fontSize: 12, color: [0, 0, 0], rect: { x: 10, y: 20, width: 120, height: 16 }, overImage: false }];
    }
  });
  assert.equal(units.length, 1);
  assert.match(units[0].id, /^native:source-a:0:/);
  assert.equal(units[0].text, 'Texto fuente');
  assert.equal(units[0].fontKey, 'helv');
});

test('translation uses an opaque overlay for OCR text over a partial image', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  const units = await app.extractTextReplacementUnits(snapshot, {
    async extractTranslatableText() {
      return [{ pageIndex: 0, text: 'Salud Ocupacional', fontName: 'Helvetica', fontSize: 12, origin: [10, 32], pageHeight: 240, color: [0, 0, 0], rect: { x: 10, y: 20, width: 160, height: 16 }, overImage: true, isScan: false }];
    }
  });
  snapshot.payload.translationUnits = units;
  const blocked = await app.preflightTextReplacement(snapshot, [{ unitId: units[0].id, translatedText: 'Occupational Health' }]);
  assert.equal(blocked.units[0].status, 'SCAN_REQUIRES_RECONSTRUCTION');
  const preflight = await app.preflightTextReplacement(snapshot, [{ unitId: units[0].id, translatedText: 'Occupational Health', fitMode: 'adaptive', renderMode: 'scan-overlay' }]);
  assert.equal(preflight.units[0].status, 'READY');
  assert.equal(preflight.units[0].renderMode, 'scan-overlay');
});

test('translation marks text from a scanned page as requiring reconstruction', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  const units = await app.extractTextReplacementUnits(snapshot, {
    async extractTranslatableText() {
      return [{ pageIndex: 0, text: 'Texto OCR', fontName: 'Helvetica', fontSize: 12, color: [0, 0, 0], rect: { x: 10, y: 20, width: 120, height: 16 }, overImage: true, isScan: true }];
    }
  });
  snapshot.payload.translationUnits = units;
  const preflight = await app.preflightTextReplacement(snapshot, [{ unitId: units[0].id, translatedText: 'OCR text' }]);
  assert.equal(preflight.units[0].status, 'SCAN_REQUIRES_RECONSTRUCTION');
});

test('translation sends scanned OCR through the explicit opaque-overlay path only', async () => {
  const { app, first, windowObject } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  const units = await app.extractTextReplacementUnits(snapshot, {
    async extractTranslatableText() {
      return [{ pageIndex: 0, text: 'Texto OCR', fontName: 'Helvetica', fontKey: 'helv', fontSize: 12,
        origin: [10, 32], pageHeight: 240, color: [0, 0, 0], rect: { x: 10, y: 20, width: 120, height: 16 }, isScan: true }];
    }
  });
  snapshot.payload.translationUnits = units;
  let occurrence;
  windowObject.PythonManager.preflightTranslatedOccurrences = async (_source, { occurrences }) => {
    occurrence = occurrences[0];
    return [{ id: occurrence.id, status: 'READY', renderMode: occurrence.renderMode }];
  };
  const preflight = await app.preflightTextReplacement(snapshot, [{ unitId: units[0].id, translatedText: 'OCR text', fitMode: 'adaptive', renderMode: 'scan-overlay' }]);
  assert.equal(preflight.units[0].status, 'READY');
  assert.equal(occurrence.renderMode, 'scan-overlay');
});

test('unchanged scan text is retained without image reconstruction', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.translationUnits = [{ id: 'scan-name', text: 'Jocelin Garcia', isScan: true, fontAvailable: false, layout: 'simple' }];
  const result = await app.preflightTextReplacement(snapshot, [{ unitId: 'scan-name', translatedText: 'Jocelin Garcia' }]);
  assert.equal(result.units[0].status, 'RETAINED');
  assert.equal(result.canApplyAll, true);
});

test('translation preflight derives units only from the supplied snapshot', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'source', text: 'Hola', x: 1, y: 2, width: 80, height: 12, fontName: 'Helvetica', fontSize: 10 }];
  const result = await app.preflightTextReplacement(snapshot, [{ unitId: 'p0-osource', translatedText: 'Hello' }]);
  assert.equal(result.units[0].status, 'READY');
  assert.equal(result.canApplyAll, true);
});

test('translation accepts only one exact selected vector unit', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  first.pages[0].objects = [
    { id: 'source', text: 'Buenos días', x: 10, y: 20, width: 140, height: 16, font: 'Helvetica', size: 12 }
  ];
  const review = await app.prepareTextTranslationReview({
    docId: first.id, scope: { pages: [0], selectedText: ' Buenos   días ' }, targetLanguage: 'Inglés',
    request: async ({ units }) => JSON.stringify([{ unitId: units[0].unitId, translatedText: 'Good morning' }])
  });
  assert.equal(review.status, 'review');
  assert.equal(review.items.length, 1);
  const rejected = await app.prepareTextTranslationReview({
    docId: first.id, scope: { pages: [0], selectedText: 'Buenos' }, targetLanguage: 'Inglés', request: async () => '[]'
  });
  assert.deepEqual({ ...rejected }, { status: 'failed', errorCode: 'SELECTION_NOT_TRANSLATABLE' });
});

test('selected word inside a reflow group keeps its original geometry', async () => {
  const { app, first, windowObject } = loadAppModules(['js/app.agentic.js']);
  windowObject.PythonManager.extractTranslatableText = async () => [{
    pageIndex: 0, text: 'Esta disciplina protege la salud', fontName: 'Helvetica', fontKey: 'helv',
    fontSize: 12, origin: [10, 32], pageHeight: 240, color: [0, 0, 0],
    rect: { x: 10, y: 20, width: 220, height: 16 }, reflow: true,
    selectionParts: [{ text: 'disciplina', origin: [42, 32], rect: { x: 42, y: 20, width: 52, height: 16 } }]
  }];
  let occurrence;
  windowObject.PythonManager.preflightTranslatedOccurrences = async (_source, { occurrences }) => {
    occurrence = occurrences[0];
    return [{ id: occurrence.id, status: 'READY' }];
  };
  const review = await app.prepareTextTranslationReview({
    docId: first.id, scope: { pages: [0], selectedText: 'disciplina' }, targetLanguage: 'Inglés',
    request: async ({ units }) => JSON.stringify([{ unitId: units[0].unitId, translatedText: 'discipline' }])
  });
  assert.equal(review.status, 'review');
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].originalText, 'disciplina');
  assert.equal(occurrence.reflow, false);
  assert.equal(occurrence.rect.x0, 42);
});

test('translation reconstructs only reviewed READY units and removes their editable overlays', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  app.geminiApiKey = 'user-owned-key';
  first.pages[0].objects = [
    { id: 'ready', text: 'Hola', x: 10, y: 20, width: 120, height: 16, fontName: 'Helvetica', fontSize: 12, color: '#000000' },
    { id: 'overflow', text: 'Adiós', x: 10, y: 50, width: 12, height: 16, fontName: 'Helvetica', fontSize: 12, color: '#000000' }
  ];

  const result = await app.runDocumentAction({
    actionId: 'translate-text',
    docId: first.id,
    scope: { pages: [0] },
    parameters: {
      targetLanguage: 'Inglés',
      replacements: [
        { unitId: 'p0-oready', translatedText: 'Hello', selected: true },
        { unitId: 'p0-ooverflow', translatedText: 'A much longer farewell', selected: true }
      ]
    }
  });

  assert.equal(result.status, 'review');
  const draft = await app.getDocumentActionDraft(result.draftId);
  assert.equal(draft.snapshot.payload.pages[0].objects.length, 1);
  assert.equal(draft.snapshot.payload.pages[0].objects[0].id, 'overflow');
  assert.equal(draft.snapshot.payload.pages[0].objects[0].text, 'Adiós');
  assert.equal(draft.snapshot.payload.document.name, 'doc-a - Traducción Inglés.pdf');
  assert.deepEqual({ ...draft.snapshot.payload.translationSummary }, { applied: 1, overlays: 0, exceptions: 1, targetLanguage: 'Inglés', reconstruction: 'verified' });
  assert.equal(first.pages[0].objects[0].text, 'Hola');
});

test('translation reconstruction rejects an unverified PDF result before it can create a copy', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [
    { id: 'source', text: 'Hola', x: 10, y: 20, width: 120, height: 16, font: 'Helvetica', size: 12 }
  ];
  const executor = {
    async reconstructTranslatedOccurrences() {
      return { bytes: new Uint8Array([7]).buffer, manifest: { treated: [], rejected: [] } };
    }
  };
  await assert.rejects(
    app.reconstructReviewedTextReplacementsToSnapshot(snapshot, { pages: [0] }, {
      targetLanguage: 'Inglés', replacements: [{ unitId: 'p0-osource', translatedText: 'Hello', selected: true }]
    }, executor),
    /TRANSLATION_OUTPUT_UNVERIFIED/
  );
  assert.equal(snapshot.payload.pages[0].objects[0].text, 'Hola');
});

test('text correction rejects an empty or unsafe review without creating a draft', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  app.geminiApiKey = 'user-owned-key';
  first.pages[0].objects = [
    { id: 'scan', text: 'Hola', x: 10, y: 20, width: 120, height: 16, fontName: 'Helvetica', fontSize: 12, isScan: true }
  ];

  const unsafe = await app.runDocumentAction({
    actionId: 'correct-text', docId: first.id, scope: { pages: [0] },
    parameters: { replacements: [{ unitId: 'p0-oscan', translatedText: 'Hola corregido', selected: true }] }
  });
  const empty = await app.runDocumentAction({
    actionId: 'correct-text', docId: first.id, scope: { pages: [0] },
    parameters: { replacements: [{ unitId: 'p0-oscan', translatedText: 'Hola corregido', selected: false }] }
  });

  assert.equal(unsafe.status, 'failed');
  assert.equal(empty.status, 'failed');
  assert.equal(app._documentActionDrafts.size, 0);
  assert.equal(first.pages[0].objects[0].text, 'Hola');
});

test('translation review retains a private snapshot and rejects a stale source document', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  first.pages[0].objects = [
    { id: 'source', text: 'Buenos días', x: 10, y: 20, width: 140, height: 16, fontName: 'Helvetica', fontSize: 12 }
  ];
  const review = await app.prepareTextTranslationReview({
    docId: first.id,
    scope: { pages: [0] },
    targetLanguage: 'English',
    request: async ({ units }) => JSON.stringify([{ unitId: units[0].unitId, translatedText: 'Good morning' }])
  });

  assert.equal(review.status, 'review');
  assert.equal(review.items[0].status, 'READY');
  assert.equal(review.items[0].selected, true);
  app.markDocumentChanged(first.id, 'user-edit');
  const result = await app.applyTextTranslationReview(review.reviewId, [review.items[0].unitId]);
  assert.deepEqual({ ...result }, { status: 'failed', errorCode: 'STALE_TRANSLATION_REVIEW' });
  assert.equal(first.pages[0].objects[0].text, 'Buenos días');
});
