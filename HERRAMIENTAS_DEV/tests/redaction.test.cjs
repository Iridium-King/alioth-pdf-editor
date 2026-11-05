const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./helpers/document-harness.cjs');

test('sensitive detection keeps repeated phones on separate pages and finds field values', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'p1', text: 'Teléfono 555 123 4567', x: 1, y: 1, width: 50, height: 10 }];
  snapshot.payload.pages[1].objects = [{ id: 'p2', text: 'Teléfono 555 123 4567', x: 1, y: 1, width: 50, height: 10 }];
  snapshot.payload.pages[0].nativeFormValues.email = { value: 'persona@example.com' };
  const found = await app.detectSensitiveOccurrences(snapshot);
  assert.equal(found.filter(item => item.category === 'phone').length, 2);
  assert.equal(found.filter(item => item.category === 'email' && item.location === 'field:email').length, 1);
  assert.equal(found.every(item => item.selected === false), true);
  assert.equal(found.every(item => !item.id.includes(item.value)), true);
});

test('birth-date detection requires an explicit birth-date label', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [
    { id: 'dob', text: 'Fecha de nacimiento: 01/02/1990', x: 1, y: 1, width: 120, height: 10 },
    { id: 'ordinary-date', text: 'Vence: 01/02/1990', x: 1, y: 20, width: 120, height: 10 }
  ];
  const found = await app.detectSensitiveOccurrences(snapshot);
  assert.equal(found.filter(item => item.category === 'birth-date').length, 1);
  assert.equal(found.some(item => item.value.includes('Vence')), false);
});

test('card detection requires a valid Luhn checksum', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [
    { id: 'valid-card', text: '4111 1111 1111 1111', x: 1, y: 1, width: 120, height: 10 },
    { id: 'invalid-card', text: '4111 1111 1111 1112', x: 1, y: 20, width: 120, height: 10 }
  ];
  const found = await app.detectSensitiveOccurrences(snapshot);
  assert.equal(found.filter(item => item.category === 'card').length, 1);
  assert.equal(found.some(item => ['card', 'phone'].includes(item.category) && item.value.endsWith('1112')), false);
});

test('sensitive review preserves the source and marks only positioned text as censorable', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'mail', text: 'persona@example.com', x: 10, y: 11, width: 80, height: 12 }];
  snapshot.payload.pages[0].nativeFormValues.mail = { value: 'campo@example.com' };
  const original = first.sources['source-a'].buffer;
  app.captureDocumentSnapshot = async () => snapshot;
  const review = await app.prepareSensitiveReview({ docId: first.id, scope: { pages: [0] }, category: 'email' });
  assert.equal(review.status, 'review');
  assert.equal(review.items.filter(item => item.canCensor).length, 1);
  assert.equal(review.items.filter(item => !item.canCensor).length, 1);
  assert.equal(first.sources['source-a'].buffer, original);
});

test('sensitive review leaves a match inside a larger text object unselectable', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'line', text: 'Teléfono: 555 123 4567 ext. 8', x: 10, y: 11, width: 150, height: 12 }];
  app.captureDocumentSnapshot = async () => snapshot;
  const review = await app.prepareSensitiveReview({ docId: first.id, scope: { pages: [0] }, category: 'phone' });
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].canCensor, false);
});

test('redaction plan includes only the selected occurrence rectangle on its page', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'p1', text: '555 123 4567', x: 11, y: 12, width: 30, height: 9 }];
  snapshot.payload.pages[1].objects = [{ id: 'p2', text: '555 123 4567', x: 21, y: 22, width: 30, height: 9 }];
  const occurrences = await app.detectSensitiveOccurrences(snapshot);
  const plan = await app.createRedactionPlan(snapshot, [occurrences[0].id], 'censor');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].pageIndex, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(plan[0].rect)), { x: 11, y: 12, width: 30, height: 9 });
});

test('sensitive detection deduplicates OCR and text in the same area', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [
    { id: 'text', text: 'persona@example.com', x: 10, y: 10, width: 90, height: 12 },
    { id: 'ocr', text: 'persona@example.com', x: 10, y: 10, width: 90, height: 12 }
  ];
  const found = await app.detectSensitiveOccurrences(snapshot);
  assert.equal(found.filter(item => item.category === 'email').length, 1);
});

test('sensitive review classifies OCR-marked text for the separate image path', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'ocr', text: 'persona@example.com', x: 10, y: 10, width: 90, height: 12, isScan: true }];
  app.captureDocumentSnapshot = async () => snapshot;
  const review = await app.prepareSensitiveReview({ docId: first.id, scope: { pages: [0] }, category: 'email' });
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].kind, 'image');
  assert.equal(review.items[0].canCensor, true);
});

test('reviewed image censorship requires the image preflight and keeps its final verification metadata', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].height = 100;
  snapshot.payload.pages[0].objects = [{ id: 'scan', text: 'persona@example.com', x: 10, y: 20, width: 80, height: 12, isScan: true }];
  const occurrence = (await app.detectSensitiveOccurrences(snapshot))[0];
  const plan = await app.createRedactionPlan(snapshot, [occurrence.id], 'censor');
  let imagePreflight;
  const result = await app.applyVerifiedRedactionPlanToSnapshot(snapshot, plan, {
    verifyImageRedactionTargets: async (_bytes, input) => {
      imagePreflight = input;
      return { treated: input.occurrences.map(item => ({ id: item.id })), rejected: [] };
    },
    redactOccurrences: async (_bytes, input) => ({ bytes: new Uint8Array([7]).buffer, manifest: { treated: input.occurrences.map(item => ({ id: item.id })), rejected: [] } }),
    verifyRedactionOccurrences: async (_bytes, input) => ({ treated: input.occurrences.map(item => ({ id: item.id })), rejected: [] })
  });
  assert.equal(imagePreflight.occurrences[0].value, 'persona@example.com');
  assert.deepEqual(JSON.parse(JSON.stringify(result.redactionVerification)), { occurrences: [{ id: occurrence.id, pageIndex: 0, rect: { x0: 10, y0: 68, x1: 90, y1: 80 }, kind: 'image', action: 'censor' }] });
});

