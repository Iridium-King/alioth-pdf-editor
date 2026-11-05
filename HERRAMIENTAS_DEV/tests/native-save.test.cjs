const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppModules } = require('./helpers/document-harness.cjs');

const root = path.resolve(__dirname, '../..');

function loadNativeSave(app, fetchImpl, cryptoImpl) {
  const source = fs.readFileSync(path.join(root, 'js/app.native_save.js'), 'utf8');
  vm.runInNewContext(`(function () {\n${source}\n})();`, { window: { app, __aliothWindowId: 'window-A', crypto: cryptoImpl }, Uint8Array, console, Promise, Object, Map, fetch: fetchImpl, crypto: cryptoImpl }, { filename: 'js/app.native_save.js' });
}

function loadPdfModal(app, elements, globals = {}) {
  const source = fs.readFileSync(path.join(root, 'js/app.pdf.js'), 'utf8');
  const document = {
    getElementById: id => elements[id] || null,
    querySelector: selector => selector === 'input[name="compress-level"]:checked' ? elements.compressLevel : null,
    querySelectorAll: () => []
  };
  vm.runInNewContext(`(function () {\n${source}\n})();`, {
    window: { app, location: { protocol: 'http:' } }, document, console, Object, Set, Map, Uint8Array, ArrayBuffer, Promise, Math, Date,
    ...globals
  }, { filename: 'js/app.pdf.js' });
}

test('a later edit stays dirty when commit completes the captured revision', async () => {
  const { app, first, second } = loadAppModules();
  loadNativeSave(app);
  let finishCommit;
  let enteredCommit;
  const commitGate = new Promise(resolve => { finishCommit = resolve; });
  const enteredCommitGate = new Promise(resolve => { enteredCommit = resolve; });
  app.prepareDocumentPdf = async snapshot => ({ bytes: new Uint8Array([1, 2, 3]), sha256: 'a'.repeat(64), revision: snapshot.revision });
  app.nativeSaveTransport = {
    begin: async () => ({ uploadId: 'upload-1' }),
    chunk: async () => {},
    commit: async () => { enteredCommit(); await commitGate; return { status: 'committed' }; }
  };
  const pending = app.saveDocument(first.id, { token: 'token-1' });
  await enteredCommitGate;
  app.markDocumentChanged(first.id, 'second-edit');
  app.activeDocId = second.id;
  finishCommit();
  const result = await pending;
  assert.equal(result.writtenRevision, 0);
  assert.equal(first.documentState.savedRevision, 0);
  assert.equal(app.isDocumentDirty(first.id), true);
  assert.equal(app.ensureDocumentState(second).revision, 0);
});

test('native transport sends chunks as binary with the active window session', async () => {
  const { app } = loadAppModules();
  const calls = [];
  loadNativeSave(app, async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, upload_id: 'upload-1', received: 3, status: 'committed' }) };
  });
  await app.nativeSaveTransport.begin({ token: 'token-1', operationId: 'op-1', length: 3, sha256: 'a'.repeat(64), expectedFingerprint: null });
  await app.nativeSaveTransport.chunk('upload-1', 0, 0, new Uint8Array([1, 2, 3]));
  assert.equal(calls[0].options.headers['X-Alioth-Client-Id'], 'window-A');
  const beginPayload = JSON.parse(calls[0].options.body);
  assert.equal(beginPayload.operation_id, 'op-1');
  assert.equal(beginPayload.expected_fingerprint, null);
  assert.equal('operationId' in beginPayload, false);
  assert.equal(calls[1].options.body instanceof Uint8Array, true);
  assert.match(calls[1].url, /upload_id=upload-1/);
});

test('native save computes a missing SHA-256 before beginning the upload', async () => {
  const { app, first } = loadAppModules();
  const cryptoImpl = { subtle: { digest: async () => new Uint8Array(32).fill(7).buffer } };
  loadNativeSave(app, undefined, cryptoImpl);
  app.prepareDocumentPdf = async () => ({ bytes: new Uint8Array([1]), sha256: null });
  let beginPayload;
  app.nativeSaveTransport = {
    begin: async payload => { beginPayload = payload; return { uploadId: 'upload-hash' }; },
    chunk: async () => {}, commit: async () => ({ status: 'committed' })
  };
  await app.saveDocument(first.id, { token: 'hash-token' });
  assert.equal(beginPayload.sha256, '07'.repeat(32));
});

