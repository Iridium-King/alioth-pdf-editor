const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./helpers/document-harness.cjs');

test('analysis response accepts only structured sections with captured page references', () => {
  const { app } = loadAppModules(['js/app.agentic.js']);
  const valid = app.validateAnalysisResponse({ sections: [{ heading: 'Resumen', body: 'Texto seguro.', pageRefs: [1, 2] }] }, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(valid)), { sections: [{ heading: 'Resumen', body: 'Texto seguro.', pageRefs: [1, 2] }] });
  assert.equal(app.validateAnalysisResponse({ sections: [{ heading: 'X', body: 'Y', pageRefs: [3] }] }, 2), null);
  assert.equal(app.validateAnalysisResponse({ sections: [{ heading: '', body: 'Y', pageRefs: [] }] }, 2), null);
});

test('analysis report adds vector PDF pages only to the isolated snapshot', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  const result = await app.appendAnalysisReportToSnapshot(snapshot, { sections: [{ heading: 'Resumen', body: 'Texto seleccionable del informe.', pageRefs: [1] }] }, 'start');
  assert.equal(first.pages.length, 2);
  assert.equal(result.payload.pages[0].sourceId.startsWith('analysis-report_'), true);
  const source = result.payload.sources.find(item => item.sourceId === result.payload.pages[0].sourceId);
  assert.equal(new TextDecoder().decode(new Uint8Array(source.buffer).slice(0, 4)), '%PDF');
});

test('analysis report action requires a user key and publishes an independent review copy', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const denied = await app.runDocumentAction({ actionId: 'analysis-report', docId: first.id, scope: { pages: [0] }, parameters: {} });
  assert.equal(denied.errorCode, 'PROVIDER_KEY_REQUIRED');
  app.geminiApiKey = 'user-owned-key';
  const review = await app.runDocumentAction({ actionId: 'analysis-report', docId: first.id, scope: { pages: [0] }, parameters: { analysis: { sections: [{ heading: 'Resumen', body: 'Contenido.', pageRefs: [1] }] } } });
  assert.equal(review.status, 'review');
  const published = await app.publishDocumentAction(review.draftId);
  assert.equal(app.getDocumentById(published.docId).pages.length, first.pages.length + 1);
  assert.equal(first.pages.length, 2);
});

test('a reviewed redaction carries only occurrence geometry into the independent copy save state', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  app.registerDocumentAction({
    id: 'redaction-manifest-test',
    apply: async ({ snapshot }) => {
      snapshot.redactionVerification = { occurrences: [{ id: 'occ-1', pageIndex: 0, rect: { x0: 10, y0: 20, x1: 30, y1: 40 } }] };
      return snapshot;
    }
  });
  const result = await app.runDocumentAction({ actionId: 'redaction-manifest-test', docId: first.id, scope: { pages: [0] } });
  assert.equal(result.status, 'review');
  const published = await app.publishDocumentAction(result.draftId);
  const copy = app.getDocumentById(published.docId);
  assert.deepEqual(JSON.parse(JSON.stringify(app.ensureDocumentState(copy).redactionVerification)), { occurrences: [{ id: 'occ-1', pageIndex: 0, rect: { x0: 10, y0: 20, x1: 30, y1: 40 } }] });
  assert.equal(JSON.stringify(app.ensureDocumentState(copy).redactionVerification).includes('555'), false);
});

test('comparison response requires evidence references in both captured documents', () => {
  const { app } = loadAppModules(['js/app.agentic.js']);
  const valid = app.validateComparisonResponse({ entries: [{ summary: 'Cambio localizado.', aPageRefs: [1], bPageRefs: [2] }] }, 2, 2);
  assert.equal(valid.entries.length, 1);
  assert.equal(app.validateComparisonResponse({ entries: [{ summary: 'Sin fuente.', aPageRefs: [1], bPageRefs: [3] }] }, 2, 2), null);
});

test('comparison action publishes only a copy of A and leaves B unchanged', async () => {
  const { app, first, second } = loadAppModules(['js/app.agentic.js']);
  app.geminiApiKey = 'user-owned-key';
  const result = await app.runComparisonDocumentAction({ docAId: first.id, docBId: second.id, scope: { pages: [0] }, comparison: { entries: [{ summary: 'Cambio.', aPageRefs: [1], bPageRefs: [1] }] } });
  assert.equal(result.status, 'review');
  const published = await app.publishDocumentAction(result.draftId);
  assert.equal(app.getDocumentById(published.docId).pages.length, first.pages.length + 1);
  assert.equal(second.pages.length, 2);
});

test('obligations retain a source quote and mark missing data as unidentified', () => {
  const { app } = loadAppModules(['js/app.agentic.js']);
  const valid = app.validateObligationsResponse({ items: [{ quote: 'Entregar el informe.', pageRef: 1 }] }, 2);
  assert.equal(valid.items[0].responsible, 'No identificado');
  assert.equal(valid.items[0].dueDate, 'No identificada');
  assert.equal(app.validateObligationsResponse({ items: [{ quote: '', pageRef: 1 }] }, 2), null);
});

