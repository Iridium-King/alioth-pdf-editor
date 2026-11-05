const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppModules } = require('./helpers/document-harness.cjs');

test('the review exposes a background control and the source tab reopens it', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'BASE.html'), 'utf8');
  const tabs = fs.readFileSync(path.join(root, 'js/app.render.js'), 'utf8');
  assert.match(html, /id="translation-review-background"[^>]*onclick="app\.minimizeTextTranslationModal\(\)"/);
  assert.match(tabs, /doc-tab-translation/);
  assert.match(tabs, /this\.restoreTextTranslationModal\?\.\(\)/);
});

function fixture() {
  const h = loadAppModules(['js/app.agentic.js'], { AbortController });
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      style: {}, hidden: false, disabled: false, value: '', textContent: '',
      replaceChildren() {}, append() {}, querySelector() { return node('progress-track'); },
      setAttribute() {}, classList: { toggle() {} }
    });
    return nodes.get(id);
  };
  h.documentObject.getElementById = node;
  h.documentObject.querySelector = () => null;
  h.app.closeAllModals = () => {
    node('modal-overlay').style.display = 'none';
    node('translation-review-modal').style.display = 'none';
  };
  h.app.renderTabs = () => {};
  h.app.showToast = () => {};
  h.app.switchTab = id => { h.app.activeDocId = id; };
  node('translation-review-scope').value = 'document';
  node('translation-review-language').value = 'Español';
  return { ...h, node };
}

test('review continues after hiding the dialog and can be reopened from its source tab', async () => {
  const { app, first, second, node } = fixture();
  let finish;
  app.prepareTextTranslationReview = () => new Promise(resolve => { finish = resolve; });
  app.showTextTranslationModal();
  const pending = app.prepareTextTranslationModal();
  const controller = app._translationReviewAbortController;
  app.minimizeTextTranslationModal();
  app.activeDocId = second.id;
  assert.equal(node('modal-overlay').style.display, 'none');
  assert.equal(controller.signal.aborted, false);
  finish({ status: 'review', reviewId: 'review', items: [], readyCount: 0, exceptionCount: 0 });
  await pending;
  assert.equal(app._translationReviewDocId, first.id);
  assert.equal(app._translationReviewPhase, 'ready');
  assert.equal(app.activeDocId, second.id);
  app.restoreTextTranslationModal();
  assert.equal(app.activeDocId, first.id);
  assert.equal(node('modal-overlay').style.display, 'flex');
  assert.equal(node('translation-review-modal').style.display, 'flex');
});

test('a copy finished in the background does not steal the active tab or close another dialog', async () => {
  const { app, second, node } = fixture();
  app.showTextTranslationModal();
  app._translationReviewPhase = 'ready';
  app._activeTranslationReviewId = 'review';
  app._translationReviews.set('review', {
    checks: [{ id: 'unit', status: 'READY' }],
    replacements: [{ unitId: 'unit', selected: true }]
  });
  let finish;
  app.applyTextTranslationReview = () => new Promise(resolve => { finish = resolve; });
  app.publishDocumentAction = async () => ({ docId: 'copy' });
  const pending = app.applyTextTranslationModal();
  app.minimizeTextTranslationModal();
  app.activeDocId = second.id;
  node('modal-overlay').style.display = 'flex';
  node('other-modal').style.display = 'flex';
  finish({ status: 'review', draftId: 'draft' });
  await pending;
  assert.equal(app.activeDocId, second.id);
  assert.equal(node('other-modal').style.display, 'flex');
  assert.equal(app._translationReviewDocId, null);
});

test('the source tab cannot be closed while its background review is active', () => {
  const { app, first } = loadAppModules(['js/app.ui.js', 'js/app.agentic.js'], { AbortController });
  app._translationReviewDocId = first.id;
  app._translationReviewPhase = 'working';
  app._translationReviewMinimized = true;
  app.showToast = () => {};
  app.closeTab(first.id, null, true);
  assert.equal(app.docs.includes(first), true);
  app.closeDocument();
  assert.equal(app.docs.includes(first), true);
  app.detachTabToNewWindow(first.id);
  assert.equal(app.docs.includes(first), true);
  app.sendDocToTab(first.id, 'doc-b');
  assert.equal(app.docs.includes(first), true);
});

test('closing the visible review cancels its job rather than leaving a hidden orphan', () => {
  const { app, first, documentObject } = loadAppModules(['js/app.ui.js', 'js/app.agentic.js'], { AbortController });
  const modal = { style: { display: 'flex' } };
  documentObject.getElementById = id => id === 'translation-review-modal' ? modal : null;
  app._translationReviewDocId = first.id;
  app._translationReviewPhase = 'working';
  app._translationReviewAbortController = new AbortController();
  const controller = app._translationReviewAbortController;
  app.closeAllModals();
  assert.equal(controller.signal.aborted, true);
  assert.equal(app._translationReviewDocId, null);
});