test('native save carries image redaction verification without sensitive text', async () => {
  const { app, first } = loadAppModules();
  loadNativeSave(app);
  app.prepareDocumentPdf = async () => ({ bytes: new Uint8Array([1]), sha256: 'f'.repeat(64) });
  app.ensureDocumentState(first).redactionVerification = {
    occurrences: [{ id: 'occ-image', pageIndex: 0, kind: 'image', action: 'censor', rect: { x0: 10, y0: 20, x1: 30, y1: 40 } }]
  };
  let beginPayload;
  app.nativeSaveTransport = {
    begin: async payload => { beginPayload = payload; return { uploadId: 'image-upload', redactionVerification: true }; },
    chunk: async () => {},
    commit: async () => ({ status: 'committed', sha256: 'f'.repeat(64), redaction: { treated: [{ id: 'occ-image', pageIndex: 0 }], rejected: [] } })
  };
  await app.saveDocument(first.id, { token: 'image-token' });
  assert.deepEqual(JSON.parse(JSON.stringify(beginPayload.redactionVerification)), {
    occurrences: [{ id: 'occ-image', pageIndex: 0, kind: 'image', action: 'censor', rect: { x0: 10, y0: 20, x1: 30, y1: 40 } }]
  });
  assert.equal(JSON.stringify(beginPayload.redactionVerification).includes('@'), false);
});

test('an uncertain commit resolves through status without a second write', async () => {
  const { app, first } = loadAppModules();
  loadNativeSave(app);
  let commits = 0;
  app.prepareDocumentPdf = async snapshot => ({ bytes: new Uint8Array([1]), sha256: 'b'.repeat(64), revision: snapshot.revision });
  app.nativeSaveTransport = {
    begin: async () => ({ uploadId: 'upload-timeout' }),
    chunk: async () => {},
    commit: async () => { commits += 1; throw new Error('network timeout'); },
    status: async () => ({ status: 'committed', sha256: 'b'.repeat(64) })
  };
  const result = await app.saveDocument(first.id, { token: 'token-timeout' });
  assert.equal(result.status, 'committed');
  assert.equal(commits, 1);
  assert.equal(first.documentState.savedRevision, 0);
});

test('a failed chunk aborts its upload without updating the saved revision', async () => {
  const { app, first } = loadAppModules();
  loadNativeSave(app);
  let aborted = 0;
  app.prepareDocumentPdf = async snapshot => ({ bytes: new Uint8Array([1]), sha256: 'c'.repeat(64), revision: snapshot.revision });
  app.nativeSaveTransport = {
    begin: async () => ({ uploadId: 'upload-abort' }),
    chunk: async () => { throw new Error('network failed'); },
    abort: async () => { aborted += 1; }
  };
  await assert.rejects(app.saveDocument(first.id, { token: 'token-abort' }), /network failed/);
  assert.equal(aborted, 1);
  assert.equal(first.documentState.savedRevision, null);
});

test('a committed document stores only durable binding metadata, never its save token', async () => {
  const { app, first } = loadAppModules();
  loadNativeSave(app);
  app.prepareDocumentPdf = async snapshot => ({ bytes: new Uint8Array([1]), sha256: 'd'.repeat(64), revision: snapshot.revision });
  app.nativeSaveTransport = {
    begin: async () => ({ uploadId: 'upload-binding' }), chunk: async () => {}, commit: async () => ({ status: 'committed', sha256: 'd'.repeat(64) })
  };
  await app.saveDocument(first.id, { token: 'ephemeral-secret', expectedFingerprint: 'old-fingerprint' });
  assert.equal(first.documentState.binding.fingerprint, 'd'.repeat(64));
  assert.equal('token' in first.documentState.binding, false);
});

