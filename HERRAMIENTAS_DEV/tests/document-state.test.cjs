const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules, flushTimers } = require('./helpers/document-harness.cjs');

test('snapshot clone isolates native values, tombstones and source bytes', async () => {
  const { app, first } = loadAppModules();
  app.markDocumentChanged(first.id, 'native-field-input');
  const snapshot = await app.captureDocumentSnapshot(first.id);
  const copy = await app.cloneDocumentSnapshot(snapshot);
  copy.payload.pages[0].nativeFormValues.nombre.value = 'OTRO';
  copy.payload.pages[0].deletedObjectIds.push('copy-only');
  new Uint8Array(copy.payload.sources[0].buffer)[0] = 99;
  assert.equal(snapshot.payload.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
  assert.deepEqual(snapshot.payload.pages[0].deletedObjectIds, ['doc-a-removed-widget']);
  assert.equal(new Uint8Array(snapshot.payload.sources[0].buffer)[0], 1);
  assert.equal(snapshot.payload.pages.length, 2);
});

test('snapshot flushes the active edit before capturing durable form values', async () => {
  const { app, first, documentObject } = loadAppModules();
  documentObject.activeElement = { blur() { first.pages[0].nativeFormValues.nombre.value = 'CONFIRMADO'; } };
  const snapshot = await app.captureDocumentSnapshot(first.id);
  assert.equal(snapshot.payload.pages[0].nativeFormValues.nombre.value, 'CONFIRMADO');
});

test('revision and dirty state stay attached to the requested document', () => {
  const { app, first, second } = loadAppModules();
  app.markDocumentChanged(first.id, 'field-input');
  app.markDocumentChanged(second.id, 'field-input');
  assert.equal(app.isDocumentDirty(first.id), true);
  assert.equal(app.isDocumentDirty(second.id), true);
  assert.equal(first.documentState.revision, 1);
  assert.equal(second.documentState.revision, 1);
});

test('restoring a snapshot recovers values, sources and tombstones without shared state', async () => {
  const { app, first } = loadAppModules();
  const snapshot = await app.captureDocumentSnapshot(first.id);
  first.pages[0].nativeFormValues.nombre.value = 'MUTADO';
  first.pages[0].deletedObjectIds = [];
  new Uint8Array(first.sources['source-a'].buffer)[0] = 77;
  await app.restoreDocumentSnapshot(first.id, snapshot);
  assert.equal(first.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
  assert.deepEqual(first.pages[0].deletedObjectIds, ['doc-a-removed-widget']);
  assert.equal(new Uint8Array(first.sources['source-a'].buffer)[0], 1);
  first.pages[0].nativeFormValues.nombre.value = 'DESPUÉS';
  assert.equal(snapshot.payload.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
});

test('a durable baseline restores the original document without shared buffers', async () => {
  const { app, first } = loadAppModules();
  await app.setDocumentBaseline(first.id);
  first.pages[0].nativeFormValues.nombre.value = 'EDITADO';
  new Uint8Array(first.sources['source-a'].buffer)[0] = 91;
  app.markDocumentChanged(first.id, 'edit');
  await app.restoreDocumentBaseline(first.id);
  assert.equal(first.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
  assert.equal(new Uint8Array(first.sources['source-a'].buffer)[0], 1);
  first.pages[0].nativeFormValues.nombre.value = 'DESPUÉS';
  assert.equal(first.documentState.baselineSnapshot.payload.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
});

test('debounced state save uses its original document after a tab switch', async () => {
  const { app, first, second, timers } = loadAppModules();
  const saved = [];
  app.saveState = docId => saved.push(docId);
  app.saveStateDebounced(1);
  app.activeDocId = second.id;
  await flushTimers(timers);
  assert.deepEqual(saved, [first.id]);
  app.activeDocId = first.id;
  app.saveStateDebounced(1);
  app.docs = [second];
  await flushTimers(timers);
  assert.deepEqual(saved, [first.id]);
});

test('document operations serialize without changing the active tab', async () => {
  const { app, first, second } = loadAppModules();
  const events = [];
  const one = app.withDocumentOperation(first.id, 'saving', async () => {
    events.push(['start', app.activeDocId]);
    await Promise.resolve();
    events.push(['end', app.activeDocId]);
  });
  const two = app.withDocumentOperation(first.id, 'copying', async () => events.push(['next', app.activeDocId]));
  app.activeDocId = second.id;
  await Promise.all([one, two]);
  assert.deepEqual(events, [['start', second.id], ['end', second.id], ['next', second.id]]);
  assert.equal(app.activeDocId, second.id);
});
