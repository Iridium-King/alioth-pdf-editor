const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./helpers/document-harness.cjs');

test('agentic action keeps the original isolated across a tab switch and publishes a route-free copy', async () => {
  const { app, first, second } = loadAppModules(['js/app.agentic.js']);
  app.registerDocumentAction({
    id: 'fixture-mutation',
    apply: async ({ snapshot }) => {
      snapshot.payload.pages[0].nativeFormValues.nombre.value = 'BORRADOR';
      return snapshot;
    }
  });
  const before = await app.captureDocumentSnapshot(first.id);

  const pending = app.runDocumentAction({ actionId: 'fixture-mutation', docId: first.id, scope: { pages: [0] }, parameters: {} });
  app.activeDocId = second.id;
  const review = await pending;
  first.pages[0].nativeFormValues.nombre.value = 'ORIGINAL POSTERIOR';
  const published = await app.publishDocumentAction(review.draftId);

  assert.notEqual(published.docId, first.id);
  assert.equal(first.pages[0].nativeFormValues.nombre.value, 'ORIGINAL POSTERIOR');
  assert.equal(before.payload.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
  const copy = app.getDocumentById(published.docId);
  assert.equal(copy.pages[0].nativeFormValues.nombre.value, 'BORRADOR');
  assert.equal(copy.documentState.binding, null);
  assert.equal(copy.documentState.savedRevision, null);
});

test('agentic action rejects malformed scopes without creating a draft', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  app.registerDocumentAction({ id: 'fixture-check', apply: async ({ snapshot }) => snapshot });

  const result = await app.runDocumentAction({ actionId: 'fixture-check', docId: first.id, scope: { pages: [999] }, parameters: {} });

  assert.deepEqual({ ...result }, { status: 'failed', errorCode: 'INVALID_SCOPE' });
  assert.equal(app._documentActionDrafts.size, 0);
});

test('agentic action can reuse a current private snapshot without recapturing the document', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  app.registerDocumentAction({ id: 'fixture-prepared', apply: async ({ snapshot }) => snapshot });
  const preparedSnapshot = await app.captureDocumentSnapshot(first.id);
  app.captureDocumentSnapshot = async () => { throw new Error('UNEXPECTED_RECAPTURE'); };

  const result = await app.runDocumentAction({
    actionId: 'fixture-prepared', docId: first.id, scope: { pages: [0] }, preparedSnapshot,
    expectedRevision: preparedSnapshot.revision, expectedLifecycleEpoch: preparedSnapshot.lifecycleEpoch
  });

  assert.equal(result.status, 'review');
  assert.ok(await app.getDocumentActionDraft(result.draftId));
});

test('agentic action requiring a provider fails before its apply function without a user key', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  let applied = 0;
  app.registerDocumentAction({
    id: 'fixture-provider', requiresProvider: true, hasUserKey: () => false,
    apply: async ({ snapshot }) => { applied += 1; return snapshot; }
  });

  const result = await app.runDocumentAction({ actionId: 'fixture-provider', docId: first.id, scope: { pages: [0] }, parameters: {} });

  assert.deepEqual({ ...result }, { status: 'failed', errorCode: 'PROVIDER_KEY_REQUIRED' });
  assert.equal(applied, 0);
});

test('draft inspection exposes isolated review data without provider credentials', async () => {
  const { app, first } = loadAppModules(['js/app.agentic.js']);
  app.registerDocumentAction({ id: 'fixture-review', apply: async ({ snapshot }) => snapshot });
  const review = await app.runDocumentAction({ actionId: 'fixture-review', docId: first.id, scope: { pages: [0] } });
  const draft = await app.getDocumentActionDraft(review.draftId);
  assert.equal(draft.sourceDocId, first.id);
  assert.equal(draft.actionId, 'fixture-review');
  assert.equal('geminiApiKey' in draft, false);
  draft.snapshot.payload.pages[0].nativeFormValues.nombre.value = 'CAMBIO LOCAL';
  assert.equal((await app.getDocumentActionDraft(review.draftId)).snapshot.payload.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
});