test('an opened local PDF receives a transient direct-save target', async () => {
  const { app, first } = loadAppModules();
  let request;
  loadNativeSave(app, async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({
        ok: true,
        token: 'origin-token',
        identity: 'origin-identity',
        fingerprint: 'a'.repeat(64)
      })
    };
  });

  await app.bindOpenedFilePath(first.id, 'C:\\Documentos\\original.pdf');

  assert.equal(request.url, '/api/files/save/opened');
  assert.equal(JSON.parse(request.options.body).path, 'C:\\Documentos\\original.pdf');
  assert.equal(app._nativeSaveTargets.get(first.id).token, 'origin-token');
  assert.equal(first.documentState.binding.identity, 'origin-identity');
  assert.equal(first.documentState.binding.fingerprint, 'a'.repeat(64));
});

test('an expired authorization renews once and retries the same save without changing its baseline', async () => {
  const { app } = loadAppModules(), calls = [];
  let starts = 0;
  loadNativeSave(app, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const expired = url.endsWith('/begin') && ++starts === 1;
    return { ok: !expired, json: async () => expired ? { ok: false, error: 'SAVE_TOKEN_UNAVAILABLE' }
      : { ok: true, upload_id: 'renewed' } };
  });
  const result = await app.nativeSaveTransport.begin({ token: 'same-token', operationId: 'same-operation', length: 10, sha256: 'a'.repeat(64), expectedFingerprint: 'baseline' });
  assert.equal(result.uploadId, 'renewed');
  assert.deepEqual(calls.map(call => call.url), ['/api/files/save/begin', '/api/files/save/renew', '/api/files/save/begin']);
  assert.deepEqual(calls[0].body, calls[2].body);
  assert.equal(calls[2].body.expected_fingerprint, 'baseline');
});

test('opening a path-backed PDF binds its original destination to the created document', async () => {
  const { app, first } = loadAppModules();
  first.pages = [];
  first.sources = {};
  const events = [];
  let binding;
  const setBaseline = app.setDocumentBaseline.bind(app);
  app.setDocumentBaseline = async docId => {
    events.push('baseline');
    return setBaseline(docId);
  };
  app.renderTabs = () => {};
  app.toggleLoader = () => {};
  app.switchTab = id => { events.push('activate'); app.activeDocId = id; };
  app.saveState = () => {};
  app.addToRecentDocs = async () => {};
  app.bindOpenedFilePath = async (docId, path) => {
    events.push('binding');
    binding = { docId, path };
  };
  const bytes = Buffer.from('%PDF-1.7\n');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pdfjsLib = {
    getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }) }),
    PasswordResponses: { INCORRECT_PASSWORD: 2 }
  };
  loadPdfModal(app, {}, {
    pdfjsLib,
    localStorage: { getItem: () => 'tab' },
    setTimeout: callback => { callback(); return 1; },
    prompt: () => null
  });

  await app.openFile({
    name: 'original.pdf',
    type: 'application/pdf',
    _aliothSourcePath: 'C:\\Documentos\\original.pdf',
    arrayBuffer: async () => buffer
  });

  assert.deepEqual(binding, { docId: first.id, path: 'C:\\Documentos\\original.pdf' });
  assert.deepEqual(events, ['baseline', 'binding', 'activate']);
});

test('Save As opens the app modal and leaves name and location to Windows Explorer', () => {
  const html = fs.readFileSync(path.join(root, 'BASE.html'), 'utf8');
  assert.doesNotMatch(html, /id="compress-standard"[^>]*disabled/);
  assert.doesNotMatch(html, /id="compress-max"[^>]*disabled/);
  assert.match(html, /id="save-as-images"[^>]*disabled/);
  assert.match(html, /id="btn-header-save"[^>]*onclick="app\.saveFromHeader\('save', this\)"/);
  assert.match(html, /id="btn-header-save-as"[^>]*onclick="app\.showSaveModal\(\)"/);
  assert.match(html, /id="btn-save-modal-copy"[^>]*onclick="app\.saveCopyFromModal\(\)"/);
  assert.match(html, /id="btn-save-modal-copy"[\s\S]*?GUARDAR COMO/);
  assert.doesNotMatch(html, /id="save-filename"/);
  assert.doesNotMatch(html, /id="save-target-path"/);
  assert.doesNotMatch(html, /id="btn-pick-save-target"/);
  assert.doesNotMatch(html, /id="btn-save-modal-primary"/);
});