test('obligations report becomes a vector page in an independent review copy', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  app.geminiApiKey = 'user-owned-key';
  const result = await app.runDocumentAction({ actionId: 'obligations-report', docId: first.id, scope: { pages: [0] }, parameters: { obligations: { items: [{ quote: 'Entregar informe.', pageRef: 1 }] } } });
  assert.equal(result.status, 'review');
  const published = await app.publishDocumentAction(result.draftId);
  assert.equal(app.getDocumentById(published.docId).pages.length, first.pages.length + 1);
  assert.equal(first.pages.length, 2);
});

test('form diagnosis reports duplicates per source and never changes the snapshot', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [
    { id: 'one', fromFormField: true, nativeFieldName: 'nombre', x: 1, y: 1, width: 20, height: 10, appearance: true },
    { id: 'two', fromFormField: true, nativeFieldName: 'nombre', x: 700, y: 1, width: 20, height: 10 }
  ];
  const findings = await app.diagnoseFormStructure(snapshot);
  assert.equal(findings.some(item => item.type === 'DUPLICATE_NAME'), true);
  assert.equal(findings.some(item => item.type === 'OUTSIDE_PAGE'), true);
  assert.equal(snapshot.payload.pages[0].objects.length, 2);
});

test('form repair changes only selected compatible fields in the draft', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'target', fromFormField: true, appearance: false, readOnly: true }, { id: 'other', fromFormField: true, appearance: false }];
  await app.applySelectedFormRepairsToSnapshot(snapshot, [{ fieldId: 'target', kind: 'setAppearance', value: true }]);
  assert.equal(snapshot.payload.pages[0].objects[0].appearance, true);
  assert.equal(snapshot.payload.pages[0].objects[1].appearance, false);
  await assert.rejects(() => app.applySelectedFormRepairsToSnapshot(snapshot, [{ fieldId: 'missing', kind: 'setAppearance', value: true }]));
  assert.equal(first.pages[0].objects[0].id, 'doc-a-widget');
});

test('form repair publishes only the selected repair in an independent copy', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  first.pages[0].objects = [{ id: 'target', fromFormField: true, appearance: false }, { id: 'other', fromFormField: true, appearance: false }];
  const review = await app.runDocumentAction({ actionId: 'form-repair', docId: first.id, scope: { pages: [0] }, parameters: { repairs: [{ fieldId: 'target', kind: 'setAppearance', value: true }] } });
  const published = await app.publishDocumentAction(review.draftId);
  const copy = app.getDocumentById(published.docId);
  assert.equal(first.pages[0].objects[0].appearance, false);
  assert.equal(copy.pages[0].objects[0].appearance, true);
  assert.equal(copy.pages[0].objects[1].appearance, false);
});

test('form fill uses field IDs and rejects invalid options without touching other values', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.pages[0].objects = [{ id: 'choice-a', fromFormField: true, nativeFieldName: 'lista', fieldType: 'dropdown', options: ['1', '2'] }];
  await app.applyStructuredFormFillToSnapshot(snapshot, [{ fieldId: 'choice-a', value: '1' }]);
  assert.equal(snapshot.payload.pages[0].nativeFormValues.lista.value, '1');
  await assert.rejects(() => app.applyStructuredFormFillToSnapshot(snapshot, [{ fieldId: 'choice-a', value: '3' }]));
  assert.equal(snapshot.payload.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
  assert.equal(first.pages[0].nativeFormValues.lista.value, '2');
});

test('form fill publishes changed values only in an independent copy', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  first.pages[0].objects = [{ id: 'text-a', fromFormField: true, nativeFieldName: 'nombre', fieldType: 'text' }];
  const review = await app.runDocumentAction({ actionId: 'form-fill', docId: first.id, scope: { pages: [0] }, parameters: { assignments: [{ fieldId: 'text-a', value: 'NUEVO' }] } });
  const published = await app.publishDocumentAction(review.draftId);
  assert.equal(first.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
  assert.equal(app.getDocumentById(published.docId).pages[0].nativeFormValues.nombre.value, 'NUEVO');
});

test('structure diagnosis reports only observable accessibility gaps', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  const snapshot = await app.captureDocumentSnapshot(first.id);
  snapshot.payload.document.metadata = {};
  snapshot.payload.document.indexEntries = [];
  snapshot.payload.pages[0].objects = [{ id: 'link', type: 'link' }, { id: 'field', fromFormField: true }];
  const findings = await app.diagnoseDocumentStructure(snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(findings.map(item => item.type))), ['MISSING_TITLE', 'MISSING_BOOKMARKS', 'INVALID_LINK', 'MISSING_ACCESSIBLE_NAME']);
});