test('redaction geometry converts unrotated top-left coordinates to PDF bottom-left', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].height = 100;
  const rect = await app.mapOccurrenceToPdfRect(snapshot, { pageIndex: 0, rect: { x: 10, y: 20, width: 30, height: 12 } });
  assert.deepEqual(JSON.parse(JSON.stringify(rect)), { x0: 10, y0: 68, x1: 40, y1: 80 });
  snapshot.payload.pages[0].rotation = 90;
  await assert.rejects(() => app.mapOccurrenceToPdfRect(snapshot, { pageIndex: 0, rect: { x: 10, y: 20, width: 30, height: 12 } }));
});

test('vector censor applies only selected snapshot bytes and rejects delete mode', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].height = 100;
  const plan = [{ mode: 'censor', pageIndex: 0, sourceId: 'source-a', rect: { x: 10, y: 20, width: 30, height: 12 } }];
  let call;
  await app.applyVectorCensorPlanToSnapshot(snapshot, plan, { applyRedactions: async (...args) => { call = args; return new Uint8Array([9, 9, 9]).buffer; } });
  assert.equal(call[1], 0);
  assert.deepEqual(JSON.parse(JSON.stringify(call[2][0])), { x0: 10, y0: 68, x1: 40, y1: 80 });
  assert.equal(new Uint8Array(snapshot.payload.sources[0].buffer)[0], 9);
  assert.equal(new Uint8Array(first.sources['source-a'].buffer)[0], 1);
  await assert.rejects(() => app.applyVectorCensorPlanToSnapshot(snapshot, [{ ...plan[0], mode: 'delete' }], { applyRedactions: async () => new ArrayBuffer(0) }));
});

test('reviewed redaction adapter receives only selected rectangles and action', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].height = 100;
  const plan = [{ occurrenceId: 'occ-selected', mode: 'delete', pageIndex: 0, sourceId: 'source-a', rect: { x: 10, y: 20, width: 30, height: 12 } }];
  let request;
  await app.applyVectorCensorPlanToSnapshot(snapshot, plan, {
    redactOccurrences: async (bytes, input) => {
      request = { bytes, input };
      return { bytes: new Uint8Array([7, 7, 7]).buffer, manifest: { treated: [{ id: 'occ-selected', pageIndex: 0 }], rejected: [] } };
    }
  });
  assert.equal(request.input.action, 'erase');
  assert.deepEqual(JSON.parse(JSON.stringify(request.input.occurrences)), [{ id: 'occ-selected', pageIndex: 0, rect: { x0: 10, y0: 68, x1: 40, y1: 80 }, action: 'erase' }]);
  assert.equal(new Uint8Array(snapshot.payload.sources[0].buffer)[0], 7);
});

test('reviewed redaction requires a clean local verification and records only rects for final save', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].height = 100;
  snapshot.payload.pages[0].objects = [{ id: 'selected', text: '555 123 4567', x: 10, y: 20, width: 30, height: 12 }];
  const occurrence = (await app.detectSensitiveOccurrences(snapshot))[0];
  const plan = await app.createRedactionPlan(snapshot, [occurrence.id], 'censor');
  let redactionCalled = false;
  await assert.rejects(() => app.applyVerifiedRedactionPlanToSnapshot(snapshot, plan, {
    verifyRedactionTargets: async () => ({ treated: [], rejected: [{ id: occurrence.id, reason: 'IMAGE_BACKED_TEXT' }] }),
    redactOccurrences: async () => { redactionCalled = true; return { bytes: new Uint8Array([7]).buffer, manifest: { treated: [{ id: occurrence.id }], rejected: [] } }; },
    verifyRedactionOccurrences: async () => ({ treated: [], rejected: [{ id: occurrence.id, reason: 'TEXT_REMAINS' }] })
  }), /REDACTION_SOURCE_UNVERIFIED/);
  assert.equal(redactionCalled, false);
  let sourceRequest;
  const result = await app.applyVerifiedRedactionPlanToSnapshot(snapshot, plan, {
    verifyRedactionTargets: async (_bytes, input) => {
      sourceRequest = input;
      return { treated: input.occurrences.map(item => ({ id: item.id })), rejected: [] };
    },
    redactOccurrences: async (_bytes, input) => ({ bytes: new Uint8Array([7, 7, 7]).buffer, manifest: { treated: input.occurrences.map(item => ({ id: item.id })), rejected: [] } }),
    verifyRedactionOccurrences: async (_bytes, input) => ({ treated: input.occurrences.map(item => ({ id: item.id })), rejected: [] })
  });
  assert.equal(sourceRequest.occurrences[0].value, '555 123 4567');
  assert.deepEqual(JSON.parse(JSON.stringify(result.redactionVerification)), { occurrences: [{ id: occurrence.id, pageIndex: 0, rect: { x0: 10, y0: 68, x1: 40, y1: 80 }, kind: 'vector', action: 'censor' }] });
  assert.equal(JSON.stringify(result.redactionVerification).includes('555'), false);
  assert.equal(result.snapshot.payload.pages[0].objects.length, 0);
});