test('native modal save writes only after a selected opaque target', async () => {
  const { app, first } = loadAppModules();
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const elements = {
    'save-use-password': { checked: false },
    'save-as-images': { checked: false },
    'save-lock-edit': { checked: false },
    'save-lock-copy': { checked: false },
    'save-lock-print': { checked: false },
    'btn-save-modal-primary': button,
    'save-target-help': { textContent: '' },
    'save-target-path': { value: '' },
    compressLevel: { value: 'none' }
  };
  loadPdfModal(app, elements);
  app._pendingNativeSaveTarget = { token: 'opaque-token' };
  let saved;
  app.saveDocument = async (docId, options) => { saved = { docId, options }; };
  app.closeAllModals = () => {};
  app.showToast = () => {};
  await app.saveNativeFromModal();
  assert.equal(saved.docId, first.id);
  assert.equal(saved.options.token, 'opaque-token');
  assert.equal(saved.options.compression, 'none');
  assert.equal(button.disabled, false);
});

test('header save writes directly after selecting an opaque target', async () => {
  const { app, first } = loadAppModules();
  loadPdfModal(app, {});
  app.getDoc = () => first;
  app.pickSaveTarget = async () => {
    app._pendingNativeSaveTarget = { token: 'header-token', identity: 'header-target', fingerprint: 'target-fingerprint', mode: 'save' };
    return true;
  };
  let saved;
  app.saveDocument = async (docId, options) => { saved = { docId, options }; };
  app.showToast = () => {};
  app.clearSaveTarget = () => { app._pendingNativeSaveTarget = null; };

  await app.saveFromHeader('save');

  assert.equal(saved.docId, first.id);
  assert.equal(saved.options.token, 'header-token');
  assert.equal(saved.options.targetIdentity, 'header-target');
  assert.equal(saved.options.expectedFingerprint, 'target-fingerprint');
});

test('header Save reuses the original destination without opening the picker', async () => {
  const { app, first } = loadAppModules();
  loadPdfModal(app, {});
  app._nativeSaveTargets = new Map([[
    first.id,
    { token: 'origin-token', identity: 'origin-target', fingerprint: 'origin-fingerprint' }
  ]]);
  let pickerCalls = 0;
  let saved;
  app.pickSaveTarget = async () => { pickerCalls += 1; return false; };
  app.saveDocument = async (docId, options) => { saved = { docId, options }; };
  app.showToast = () => {};

  await app.saveFromHeader('save');

  assert.equal(pickerCalls, 0);
  assert.equal(saved.docId, first.id);
  assert.equal(saved.options.token, 'origin-token');
  assert.equal(saved.options.targetIdentity, 'origin-target');
  assert.equal(saved.options.expectedFingerprint, 'origin-fingerprint');
});

test('a saved copy restores the original baseline and activates an independent copy', async () => {
  const { app, first } = loadAppModules();
  await app.setDocumentBaseline(first.id);
  first.pages[0].nativeFormValues.nombre.value = 'EDITADO';
  app.markDocumentChanged(first.id, 'edit');
  loadNativeSave(app);
  app.prepareDocumentPdf = async snapshot => ({ bytes: new Uint8Array([1]), sha256: 'e'.repeat(64) });
  app.nativeSaveTransport = { begin: async () => ({ uploadId: 'copy-upload' }), chunk: async () => {}, commit: async () => ({ status: 'committed', sha256: 'e'.repeat(64) }) };
  app.switchTab = id => { app.activeDocId = id; };
  const copy = await app.saveCopyDocument(first.id, { token: 'copy-token' });
  assert.equal(first.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
  assert.equal(app.activeDocId, copy.docId);
  const copied = app.getDocumentById(copy.docId);
  assert.equal(copied.name, 'doc-a.pdf');
  assert.equal(copied.documentState.binding.fingerprint, 'e'.repeat(64));
  assert.equal(copied.pages[0].nativeFormValues.nombre.value, 'EDITADO');
  copied.pages[0].nativeFormValues.nombre.value = 'SOLO COPIA';
  assert.equal(first.pages[0].nativeFormValues.nombre.value, 'CAMBIO');
});

test('Save As initializes a missing baseline for a newly created tab', async () => {
  const { app, first } = loadAppModules();
  loadNativeSave(app);
  app.prepareDocumentPdf = async () => ({ bytes: new Uint8Array([1]), sha256: 'f'.repeat(64) });
  app.nativeSaveTransport = { begin: async () => ({ uploadId: 'new-tab-upload' }), chunk: async () => {}, commit: async () => ({ status: 'committed', sha256: 'f'.repeat(64) }) };
  app.switchTab = id => { app.activeDocId = id; };

  const copy = await app.saveCopyDocument(first.id, { token: 'copy-token' });

  assert.equal(copy.status, 'committed');
  assert.ok(first.documentState.baselineSnapshot);
});

test('copy rejects a destination already bound to another open document', async () => {
  const { app, first, second } = loadAppModules();
  await app.setDocumentBaseline(first.id);
  app.ensureDocumentState(second).binding = { identity: 'same-target' };
  loadNativeSave(app);
  let began = false;
  app.nativeSaveTransport = { begin: async () => { began = true; return { uploadId: 'unexpected' }; } };
  await assert.rejects(app.saveCopyDocument(first.id, { token: 'copy-token', targetIdentity: 'same-target' }), /TARGET_ALREADY_OPEN/);
  assert.equal(began, false);
});

test('Save As modal opens Explorer and commits the selected copy in one activation', async () => {
  const { app, first } = loadAppModules();
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const elements = {
    'save-use-password': { checked: false }, 'save-as-images': { checked: false },
    'save-lock-edit': { checked: false }, 'save-lock-copy': { checked: false }, 'save-lock-print': { checked: false },
    'btn-save-modal-copy': button,
    compressLevel: { value: 'none' }
  };
  loadPdfModal(app, elements);
  let pickerArgs;
  app.pickSaveTarget = async (suggestedName, mode) => {
    pickerArgs = { suggestedName, mode };
    app._pendingNativeSaveTarget = {
      token: 'copy-token', identity: 'copy-target', fingerprint: 'copy-fingerprint', mode: 'copy'
    };
    return true;
  };
  let saved;
  app.saveCopyDocument = async (docId, options) => { saved = { docId, options }; };
  let closed = 0;
  app.closeAllModals = () => { closed += 1; };
  app.showToast = () => {};
  await app.saveCopyFromModal();
  assert.deepEqual(pickerArgs, { suggestedName: 'doc-a.pdf', mode: 'copy' });
  assert.equal(saved.docId, first.id);
  assert.equal(saved.options.token, 'copy-token');
  assert.equal(saved.options.targetIdentity, 'copy-target');
  assert.equal(saved.options.expectedFingerprint, 'copy-fingerprint');
  assert.equal(saved.options.compression, 'none');
  assert.equal(closed, 1);
  assert.equal(button.disabled, false);
});

test('Save As overwrites the active original when Explorer selects that same file', async () => {
  const { app, first } = loadAppModules();
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const elements = {
    'save-use-password': { checked: false }, 'save-as-images': { checked: false },
    'save-lock-edit': { checked: false }, 'save-lock-copy': { checked: false }, 'save-lock-print': { checked: false },
    'btn-save-modal-copy': button, compressLevel: { value: 'max' }
  };
  loadPdfModal(app, elements);
  app.ensureDocumentState(first).binding = { identity: 'original-target', fingerprint: 'before' };
  app._pendingNativeSaveTarget = {
    token: 'original-token', identity: 'original-target', fingerprint: 'before', mode: 'copy'
  };
  let directSave;
  let copied = false;
  let closed = 0;
  const toasts = [];
  app.saveDocument = async (docId, options) => { directSave = { docId, options }; };
  app.saveCopyDocument = async () => { copied = true; };
  app.closeAllModals = () => { closed += 1; };
  app.showToast = (message) => { toasts.push(message); };

  await app.saveCopyFromModal();

  assert.equal(directSave.docId, first.id);
  assert.equal(directSave.options.compression, 'max');
  assert.equal(copied, false);
  assert.equal(closed, 1);
  assert.deepEqual(toasts, ['PDF original sobrescrito correctamente.']);
  assert.equal(button.disabled, false);
});

test('repeated Save As overwrite keeps the current destination and compression', async () => {
  const { app, first } = loadAppModules();
  loadNativeSave(app);
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  loadPdfModal(app, {
    'save-use-password': { checked: false }, 'save-as-images': { checked: false },
    'save-lock-edit': { checked: false }, 'save-lock-copy': { checked: false }, 'save-lock-print': { checked: false },
    'btn-save-modal-copy': button, compressLevel: { value: 'max' }
  });
  app.rememberNativeSaveTarget(first.id, { token: 'original-token', identity: 'physical-0', fingerprint: 'old' });
  const compressions = [];
  app.prepareDocumentPdf = async (_snapshot, options) => {
    compressions.push(options.compression);
    return { bytes: new Uint8Array([1]), sha256: 'a'.repeat(64) };
  };
  let commits = 0;
  const beginCalls = [];
  app.nativeSaveTransport = {
    begin: async payload => { beginCalls.push(payload); return { uploadId: 'upload' }; },
    chunk: async () => {},
    commit: async () => {
      commits += 1;
      return { status: 'committed', sha256: 'a'.repeat(64), identity: `physical-${commits}` };
    }
  };
  app.showToast = () => {};
  app.closeAllModals = () => {};
  await app.saveDocument(first.id, { token: 'original-token', targetIdentity: 'physical-0', expectedFingerprint: 'old', compression: 'none' });
  assert.equal(app.ensureDocumentState(first).binding.identity, 'physical-1');
  assert.equal(app._nativeSaveTargets.get(first.id).fingerprint, 'a'.repeat(64));

  app._pendingNativeSaveTarget = { token: 'selected-token', identity: 'physical-1', fingerprint: 'a'.repeat(64), mode: 'copy' };
  await app.saveCopyFromModal();
  assert.equal(commits, 2);
  assert.deepEqual(compressions, ['none', 'max']);
  assert.equal(app.ensureDocumentState(first).binding.identity, 'physical-2');
  assert.equal(app._nativeSaveTargets.get(first.id).token, 'selected-token');
  assert.equal(button.disabled, false);
  app.pickSaveTarget = async () => { throw new Error('Unexpected picker'); };
  await app.saveFromHeader('save');
  assert.equal(commits, 3);
  assert.equal(beginCalls[2].token, 'selected-token');
  assert.equal(beginCalls[2].expectedFingerprint, 'a'.repeat(64));
});

test('cancelling Explorer keeps the Save As modal open and writes nothing', async () => {
  const { app } = loadAppModules();
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const elements = {
    'save-use-password': { checked: false }, 'save-as-images': { checked: false },
    'save-lock-edit': { checked: false }, 'save-lock-copy': { checked: false }, 'save-lock-print': { checked: false },
    'btn-save-modal-copy': button, compressLevel: { value: 'none' }
  };
  loadPdfModal(app, elements);
  app.pickSaveTarget = async () => false;
  let writes = 0;
  let closes = 0;
  app.saveCopyDocument = async () => { writes += 1; };
  app.closeAllModals = () => { closes += 1; };
  app.showToast = () => {};

  await app.saveCopyFromModal();

  assert.equal(writes, 0);
  assert.equal(closes, 0);
  assert.equal(button.disabled, false);
});

test('Save As keeps the modal open and explains a digital-signature block', async () => {
  const { app } = loadAppModules();
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const elements = {
    'save-use-password': { checked: false }, 'save-as-images': { checked: false },
    'save-lock-edit': { checked: false }, 'save-lock-copy': { checked: false }, 'save-lock-print': { checked: false },
    'btn-save-modal-copy': button, compressLevel: { value: 'none' }
  };
  loadPdfModal(app, elements);
  app._pendingNativeSaveTarget = { token: 'copy-token', mode: 'copy' };
  app.saveCopyDocument = async () => { throw new Error('SIGNATURE_INVALIDATION_REQUIRED'); };
  let closes = 0;
  const toasts = [];
  app.closeAllModals = () => { closes += 1; };
  app.showToast = (message, duration, type) => { toasts.push({ message, duration, type }); };

  await app.saveCopyFromModal();

  assert.equal(closes, 0);
  assert.equal(button.disabled, false);
  assert.deepEqual(toasts, [{
    message: 'No se guardó el PDF porque contiene una firma digital. Editarlo invalidaría la firma.',
    duration: 5000,
    type: 'warning'
  }]);
});
